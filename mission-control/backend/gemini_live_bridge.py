"""
Gemini 3.8 Live Voice Relay & GoAway Session Manager for Axiom Mission Control.

Adapted from kazunori279/live-translator (`app/main.py` & `app/translator_agent/agent.py`)
following production Gemini Live API best practices:
  - Targets `gemini-3.8-flash-live-preview` (configurable via `GEMINI_LIVE_MODEL` / client setup)
  - 16kHz PCM upstream (`audio/pcm;rate=16000`) & 24kHz PCM downstream (`inlineData`)
  - Input & Output audio transcription (`types.AudioTranscriptionConfig()`)
  - Whitelisted 30 prebuilt voices (`Puck`, `Aoede`, `Kore`, `Charon`, etc.)
  - Seamless `GoAway` session draining, silent-drain cutover (`GOAWAY_IDLE_GRACE_SEC`),
    and stalled-drain microphone mirroring (`DRAIN_MIRROR_QUIET_SEC`) with `recent_audio`
    ring-buffer replay (`RECENT_AUDIO_MAX_FRAMES`).
  - Automatic detection of spoken Mission Control adjudication commands
    (`APPROVE`, `PROMOTE_TO_SKILL`, `REJECT_AND_HARDEN`) from live input/output transcripts.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from collections import deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

logger = logging.getLogger("axiom.gemini_live")

GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-flash-live-preview")
GEMINI_LIVE_FALLBACK_MODEL = os.getenv(
    "GEMINI_LIVE_FALLBACK_MODEL", "gemini-3.1-flash-live-preview"
)

SETUP_TIMEOUT_SEC = 5.0
CONNECT_TIMEOUT_SEC = 10.0
RETRY_BACKOFF_INIT = 0.3
RETRY_BACKOFF_MAX = 4.0
GOAWAY_IDLE_GRACE_SEC = 5.0
DRAIN_MIRROR_QUIET_SEC = 3.0
RECENT_AUDIO_MAX_FRAMES = 1250
AUTHOR = "gemini_3_8_live"

VOICES: dict[str, str] = {
    "Zephyr": "Bright",
    "Puck": "Upbeat",
    "Charon": "Informative",
    "Kore": "Firm",
    "Fenrir": "Excitable",
    "Leda": "Youthful",
    "Orus": "Firm",
    "Aoede": "Breezy",
    "Callirrhoe": "Easy-going",
    "Autonoe": "Bright",
    "Enceladus": "Breathy",
    "Iapetus": "Clear",
    "Umbriel": "Easy-going",
    "Algieba": "Smooth",
    "Despina": "Smooth",
    "Erinome": "Clear",
    "Algenib": "Gravelly",
    "Rasalgethi": "Informative",
    "Laomedeia": "Upbeat",
    "Achernar": "Soft",
    "Alnilam": "Firm",
    "Schedar": "Even",
    "Gacrux": "Mature",
    "Pulcherrima": "Forward",
    "Achird": "Friendly",
    "Zubenelgenubi": "Casual",
    "Vindemiatrix": "Gentle",
    "Sadachbia": "Lively",
    "Sadaltager": "Knowledgeable",
    "Sulafat": "Warm",
}
DEFAULT_VOICE = "Puck"


def resolve_voice(name: str | None) -> str:
    """Validate against the 30 Gemini Live prebuilt voices (prevents 1007 connect loops)."""
    if not name:
        return DEFAULT_VOICE
    for voice in VOICES:
        if voice.lower() == name.strip().lower():
            return voice
    return DEFAULT_VOICE


@dataclass
class LiveSetupConfig:
    voice: str = DEFAULT_VOICE
    model: str = GEMINI_LIVE_MODEL
    lens: str = "SEC_OPS"
    mandate_id: str = "MND-2027-Q4"
    narration_enabled: bool = True


def parse_live_setup(raw: str) -> LiveSetupConfig:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return LiveSetupConfig()
    if not isinstance(data, dict):
        return LiveSetupConfig()
    voice = resolve_voice(data.get("voice") if isinstance(data.get("voice"), str) else None)
    model = (data.get("model") or GEMINI_LIVE_MODEL).strip()
    lens = (data.get("lens") or "SEC_OPS").strip()
    mandate_id = (data.get("mandateId") or "MND-2027-Q4").strip()
    narration_enabled = bool(data.get("narrationEnabled", True))
    return LiveSetupConfig(
        voice=voice,
        model=model,
        lens=lens,
        mandate_id=mandate_id,
        narration_enabled=narration_enabled,
    )


def build_mission_control_instruction(setup: LiveSetupConfig) -> str:
    return (
        "You are the Axiom Software Factory Voice Adjudicator running on Gemini 3.8 Live. "
        f"Active Capital Mandate: {setup.mandate_id}. Active Operator Lens: {setup.lens}. "
        "Your role is concise, high-precision voice copilot for an industrial software control plane. "
        "When you receive a message starting with '[NARRATION CUE]:', speak the requested cue verbatim "
        "or in one crisp, authoritative sentence without adding conversational filler. "
        "When the operator speaks a Whiteboard-to-PR command:\n"
        "- If they say 'scan whiteboard', 'search for diagram', or 'read diagram', confirm briefly: "
        "'Scanning diagram from video feed to synthesize worktree PR plan.'\n"
        "- If they say 'whiteboard to PR', 'diagram to PR', or 'dispatch run', confirm briefly: "
        "'Synthesizing diagram and dispatching worktree run to PR.'\n"
        "When the operator speaks a gate decision:\n"
        "- If they say 'approve' or 'proceed', confirm briefly: 'Approved. Resuming worktree lane.'\n"
        "- If they say 'promote to skill' or 'compile skill', confirm briefly: "
        "'Promoting Layer 2 trace to a Layer 1 trusted skill in .claude/skills.'\n"
        "- If they say 'reject and harden' or 'lock fence', confirm briefly: "
        "'Rejected and hardened FENCE-001 into a permanent HARD_LOCK.'\n"
        "Keep spoken responses under two short sentences so the operator stays in control. "
        "Your own output is played over speakers; if you hear your own earlier words echoed back, stay silent."
    )


def detect_voice_workflow_command(transcript: str) -> str | None:
    """Detect spoken Whiteboard-to-PR or Dispatch Run workflow commands from operator transcripts."""
    t = (transcript or "").strip().lower()
    if not t:
        return None
    echo_markers = (
        "scanning diagram",
        "synthesizing diagram",
        "paused on boundary",
        "awaiting operator",
        "mission control system active",
        "verification passed",
    )
    if any(m in t for m in echo_markers):
        return None
    if (
        "whiteboard to pr" in t
        or "diagram to pr" in t
        or "dispatch diagram" in t
        or "from whiteboard" in t
    ):
        return "WHITEBOARD_TO_PR_DISPATCH"
    if (
        "scan whiteboard" in t
        or "scan diagram" in t
        or "search for the diagram" in t
        or "search for diagram" in t
        or "find diagram" in t
        or "read diagram" in t
        or "capture diagram" in t
    ):
        return "SCAN_WHITEBOARD"
    if "dispatch run" in t or "run worktree" in t or "start run" in t:
        return "DISPATCH_RUN"
    return None


def detect_voice_decision(transcript: str) -> str | None:
    """Detect deterministic gate decisions from spoken operator input transcripts."""
    t = (transcript or "").strip().lower()
    if not t:
        return None
    # Guard against speaker-to-mic acoustic echo of our own narration cues
    echo_markers = (
        "paused on boundary",
        "awaiting operator",
        "mission control system active",
        "say approve",
        "verification passed",
    )
    if any(m in t for m in echo_markers):
        return None
    if "promote" in t or "skill" in t:
        return "PROMOTE_TO_SKILL"
    if "reject" in t or "harden" in t or "hard lock" in t or "lock fence" in t:
        return "REJECT_AND_HARDEN"
    if "approve" in t or "proceed" in t or "unblock" in t or "yes" in t:
        return "APPROVE"
    return None


def detect_model_confirmation_decision(transcript: str) -> str | None:
    """
    Fallback detector for Gemini Live's spoken confirmation turn (e.g. 'Approved. Resuming worktree lane.'),
    ignoring narration cues where the model prompts 'say approve, promote to skill, or reject and harden'.
    """
    t = (transcript or "").strip().lower()
    if (
        not t
        or "say approve" in t
        or "paused on boundary" in t
        or "awaiting operator" in t
        or "verification passed" in t
    ):
        return None
    if "promoting layer 2" in t or "promoted to a layer 1" in t or "trusted skill" in t:
        return "PROMOTE_TO_SKILL"
    if "rejected and hardened" in t or "permanent hard_lock" in t or "permanent lock" in t:
        return "REJECT_AND_HARDEN"
    if "approved" in t or "resuming worktree" in t:
        return "APPROVE"
    return None


def _envelope_from(msg: types.LiveServerMessage) -> dict[str, Any] | None:
    """Translate a LiveServerMessage into the camelCase JSON envelope expected by the Angular client."""
    out: dict[str, Any] = {}
    sc = msg.server_content
    if sc:
        if getattr(sc, "interrupted", False):
            out["interrupted"] = True
        if sc.turn_complete:
            out["turnComplete"] = True
        if sc.input_transcription:
            out["inputTranscription"] = {
                "text": sc.input_transcription.text or "",
                "finished": bool(sc.input_transcription.finished),
            }
        if sc.output_transcription:
            out["outputTranscription"] = {
                "text": sc.output_transcription.text or "",
                "finished": bool(sc.output_transcription.finished),
            }
        if sc.model_turn and sc.model_turn.parts:
            parts = []
            for p in sc.model_turn.parts:
                pj: dict[str, Any] = {}
                if p.text is not None:
                    pj["text"] = p.text
                if p.thought:
                    pj["thought"] = True
                if p.inline_data and p.inline_data.data is not None:
                    pj["inlineData"] = {
                        "mimeType": p.inline_data.mime_type or "audio/pcm;rate=24000",
                        "data": base64.b64encode(p.inline_data.data).decode("ascii"),
                    }
                if pj:
                    parts.append(pj)
            if parts:
                out["content"] = {"role": "model", "parts": parts}
                if not sc.turn_complete:
                    out["partial"] = True

    if msg.usage_metadata:
        out["usageMetadata"] = msg.usage_metadata.model_dump(
            by_alias=True, exclude_none=True, mode="json"
        )

    if not out:
        return None
    out["author"] = AUTHOR
    return out


async def handle_gemini_live_ws(
    websocket: WebSocket,
    session_id: str,
    on_voice_decision: Callable[[str, str], Awaitable[dict[str, Any]]],
) -> None:
    """
    Bridges browser 16kHz PCM AudioWorklet stream + text prompts to Gemini 3.8 Live API
    with GoAway session rotation and automatic MCP elicitation gate triggering.
    """
    await websocket.accept()

    setup = LiveSetupConfig()
    try:
        setup_raw = await asyncio.wait_for(websocket.receive_text(), timeout=SETUP_TIMEOUT_SEC)
        setup = parse_live_setup(setup_raw)
    except asyncio.TimeoutError:
        logger.debug("No setup frame within %.1fs; using default Gemini 3.8 Live setup", SETUP_TIMEOUT_SEC)
    except WebSocketDisconnect:
        return

    api_key = (
        os.getenv("GOOGLE_API_KEY", "").strip()
        or os.getenv("GEMINI_API_KEY", "").strip()
    )
    has_live_google_key = bool(
        api_key
        and not api_key.startswith("your-")
        and not api_key.startswith("AIza...")
    )

    await websocket.send_text(
        json.dumps(
            {
                "type": "sessionReady",
                "sessionId": session_id,
                "model": setup.model,
                "voice": setup.voice,
                "mode": "GEMINI_LIVE_UPSTREAM" if has_live_google_key else "SIMULATED_GEMINI_LIVE",
                "author": AUTHOR,
            }
        )
    )

    # Simulation fallback when GOOGLE_API_KEY / GEMINI_API_KEY is not set in `.env`:
    # Keeps the WebSocket + AudioWorklet pipeline active and responds to typed/spoken commands.
    if not has_live_google_key:
        if setup.narration_enabled:
            await websocket.send_text(
                json.dumps(
                    {
                        "outputTranscription": {
                            "text": "Mission Control system active.",
                            "finished": True,
                        },
                        "turnComplete": True,
                        "author": AUTHOR,
                    }
                )
            )
        try:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    return
                if "text" in message:
                    try:
                        payload = json.loads(message["text"])
                    except Exception:
                        continue
                    payload_type = payload.get("type") if isinstance(payload, dict) else None
                    if payload_type == "realtimeInput":
                        continue
                    text = (payload.get("text") or "").strip() if isinstance(payload, dict) else ""
                    if not text:
                        continue
                    if payload_type == "narrate":
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "outputTranscription": {"text": text, "finished": True},
                                    "turnComplete": True,
                                    "author": AUTHOR,
                                }
                            )
                        )
                        continue
                    decision = detect_voice_decision(text)
                    workflow_cmd = detect_voice_workflow_command(text)
                    reply = (
                        f"[Gemini 3.8 Live Sim · {setup.voice}] Heard: '{text}'."
                    )
                    voice_decision_payload = None
                    if decision:
                        res = await on_voice_decision(decision, f"Gemini 3.8 Live WS ('{text}')")
                        reply += f" Triggered {decision} ({res.get('status', 'ok')})."
                        voice_decision_payload = {
                            "decision": decision,
                            "status": res.get("status"),
                            "runId": res.get("run_id"),
                        }
                    if workflow_cmd:
                        reply += f" Workflow command: {workflow_cmd}."
                    await websocket.send_text(
                        json.dumps(
                            {
                                "inputTranscription": {"text": text, "finished": True},
                                "outputTranscription": {"text": reply, "finished": True},
                                "voiceDecision": voice_decision_payload,
                                "voiceWorkflowCommand": workflow_cmd,
                                "turnComplete": True,
                                "author": AUTHOR,
                            }
                        )
                    )
        except WebSocketDisconnect:
            return

    # Real Gemini Live API Session Loop (with GoAway pre-opening & mic ring-buffer replay)
    # IMPORTANT: google-genai>=3.0.0 defaults to v1alpha for live.connect(), which returns HTTP 404
    # for Gemini Live preview models on standard keys. Explicitly use api_version="v1beta".
    os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
    os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
    os.environ.pop("GOOGLE_CLOUD_LOCATION", None)
    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    system_instruction = build_mission_control_instruction(setup)

    current_session: types.AsyncSession | None = None
    mirror_session: types.AsyncSession | None = None
    recent_audio: deque[tuple[float, bytes]] = deque(maxlen=RECENT_AUDIO_MAX_FRAMES)
    input_transcript_buffer: list[str] = []
    output_transcript_buffer: list[str] = []
    pending_narrations: deque[str] = deque()
    intro_announced = False

    def _audio_since(t: float) -> bytes:
        return b"".join(frame for ts, frame in recent_audio if ts >= t)

    async def _send_audio(sess: types.AsyncSession, audio: bytes) -> None:
        try:
            await sess.send_realtime_input(
                audio=types.Blob(mime_type="audio/pcm;rate=16000", data=audio)
            )
        except Exception:
            pass

    async def upstream_task() -> None:
        loop = asyncio.get_running_loop()
        try:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    return
                if "bytes" in message:
                    audio = message["bytes"]
                    recent_audio.append((loop.time(), audio))
                    if mirror_session is not None:
                        await _send_audio(mirror_session, audio)
                    if current_session is not None:
                        await _send_audio(current_session, audio)
                elif "text" in message:
                    try:
                        payload = json.loads(message["text"])
                    except Exception:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    msg_type = payload.get("type")
                    if msg_type == "realtimeInput":
                        chunks = payload.get("chunks") or []
                        if isinstance(chunks, list):
                            for chunk in chunks:
                                if not isinstance(chunk, dict):
                                    continue
                                mime_type = str(chunk.get("mimeType") or "image/jpeg")
                                b64_data = chunk.get("data")
                                if not b64_data:
                                    continue
                                try:
                                    raw_bytes = base64.b64decode(b64_data)
                                except Exception:
                                    continue
                                blob = types.Blob(mime_type=mime_type, data=raw_bytes)
                                for sess in (mirror_session, current_session):
                                    if sess is None:
                                        continue
                                    try:
                                        if "audio" in mime_type:
                                            await sess.send_realtime_input(audio=blob)
                                        elif "image" in mime_type or "video" in mime_type:
                                            await sess.send_realtime_input(video=blob)
                                        else:
                                            await sess.send_realtime_input(media=blob)
                                    except Exception:
                                        pass
                        continue
                    text = (payload.get("text") or "").strip()
                    if not text:
                        continue
                    if msg_type == "narrate":
                        if current_session is not None:
                            try:
                                await current_session.send_realtime_input(
                                    text=f"[NARRATION CUE]: Say exactly: \"{text}\""
                                )
                            except Exception:
                                pass
                        else:
                            pending_narrations.append(text)
                        continue
                    if msg_type != "text":
                        continue
                    workflow_cmd = detect_voice_workflow_command(text)
                    if workflow_cmd:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "voiceWorkflowCommand": workflow_cmd,
                                    "author": AUTHOR,
                                }
                            )
                        )
                    decision = detect_voice_decision(text)
                    if decision:
                        res = await on_voice_decision(decision, f"Gemini 3.8 Live Text ('{text}')")
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "voiceDecision": {
                                        "decision": decision,
                                        "status": res.get("status"),
                                        "runId": res.get("run_id"),
                                    },
                                    "author": AUTHOR,
                                }
                            )
                        )
                    if current_session is not None:
                        try:
                            await current_session.send_realtime_input(text=text)
                        except Exception:
                            pass
        except WebSocketDisconnect:
            return

    async def session_loop() -> None:
        nonlocal current_session, mirror_session, intro_announced
        active_model = setup.model

        def _build_config() -> types.LiveConnectConfig:
            return types.LiveConnectConfig(
                response_modalities=[types.Modality.AUDIO],
                media_resolution=types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
                context_window_compression=types.ContextWindowCompressionConfig(
                    trigger_tokens=25600,
                    sliding_window=types.SlidingWindow(target_tokens=12800),
                ),
                input_audio_transcription=types.AudioTranscriptionConfig(),
                output_audio_transcription=types.AudioTranscriptionConfig(),
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=setup.voice)
                    )
                ),
                system_instruction=types.Content(parts=[types.Part(text=system_instruction)]),
            )

        next_ready = asyncio.Event()
        next_session_ref: list[Any] = [None]
        next_conn_ref: list[Any] = [None]
        open_pending = False
        pending_preroll = b""

        async def _open_next() -> None:
            try:
                cfg = _build_config()
                conn = client.aio.live.connect(model=active_model, config=cfg)
                sess = await conn.__aenter__()
                next_session_ref[0] = sess
                next_conn_ref[0] = conn
            except Exception:
                logger.warning("Failed to pre-open replacement Gemini Live session", exc_info=True)
            next_ready.set()

        def _cleanup_next() -> None:
            next_ready.clear()
            if next_conn_ref[0] is not None:
                conn = next_conn_ref[0]
                next_conn_ref[0] = None
                next_session_ref[0] = None
                asyncio.create_task(conn.__aexit__(None, None, None))

        retry_backoff = RETRY_BACKOFF_INIT
        while True:
            conn = None
            open_next_task = None
            error_cleanup = False
            try:
                if open_pending:
                    await next_ready.wait()
                    next_ready.clear()
                    open_pending = False

                if next_session_ref[0] is not None:
                    session = next_session_ref[0]
                    conn = next_conn_ref[0]
                    next_session_ref[0] = None
                    next_conn_ref[0] = None
                    mirror_session = None
                else:
                    cfg = _build_config()
                    try:
                        conn = client.aio.live.connect(model=active_model, config=cfg)
                        session = await asyncio.wait_for(
                            conn.__aenter__(), timeout=CONNECT_TIMEOUT_SEC
                        )
                    except Exception:
                        if active_model != GEMINI_LIVE_FALLBACK_MODEL:
                            logger.info(
                                "Model %s unavailable; falling back to %s",
                                active_model,
                                GEMINI_LIVE_FALLBACK_MODEL,
                            )
                            active_model = GEMINI_LIVE_FALLBACK_MODEL
                            conn = client.aio.live.connect(model=active_model, config=cfg)
                            session = await asyncio.wait_for(
                                conn.__aenter__(), timeout=CONNECT_TIMEOUT_SEC
                            )
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "type": "sessionReady",
                                        "sessionId": session_id,
                                        "model": setup.model,
                                        "upstreamModel": active_model,
                                        "voice": setup.voice,
                                        "mode": "GEMINI_LIVE_UPSTREAM",
                                        "author": AUTHOR,
                                    }
                                )
                            )
                        else:
                            raise

                if pending_preroll:
                    await _send_audio(session, pending_preroll)
                    pending_preroll = b""

                current_session = session
                if not intro_announced and setup.narration_enabled:
                    intro_announced = True
                    try:
                        await session.send_realtime_input(
                            text='[NARRATION CUE]: Say exactly: "Mission Control system active."'
                        )
                    except Exception:
                        pass
                while pending_narrations:
                    queued_cue = pending_narrations.popleft()
                    try:
                        await session.send_realtime_input(
                            text=f'[NARRATION CUE]: Say exactly: "{queued_cue}"'
                        )
                    except Exception:
                        pass
                retry_backoff = RETRY_BACKOFF_INIT
                go_away_event = asyncio.Event()
                go_away_secs: float = 30.0
                loop = asyncio.get_running_loop()
                last_relay_at = loop.time()
                answered_out = False

                async def _relay_session() -> None:
                    nonlocal last_relay_at, answered_out, go_away_secs
                    while True:
                        saw_message = False
                        async for msg in session.receive():
                            saw_message = True
                            if msg.go_away is not None:
                                tl = msg.go_away.time_left or "30s"
                                go_away_secs = int(tl.rstrip("s")) if tl.endswith("s") else 30.0
                                go_away_event.set()
                                continue
                            envelope = _envelope_from(msg)
                            if envelope is None:
                                continue

                            it = envelope.get("inputTranscription")
                            if it and it.get("text"):
                                input_transcript_buffer.append(it["text"])
                                joined_input = "".join(input_transcript_buffer)
                                workflow_cmd = detect_voice_workflow_command(joined_input)
                                if workflow_cmd:
                                    input_transcript_buffer.clear()
                                    envelope["voiceWorkflowCommand"] = workflow_cmd
                                decision = detect_voice_decision(joined_input)
                                if decision:
                                    input_transcript_buffer.clear()
                                    res = await on_voice_decision(
                                        decision, f"Gemini 3.8 Live Audio ('{joined_input.strip()}')"
                                    )
                                    envelope["voiceDecision"] = {
                                        "decision": decision,
                                        "status": res.get("status"),
                                        "runId": res.get("run_id"),
                                    }
                                elif it.get("finished"):
                                    input_transcript_buffer.clear()

                            ot = envelope.get("outputTranscription")
                            if ot and ot.get("text"):
                                output_transcript_buffer.append(ot["text"])
                                joined_output = "".join(output_transcript_buffer)
                                model_decision = detect_model_confirmation_decision(joined_output)
                                if model_decision and "voiceDecision" not in envelope:
                                    output_transcript_buffer.clear()
                                    res = await on_voice_decision(
                                        model_decision,
                                        f"Gemini 3.8 Live Model Confirmation ('{joined_output.strip()}')",
                                    )
                                    if res.get("status") == "resumed":
                                        envelope["voiceDecision"] = {
                                            "decision": model_decision,
                                            "status": res.get("status"),
                                            "runId": res.get("run_id"),
                                        }
                                elif ot.get("finished"):
                                    output_transcript_buffer.clear()

                            if envelope.get("turnComplete"):
                                input_transcript_buffer.clear()
                                output_transcript_buffer.clear()

                            await websocket.send_text(json.dumps(envelope))
                            last_relay_at = loop.time()
                            if go_away_event.is_set():
                                sc = msg.server_content
                                if sc and sc.turn_complete:
                                    answered_out = True
                                    return
                        if not saw_message:
                            return

                async def _drain_silent() -> None:
                    while True:
                        quiet = loop.time() - last_relay_at
                        if quiet >= GOAWAY_IDLE_GRACE_SEC:
                            return
                        await asyncio.sleep(GOAWAY_IDLE_GRACE_SEC - quiet)

                async def _mirror_when_stalled() -> None:
                    nonlocal mirror_session
                    while True:
                        quiet = loop.time() - last_relay_at
                        if quiet >= DRAIN_MIRROR_QUIET_SEC:
                            break
                        await asyncio.sleep(DRAIN_MIRROR_QUIET_SEC - quiet)
                    await next_ready.wait()
                    sess = next_session_ref[0]
                    if sess is None:
                        return
                    cut = last_relay_at
                    while True:
                        pending = [(ts, f) for ts, f in recent_audio if ts >= cut]
                        if not pending:
                            break
                        cut = pending[-1][0] + 1e-6
                        blob = b"".join(f for _, f in pending)
                        await _send_audio(sess, blob)
                    mirror_session = sess

                relay_task = asyncio.create_task(_relay_session())
                go_away_wait = asyncio.create_task(go_away_event.wait())
                done, _ = await asyncio.wait(
                    {relay_task, go_away_wait}, return_when=asyncio.FIRST_COMPLETED
                )
                if go_away_wait in done and relay_task not in done:
                    next_ready.clear()
                    open_next_task = asyncio.create_task(_open_next())
                    open_pending = True
                    silent_task = asyncio.create_task(_drain_silent())
                    mirror_task = asyncio.create_task(_mirror_when_stalled())
                    try:
                        drained, _ = await asyncio.wait(
                            {relay_task, silent_task},
                            timeout=go_away_secs,
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                    finally:
                        silent_task.cancel()
                        mirror_task.cancel()
                    if relay_task in drained:
                        if answered_out and mirror_session is not None:
                            mirror_session = None
                            _cleanup_next()
                            open_pending = False
                    else:
                        relay_task.cancel()
                        try:
                            await relay_task
                        except asyncio.CancelledError:
                            pass
                        if mirror_session is None:
                            pending_preroll = _audio_since(last_relay_at)
                        try:
                            await websocket.send_text(
                                json.dumps({"turnComplete": True, "author": AUTHOR})
                            )
                        except Exception:
                            pass
                else:
                    go_away_wait.cancel()
                    if relay_task.done() and relay_task.exception():
                        raise relay_task.exception()
            except WebSocketDisconnect:
                error_cleanup = True
                raise
            except Exception as exc:
                error_cleanup = True
                logger.warning("Gemini Live session loop error: %s", exc, exc_info=True)
                try:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "serverError",
                                "error": str(exc),
                                "author": AUTHOR,
                            }
                        )
                    )
                except Exception:
                    pass
                await asyncio.sleep(retry_backoff)
                retry_backoff = min(retry_backoff * 2, RETRY_BACKOFF_MAX)
            finally:
                current_session = None
                if conn is not None:
                    try:
                        await conn.__aexit__(None, None, None)
                    except Exception:
                        pass
                if error_cleanup:
                    if open_next_task and not open_next_task.done():
                        open_next_task.cancel()
                    mirror_session = None
                    _cleanup_next()
                    open_pending = False

    up = asyncio.create_task(upstream_task())
    loop_task = asyncio.create_task(session_loop())
    done, pending = await asyncio.wait({up, loop_task}, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
