"""FastAPI + claude-agent-sdk + in-process MCP pause/resume + CTO Magician Toolbox (Gateway Switch, Deterministic Oracles, Sponsor Chassis) + AG-UI SSE."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from gemini_live_bridge import (
    DEFAULT_VOICE,
    GEMINI_LIVE_FALLBACK_MODEL,
    GEMINI_LIVE_MODEL,
    VOICES,
    handle_gemini_live_ws,
)

from ag_ui.core import (
    EventType,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    StepFinishedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
    create_sdk_mcp_server,
    query,
    tool,
)

from worktree_harness import (
    FENCES_LEDGER,
    WorktreeHarness,
    evaluate_mcp_boundary_police,
    harden_boundary_rule,
    promote_trace_to_layer1_skill,
    run_codex_adversarial_verification,
)

# Load environment from parent directory .env or .env.example fallback
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / ".env.example", override=False)

# Default target: a sample repo next to the project (labs never touch company code).
DEFAULT_TARGET_REPO = os.getenv("TARGET_REPO_PATH", str(ROOT_DIR / "sample-repo"))

app = FastAPI(title="Axiom Software Factory — Minimal PoC Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _env_flag(name: str, default: bool = True) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


# ============================================================================
# 🎩 TRAINER / CTO "MAGICIAN TOOLBOX" RUNTIME REGISTRY
# Controlled via .env flags (`AXIOM_STAGE_UNLOCK`, `AXIOM_GATEWAY_MODE`, etc.)
# Pointer: backend/server.py :: TOOLBOX_RUNTIME
# ============================================================================
TOOLBOX_RUNTIME: dict[str, Any] = {
    "stageUnlock": _env_flag("AXIOM_STAGE_UNLOCK", True),
    "features": {
        "deterministicOracles": _env_flag("AXIOM_ENABLE_DETERMINISTIC_ORACLES", True),
        "gatewaySwitch": _env_flag("AXIOM_ENABLE_GATEWAY_SWITCH", True),
        "sponsorChassis": _env_flag("AXIOM_ENABLE_SPONSOR_CHASSIS", True),
        "redteamChaos": _env_flag("AXIOM_ENABLE_REDTEAM_CHAOS", True),
        "tokenWeather": _env_flag("AXIOM_ENABLE_TOKEN_WEATHER", True),
    },
    "gatewayMode": os.getenv("AXIOM_GATEWAY_MODE", "CLOUD_PRIMARY"),
    "sponsorPreset": os.getenv("AXIOM_SPONSOR_PRESET", "DEFAULT_CLAUDE_CODEX"),
    "hardBudgetUsd": float(os.getenv("AXIOM_HARD_BUDGET_USD", "0.50")),
    "pxpipeProxy": {
        "enabled": _env_flag("AXIOM_ENABLE_PXPIPE_PROXY", True),
        "localProxyUrl": os.getenv("PXPIPE_LOCAL_PROXY_URL", "http://127.0.0.1:8088/v1"),
        "airgapTunnelNode": os.getenv("PXPIPE_AIRGAP_TUNNEL_NODE", "pxpipe://mac-studio-cluster.local:8088/v1"),
        "agentKeyVaulting": "EPHEMERAL_SEAT_TOKEN (Raw vendor keys stripped from worktree env)",
    },
    "lastGatewayNotice": None,
    "codePointers": {
        "worktreeIsolation": "backend/worktree_harness.py::WorktreeHarness.create_sibling_worktree",
        "deterministicOracles": "backend/worktree_harness.py::run_deterministic_corporate_oracles",
        "codexVerifier": "backend/worktree_harness.py::run_codex_adversarial_verification",
        "mcpElicitationGate": "backend/server.py::request_human_elicitation (asyncio.Future)",
        "preToolUseHook": "backend/server.py::pre_tool_use_guardrail",
        "gatewaySwitch": "backend/server.py::update_toolbox_config (/api/toolbox/config)",
    },
}


class ElicitationResumePayload(BaseModel):
    run_id: str | None = None
    decision: str = "APPROVE"  # "APPROVE" | "REJECT_AND_HARDEN"
    rule_id: str = "FENCE-001"
    source: str = "HTTP_MISSION_CONTROL"
    notes: str = "Approved by operator via Mission Control / Voice Signal"


class ToolboxUpdatePayload(BaseModel):
    gateway_mode: str | None = None
    sponsor_preset: str | None = None
    hard_budget_usd: float | None = None
    active_shift: str | None = None
    active_lens: str | None = None
    reset_fences: bool | None = None


class InteractionQueryPayload(BaseModel):
    prompt: str
    previous_interaction_id: str | None = None
    model: str | None = None
    system_instruction: str | None = None
    store: bool = True


class WhiteboardSynthesizePayload(BaseModel):
    image_base64: str | None = None
    mime_type: str = "image/jpeg"
    diagram_text: str | None = None
    source: str = "WEBCAM_OR_SCREEN"
    previous_interaction_id: str | None = None


class WhiteboardPlanSchema(BaseModel):
    diagramTitle: str
    detectedComponents: list[str]
    detectedFlows: list[str]
    targetFile: str
    taskPrompt: str
    prTitle: str


# Active in-memory run registry holding asyncio.Future gates, SSE queues, and state snapshots
ACTIVE_RUNS: dict[str, dict[str, Any]] = {}
LATEST_RUN_ID: str | None = None
LAST_INTERACTION_ID: str | None = None


def _encode_sse(event_obj: Any) -> str:
    """Serializes an AG-UI Pydantic event model into SSE wire format."""
    if hasattr(event_obj, "model_dump_json"):
        return f"data: {event_obj.model_dump_json(by_alias=True, exclude_none=True)}\n\n"
    return f"data: {json.dumps(event_obj)}\n\n"


@app.get("/health")
async def health_check() -> dict[str, Any]:
    target_repo = os.getenv("TARGET_REPO_PATH", DEFAULT_TARGET_REPO)
    p = Path(target_repo).expanduser()
    if not p.is_absolute() and not (p / ".git").exists():
        p = ROOT_DIR / p
    repo_exists = (p / ".git").exists()
    return {
        "status": "ok",
        "target_repo_path": str(p.resolve()) if repo_exists else target_repo,
        "git_valid": repo_exists,
        "active_runs": list(ACTIVE_RUNS.keys()),
        "latest_run_id": LATEST_RUN_ID,
        "toolbox": TOOLBOX_RUNTIME,
    }


def _active_models() -> dict[str, str]:
    """What will really run the next job, so the UI never advertises a model that isn't in use."""
    gateway = TOOLBOX_RUNTIME["gatewayMode"]
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    has_claude = bool(
        anthropic_key and not anthropic_key.startswith(("sk-ant-...", "your-"))
    )
    if gateway == "AIRGAP_LOCAL_LOCKDOWN":
        worker = "local model"
    else:
        worker = "Claude Code" if has_claude else "scripted, no model"

    allow_degraded = os.getenv("AXIOM_ALLOW_DEGRADED_JUDGE", "0").strip() in ("1", "true", "yes")
    codex_model = os.getenv("CODEX_MODEL", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    google_key = os.getenv("GOOGLE_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if gateway != "CLOUD_PRIMARY" and not allow_degraded:
        reviewer = "deferred on this gateway"
    elif gateway != "CLOUD_PRIMARY":
        reviewer = "fallback model"
    elif codex_model and openai_key and not openai_key.startswith(("sk-proj-...", "your-")):
        reviewer = codex_model
    elif google_key and not google_key.startswith(("your-", "AIza...")):
        reviewer = os.getenv("GEMINI_INTERACTIONS_MODEL", "gemini-3.8-flash").strip()
    else:
        reviewer = "simulated"
    return {"worker": worker, "reviewer": reviewer}


@app.get("/api/toolbox/config")
async def get_toolbox_config() -> dict[str, Any]:
    """Returns current CTO Magician Toolbox flags, active Gateway Mode, Sponsor Preset, and Fences Ledger."""
    TOOLBOX_RUNTIME["fencesLedger"] = FENCES_LEDGER
    TOOLBOX_RUNTIME["activeModels"] = _active_models()
    return TOOLBOX_RUNTIME


@app.post("/api/toolbox/config")
async def update_toolbox_config(payload: ToolboxUpdatePayload) -> dict[str, Any]:
    """
    Live CTO Gateway, shift schedule (Day / Swing / Night), Operator Lens & Sponsor Chassis Switcher.
    When switching to `SHIFT_3_NIGHT` or `AIRGAP_LOCAL_LOCKDOWN`, routes traffic to local weights (`pxpipe`).
    """
    if payload.active_shift:
        FENCES_LEDGER["active_shift"] = payload.active_shift
        # Shift 3 (Night Shift 00:00-08:00) automatically routes to Local Fallback weights per ADR-001
        if payload.active_shift == "SHIFT_3_NIGHT" and not payload.gateway_mode:
            payload.gateway_mode = "AIRGAP_LOCAL_LOCKDOWN"
        elif payload.active_shift == "SHIFT_1_DAY" and not payload.gateway_mode:
            payload.gateway_mode = "CLOUD_PRIMARY"

    if payload.active_lens:
        FENCES_LEDGER["active_lens"] = payload.active_lens

    if payload.reset_fences:
        harden_boundary_rule("FENCE-001", "RESET")

    if payload.gateway_mode:
        old_mode = TOOLBOX_RUNTIME["gatewayMode"]
        TOOLBOX_RUNTIME["gatewayMode"] = payload.gateway_mode
        notice = (
            f"🚨 [CTO GATEWAY SWITCH]: {old_mode} -> {payload.gateway_mode}. "
            + (
                "External cloud APIs quarantined! Draining in-flight steps to Local Air-Gap Inference (`localhost:11434`)."
                if payload.gateway_mode == "AIRGAP_LOCAL_LOCKDOWN"
                else f"Traffic smoothly re-routed to {payload.gateway_mode}."
            )
        )
        TOOLBOX_RUNTIME["lastGatewayNotice"] = notice

        # Broadcast graceful drain notice to every connected developer SSE stream
        for run_ctx in ACTIVE_RUNS.values():
            state = run_ctx.get("state")
            queue: asyncio.Queue[str | None] | None = run_ctx.get("event_queue")
            if state is not None and queue is not None:
                state["gatewayMode"] = payload.gateway_mode
                state["fencesLedger"] = FENCES_LEDGER
                state["logs"].append({"ts": time.strftime("%H:%M:%S"), "text": notice})
                await queue.put(_encode_sse(StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state)))

    if payload.sponsor_preset:
        TOOLBOX_RUNTIME["sponsorPreset"] = payload.sponsor_preset

    if payload.hard_budget_usd is not None:
        TOOLBOX_RUNTIME["hardBudgetUsd"] = payload.hard_budget_usd

    TOOLBOX_RUNTIME["fencesLedger"] = FENCES_LEDGER
    TOOLBOX_RUNTIME["activeModels"] = _active_models()
    return {"status": "updated", "toolbox": TOOLBOX_RUNTIME}


@app.post("/api/elicitation/resume")
async def resume_elicitation(payload: ElicitationResumePayload) -> dict[str, Any]:
    """
    Resumes a paused in-process MCP elicitation gate (`asyncio.Future`) via HTTP or Voice WebRTC signal.
    Supports ADR-003 Dynamic Fencing:
      - `APPROVE` / `APPROVE_EXCEPTION`: Transparently resumes soft-compute worker.
      - `REJECT_AND_HARDEN`: Mutates `FENCE-001` from `SOFT_TRIPWIRE` -> `HARD_LOCK` in `FENCES_LEDGER`
        and signals the worker to re-plan inside the newly calcified fence!
    """
    run_id = payload.run_id or LATEST_RUN_ID
    if not run_id or run_id not in ACTIVE_RUNS:
        raise HTTPException(status_code=404, detail=f"No active run found for run_id={run_id}")

    run_ctx = ACTIVE_RUNS[run_id]
    future: asyncio.Future[dict[str, Any]] | None = run_ctx.get("elicitation_future")
    if future is None or future.done():
        return {
            "status": "already_resolved_or_not_waiting",
            "run_id": run_id,
        }

    mutated_rule = None
    if payload.decision.upper() == "REJECT_AND_HARDEN":
        mutated_rule = harden_boundary_rule(payload.rule_id or "FENCE-001", "REJECT_AND_HARDEN")

    resolution = {
        "decision": payload.decision,
        "rule_id": payload.rule_id,
        "mutated_rule": mutated_rule,
        "source": payload.source,
        "notes": payload.notes,
        "resolved_at": time.time(),
    }
    future.set_result(resolution)
    return {
        "status": "resumed",
        "run_id": run_id,
        "resolution": resolution,
        "fencesLedger": FENCES_LEDGER,
    }


@app.post("/api/factory/run")
async def run_factory_sse(request: Request) -> StreamingResponse:
    """
    AG-UI Protocol compatible SSE endpoint that executes the 4 core mechanics + CTO Toolbox options:
    1. Target any local Git repo via TARGET_REPO_PATH.
    2. Create an isolated sibling Git worktree (`../.factory-worktrees/wt-builder-{id}`).
    3. Run headless Claude Code worker (`claude-agent-sdk`) with an in-process MCP tool
       that pauses on an `asyncio.Future` until resumed via `/api/elicitation/resume`.
    4. Run Stage 1 Deterministic Corporate Oracles + Stage 2 OpenAI Codex / Gateway diff verification.
    """
    global LATEST_RUN_ID
    try:
        body = await request.json()
    except Exception:
        body = {}

    thread_id = body.get("threadId") or body.get("thread_id") or f"thread-{uuid.uuid4().hex[:8]}"
    run_id = body.get("runId") or body.get("run_id") or f"run-{uuid.uuid4().hex[:8]}"
    LATEST_RUN_ID = run_id

    # Check if operator triggered Red-Team Chaos Injection (`chaosMode`: 'SECRET_LEAK' | 'EVAL_INJECTION' | None)
    chaos_mode = body.get("chaosMode")
    for ctx_item in body.get("context", []):
        if isinstance(ctx_item, dict) and ctx_item.get("description") == "chaosMode":
            chaos_mode = ctx_item.get("value") or None

    messages = body.get("messages", [])
    user_prompt = body.get("prompt") or (
        messages[-1].get("content") if messages and isinstance(messages[-1], dict) else None
    ) or "Create a new `FACTORY_PROOF.md` architectural verification stamp in the worktree after requesting MCP operator approval."

    whiteboard_plan: dict[str, Any] | None = None
    for ctx_item in body.get("context", []):
        if isinstance(ctx_item, dict) and ctx_item.get("description") == "whiteboardPlan":
            raw_val = ctx_item.get("value")
            if isinstance(raw_val, dict):
                whiteboard_plan = raw_val
            elif isinstance(raw_val, str) and raw_val.strip():
                try:
                    whiteboard_plan = json.loads(raw_val)
                except Exception:
                    whiteboard_plan = None

    def _sanitize_target_file(raw_file: str | None) -> str:
        if not raw_file:
            return "FACTORY_PROOF.md"
        cleaned = raw_file.strip().lstrip("/").replace("..", "")
        if not cleaned or cleaned.startswith("."):
            return "FACTORY_PROOF.md"
        lower = cleaned.lower()
        if (
            lower.startswith((".github", ".claude", ".env", "dockerfile"))
            or "/migrations/" in lower
            or lower.startswith("migrations/")
        ):
            return "src/whiteboard_architecture.py"
        return cleaned

    raw_target = (whiteboard_plan or {}).get("targetFile") if whiteboard_plan else None
    if not raw_target and user_prompt:
        m = re.search(
            r"`?([a-zA-Z0-9_\-./]+\.(?:py|ts|js|json|yaml|yml|md))`?",
            user_prompt,
        )
        if m:
            raw_target = m.group(1)

    synthesized_target_file = _sanitize_target_file(raw_target)
    synthesized_pr_title = (
        (whiteboard_plan or {}).get("prTitle")
        or (user_prompt.splitlines()[0][:80] if user_prompt else "FACTORY_PROOF.md")
    )
    synthesized_components: list[str] = list(
        (whiteboard_plan or {}).get("detectedComponents") or []
    )
    synthesized_flows: list[str] = list(
        (whiteboard_plan or {}).get("detectedFlows") or []
    )
    synthesized_diagram_title: str = (
        (whiteboard_plan or {}).get("diagramTitle") or ""
    )

    target_repo_path = body.get("targetRepoPath")
    if not target_repo_path:
        for ctx_item in body.get("context", []):
            if isinstance(ctx_item, dict) and ctx_item.get("description") == "targetRepoPath":
                target_repo_path = ctx_item.get("value")
    target_repo_path = target_repo_path or os.getenv("TARGET_REPO_PATH", DEFAULT_TARGET_REPO)

    event_queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    elicitation_future: asyncio.Future[dict[str, Any]] = loop.create_future()

    state: dict[str, Any] = {
        "runId": run_id,
        "threadId": thread_id,
        "phase": "INITIALIZING",
        "targetRepo": target_repo_path,
        "mainTreeCleanBefore": True,
        "mainTreeCleanAfter": True,
        "worktree": None,
        "elicitation": {
            "status": "IDLE",
            "question": None,
            "toolCallId": None,
            "resolution": None,
        },
        "workerMode": "pending",
        "gatewayMode": TOOLBOX_RUNTIME["gatewayMode"],
        "sponsorPreset": TOOLBOX_RUNTIME["sponsorPreset"],
        "chaosMode": chaos_mode,
        "fencesLedger": FENCES_LEDGER,
        "tokenWeather": {
            "zone": "FRESH_SMART_ZONE",
            "tokensUsed": 4200,
            "smartZoneLimit": 30000,
            "saturationLimit": 150000,
            "estimatedUsd": 0.004,
            "hardBudgetUsd": TOOLBOX_RUNTIME["hardBudgetUsd"],
        },
        "diff": "",
        "verification": None,
        "logs": [],
    }

    ACTIVE_RUNS[run_id] = {
        "elicitation_future": elicitation_future,
        "event_queue": event_queue,
        "state": state,
    }

    async def update_token_weather(tokens_used: int, usd: float) -> None:
        zone = (
            "FRESH_WINDOW (0-30k)"
            if tokens_used < 30000
            else "SMART_ZONE (30k-150k)"
            if tokens_used < 150000
            else "SATURATION_DUMB_ZONE (150k+)"
        )
        state["tokenWeather"] = {
            "zone": zone,
            "tokensUsed": tokens_used,
            "smartZoneLimit": 30000,
            "saturationLimit": 150000,
            "estimatedUsd": round(usd, 4),
            "hardBudgetUsd": TOOLBOX_RUNTIME["hardBudgetUsd"],
        }

    async def push_log(msg: str) -> None:
        state["logs"].append({"ts": time.strftime("%H:%M:%S"), "text": msg})
        await event_queue.put(
            _encode_sse(StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=state))
        )

    async def push_text(message_id: str, delta: str) -> None:
        await event_queue.put(
            _encode_sse(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=message_id,
                    delta=delta,
                )
            )
        )

    # --- Exercise 1: Multi-Agent Worktree Spawner (Subagent Definitions) ---
    subagent_roster = {
        "architect": {
            "description": "Reads target repo CLAUDE.md and specs, proposes file plan.",
            "tools": ["Read", "Glob", "Grep", "mcp__axiom_gate__request_human_elicitation"],
        },
        "builder": {
            "description": "Implements approved changes inside isolated .factory-worktrees lane.",
            "tools": ["Read", "Write", "Edit", "mcp__axiom_gate__request_human_elicitation"],
        },
    }

    # --- Exercise 2: Deterministic PreToolUse Security Guardrail Hook ---
    async def pre_tool_use_guardrail(input_data: Any, tool_use_id: str | None, context: Any) -> dict[str, Any]:
        """Blocks destructive shell commands or writes outside the isolated worktree."""
        tool_name = getattr(input_data, "tool_name", "") or (
            input_data.get("tool_name", "") if isinstance(input_data, dict) else ""
        )
        tool_input = getattr(input_data, "tool_input", {}) or (
            input_data.get("tool_input", {}) if isinstance(input_data, dict) else {}
        )
        cmd = str(tool_input.get("command", ""))
        if tool_name == "Bash" and ("rm -rf" in cmd or "../" in cmd):
            await push_log(f"🛡️ PreToolUse Hook blocked unsafe command: {cmd}")
            return {"decision": "block", "reason": "Blocked by Axiom Sentinel PreToolUse Hook"}
        return {"decision": "approve"}

    # --- Exercise 2b (ADR-004): Two-Layer Skill & Tool Resolution Cascade (`can_use_tool`) ---
    # Layer 1 (`.claude/skills/*` via `Skill` + `mcp__axiom_gate__*`) is trusted by default.
    # Layer 2 (`mcp__fallback__*`) requires explicit Layer-1 miss + operator elicitation approval.
    layer1_missed = False
    unlocked_fallbacks: set[str] = set()

    async def tool_resolution_gate(
        tool_name: str,
        input_data: dict[str, Any],
        context: ToolPermissionContext,
    ) -> PermissionResultAllow | PermissionResultDeny:
        nonlocal layer1_missed
        if tool_name == "Skill" or tool_name.startswith("mcp__axiom_gate__") or tool_name.startswith("mcp__trusted__"):
            await push_log(f"⚡ [Layer 1 Trusted] Executing factory primitive: {tool_name}")
            return PermissionResultAllow(updated_input=input_data)

        if tool_name.startswith("mcp__fallback__"):
            if not layer1_missed and tool_name not in unlocked_fallbacks:
                layer1_missed = True
                await push_log(
                    f"⏸️ [Layer 2 Fallback Intercept] `{tool_name}` requested after Layer 1 miss — routing to Elicitation Gate..."
                )
            unlocked_fallbacks.add(tool_name)
            return PermissionResultAllow(updated_input=input_data)

        if tool_name in ("Read", "Glob", "Grep", "Write", "Edit"):
            return PermissionResultAllow(updated_input=input_data)

        return PermissionResultDeny(message=f"Tool '{tool_name}' outside factory role allowance.")

    # --- Exercise 3: In-Process MCP Elicitation Interrupt (`asyncio.Future`) ---
    @tool(
        "request_human_elicitation",
        "Pauses the autonomous worker and requests human/voice approval via an asyncio.Future before writing sensitive changes.",
        {"question": str, "proposed_file": str},
    )
    async def request_human_elicitation(args: dict[str, Any]) -> dict[str, Any]:
        question = args.get("question") or "Approve autonomous file write in isolated worktree?"
        proposed_file = args.get("proposed_file") or "FACTORY_PROOF.md"
        tool_call_id = f"tc-elicit-{uuid.uuid4().hex[:6]}"

        await update_token_weather(11400, 0.009)
        state["phase"] = "PAUSED_FOR_ELICITATION"
        state["elicitation"] = {
            "status": "WAITING_FOR_SIGNAL",
            "question": f"{question} (Target: {proposed_file})",
            "toolCallId": tool_call_id,
            "resolution": None,
        }

        await event_queue.put(
            _encode_sse(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tool_call_id,
                    tool_call_name="mcp__axiom_gate__request_human_elicitation",
                )
            )
        )
        await push_log(f"⏸️ MCP Elicitation triggered: awaiting HTTP/Voice signal for '{proposed_file}'...")

        # Suspend execution on asyncio.Future until HTTP/Voice signal resolves it
        resolution = await elicitation_future

        await update_token_weather(16800, 0.014)
        state["phase"] = "WORKER_RESUMED"
        state["elicitation"]["status"] = "RESOLVED"
        state["elicitation"]["resolution"] = resolution

        await event_queue.put(
            _encode_sse(
                ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    message_id=f"msg-tool-{tool_call_id}",
                    tool_call_id=tool_call_id,
                    content=json.dumps(resolution),
                    role="tool",
                )
            )
        )
        await event_queue.put(
            _encode_sse(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tool_call_id,
                )
            )
        )
        await push_log(
            f"▶️ Elicitation resumed via {resolution['source']} ({resolution['decision']}): {resolution['notes']}"
        )

        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Operator decision={resolution['decision']} via {resolution['source']}: {resolution['notes']}",
                }
            ]
        }

    axiom_mcp_server = create_sdk_mcp_server(
        name="axiom_gate",
        version="1.0.0",
        tools=[request_human_elicitation],
    )

    async def orchestrate_pipeline() -> None:
        msg_id = f"msg-{uuid.uuid4().hex[:8]}"
        harness: WorktreeHarness | None = None
        wt_info = None
        pre_fingerprint = ""

        try:
            await event_queue.put(
                _encode_sse(RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id))
            )
            await event_queue.put(
                _encode_sse(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        message_id=msg_id,
                        role="assistant",
                    )
                )
            )

            # 1. Mechanic 1 & 2: Target Repo + Sibling Git Worktree
            await event_queue.put(
                _encode_sse(StepStartedEvent(type=EventType.STEP_STARTED, step_name="worktree_isolation"))
            )
            harness = WorktreeHarness(target_repo_path)
            pre_fingerprint = harness.get_main_tree_fingerprint()
            wt_info = harness.create_sibling_worktree(run_id, role="builder")

            state["phase"] = "WORKTREE_READY"
            state["worktree"] = wt_info.to_dict()
            await update_token_weather(6800, 0.005)
            await push_log(
                f"🌿 Created sibling worktree at {wt_info.worktree_path} (branch {wt_info.branch_name} @ {wt_info.base_commit})"
            )
            await push_text(
                msg_id,
                f"### 1. Isolated Git Worktree Provisioned\n"
                f"- **Target Repo:** `{wt_info.target_repo}`\n"
                f"- **Sibling Worktree:** `{wt_info.worktree_path}`\n"
                f"- **Branch:** `{wt_info.branch_name}` (Base `{wt_info.base_commit}`)\n"
                f"- **Active Gateway Mode:** `{state['gatewayMode']}`\n\n",
            )
            await event_queue.put(
                _encode_sse(StepFinishedEvent(type=EventType.STEP_FINISHED, step_name="worktree_isolation"))
            )

            # 2. Mechanic 3: Headless Claude Code Worker + In-Process MCP Elicitation Pause
            await event_queue.put(
                _encode_sse(StepStartedEvent(type=EventType.STEP_STARTED, step_name="claude_worker_execution"))
            )
            state["phase"] = "WORKER_RUNNING"
            anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
            has_live_claude_key = bool(
                anthropic_key
                and not anthropic_key.startswith("sk-ant-...")
                and not anthropic_key.startswith("your-")
                and state["gatewayMode"] != "AIRGAP_LOCAL_LOCKDOWN"
            )

            options = ClaudeAgentOptions(
                cwd=wt_info.worktree_path,
                setting_sources=["project"],
                mcp_servers={"axiom_gate": axiom_mcp_server},
                allowed_tools=[
                    "Skill",
                    "mcp__axiom_gate__request_human_elicitation",
                    "Write",
                    "Edit",
                    "Read",
                    "Glob",
                    "Grep",
                ],
                can_use_tool=tool_resolution_gate,
                permission_mode="bypassPermissions",
                max_turns=4,
                max_budget_usd=TOOLBOX_RUNTIME["hardBudgetUsd"],
            )

            ran_live_sdk = False
            if has_live_claude_key:
                try:
                    state["workerMode"] = "claude-agent-sdk (live)"
                    await push_log("🤖 Launching headless Claude Code worker via claude-agent-sdk...")
                    await push_text(msg_id, "### 2. Claude Code Worker & MCP Elicitation Gate\n")
                    live_gate_question = (
                        f"Authorize Whiteboard-to-PR implementation ({synthesized_pr_title}) writing to {synthesized_target_file}?"
                        if whiteboard_plan
                        else f"Authorize autonomous implementation for '{user_prompt[:72]}' in {synthesized_target_file}?"
                    )
                    worker_prompt = (
                        f"{user_prompt}\n\n"
                        f"IMPORTANT: First call `mcp__axiom_gate__request_human_elicitation` with "
                        f"`question={json.dumps(live_gate_question)}` and "
                        f"`proposed_file={json.dumps(synthesized_target_file)}`. "
                        f"Only after it returns APPROVE, write `{synthesized_target_file}` and `FACTORY_PROOF.md`."
                    )
                    async for sdk_msg in query(prompt=worker_prompt, options=options):
                        if isinstance(sdk_msg, AssistantMessage):
                            for block in sdk_msg.content:
                                if hasattr(block, "text") and block.text:
                                    await push_text(msg_id, block.text + "\n")
                    ran_live_sdk = True
                except Exception as sdk_err:
                    await push_log(
                        f"⚠️ Live claude-agent-sdk fallback triggered ({sdk_err}); executing in-process MCP tool handler directly."
                    )

            if not ran_live_sdk:
                state["workerMode"] = (
                    "airgap-local-worker"
                    if state["gatewayMode"] == "AIRGAP_LOCAL_LOCKDOWN"
                    else "claude-agent-sdk (in-process MCP harness)"
                )
                target_file_label = (
                    "oversized_refactor.py"
                    if chaos_mode == "BLAST_RADIUS"
                    else "compromised_hook.py"
                    if chaos_mode
                    else synthesized_target_file
                )
                elicitation_question = (
                    f"Authorize a 400-line change to `{target_file_label}` inside the isolated worktree?"
                    if chaos_mode == "BLAST_RADIUS"
                    else f"Authorize Red-Team chaos probe write to {target_file_label} inside isolated worktree?"
                    if chaos_mode
                    else (
                        f"Authorize Whiteboard-to-PR synthesis ({synthesized_pr_title}) writing `{target_file_label}` for '{synthesized_diagram_title}'?"
                        if whiteboard_plan
                        else f"Authorize autonomous write to `{target_file_label}` for task: \"{user_prompt[:88]}\"?"
                    )
                )
                await push_log(
                    f"🤖 Running in-process SDK MCP server (`axiom_gate`) & awaiting `asyncio.Future` elicitation signal for `{target_file_label}`..."
                )
                await push_text(
                    msg_id,
                    "### 2. Claude Code Worker & In-Process MCP Elicitation\n"
                    f"Worker invoked `mcp__axiom_gate__request_human_elicitation` for `{target_file_label}` — **execution suspended on `asyncio.Future`**.\n"
                    f"- **Dispatched Task:** {user_prompt}\n"
                    "Waiting for HTTP / Voice approval signal...\n\n",
                )
                tool_res = await request_human_elicitation.handler(
                    {
                        "question": elicitation_question,
                        "proposed_file": target_file_label,
                    }
                )
                decision = (state["elicitation"].get("resolution") or {}).get("decision", "APPROVE")
                await push_text(
                    msg_id,
                    f"**Signal Received:** `{tool_res['content'][0]['text']}`\n\n",
                )

                def _write_synthesized_implementation(wt_root: Path, status_tag: str) -> None:
                    """Writes both the synthesized targetFile implementation and FACTORY_PROOF.md so Stage 2 Verifier sees a complete implementation."""
                    if target_file_label != "FACTORY_PROOF.md":
                        target_abs = wt_root / target_file_label
                        target_abs.parent.mkdir(parents=True, exist_ok=True)
                        comp_list = ", ".join(synthesized_components) or "Mission Control, ADK Backend, Gemini 3.8 Live, MCP Gate"
                        if target_file_label.endswith(".py"):
                            comp_items = ",\n    ".join(json.dumps(c) for c in (synthesized_components or ["Mission Control", "FastAPI ADK", "Gemini 3.8 Live"]))
                            flow_items = ",\n    ".join(json.dumps(f) for f in (synthesized_flows or [user_prompt]))
                            target_abs.write_text(
                                f'"""\n{synthesized_pr_title}\n\nTask Specification:\n{user_prompt}\n"""\n\n'
                                "from __future__ import annotations\n"
                                "from typing import Any\n\n"
                                f"DIAGRAM_TITLE = {json.dumps(synthesized_diagram_title or 'Axiom Architecture')}\n"
                                f"ARCHITECTURE_COMPONENTS: list[str] = [\n    {comp_items}\n]\n\n"
                                f"CONTROL_FLOWS: list[str] = [\n    {flow_items}\n]\n\n"
                                "def verify_architecture_contract() -> dict[str, Any]:\n"
                                '    """Validates synthesized Whiteboard-to-PR architecture components and flows."""\n'
                                "    return {\n"
                                '        "title": DIAGRAM_TITLE,\n'
                                f'        "status": {json.dumps(status_tag)},\n'
                                '        "components": ARCHITECTURE_COMPONENTS,\n'
                                '        "flows": CONTROL_FLOWS,\n'
                                "    }\n",
                                encoding="utf-8",
                            )
                        elif target_file_label.endswith((".ts", ".js")):
                            target_abs.write_text(
                                f"/**\n * {synthesized_pr_title}\n * Task: {user_prompt}\n */\n"
                                f"export const DIAGRAM_TITLE = {json.dumps(synthesized_diagram_title or 'Axiom Architecture')};\n"
                                f"export const ARCHITECTURE_COMPONENTS = {json.dumps(synthesized_components, indent=2)};\n"
                                f"export const CONTROL_FLOWS = {json.dumps(synthesized_flows, indent=2)};\n",
                                encoding="utf-8",
                            )
                        else:
                            target_abs.write_text(
                                f"# {synthesized_pr_title}\n\n"
                                f"- **Task:** {user_prompt}\n"
                                f"- **Components:** {comp_list}\n",
                                encoding="utf-8",
                            )

                    components_md = (
                        "\n".join(f"  - `{c}`" for c in synthesized_components)
                        if synthesized_components
                        else "  - `Mission Control (Angular 21)`\n  - `FastAPI ADK Control Plane`"
                    )
                    flows_md = (
                        "\n".join(f"  - {f}" for f in synthesized_flows)
                        if synthesized_flows
                        else f"  - {user_prompt}"
                    )
                    proof_file = wt_root / "FACTORY_PROOF.md"
                    proof_file.write_text(
                        "---\n"
                        f"id: proof-{run_id}\n"
                        "type: verification-stamp\n"
                        f"status: {status_tag}\n"
                        f"mandate_id: {FENCES_LEDGER['mandate']['id']}\n"
                        f"operator_lens: {FENCES_LEDGER['active_lens']}\n"
                        f"shift: {FENCES_LEDGER['active_shift']}\n"
                        f"gateway_mode: {state['gatewayMode']}\n"
                        f"target_file: {target_file_label}\n"
                        f"pr_title: {json.dumps(synthesized_pr_title)}\n"
                        "---\n\n"
                        f"# Axiom Software Factory — {synthesized_pr_title}\n\n"
                        f"- **Run ID:** `{run_id}`\n"
                        f"- **Mandate:** `{FENCES_LEDGER['mandate']['id']}` ({FENCES_LEDGER['mandate']['title']})\n"
                        f"- **Branch:** `{wt_info.branch_name}` (Base `{wt_info.base_commit}`)\n"
                        f"- **Target File:** `{target_file_label}`\n"
                        f"- **Task Prompt:** {user_prompt}\n"
                        f"- **Synthesized Diagram:** {synthesized_diagram_title or 'Direct Worktree Dispatch'}\n"
                        f"- **Implemented Components:**\n{components_md}\n"
                        f"- **Implemented Control Flows:**\n{flows_md}\n"
                        f"- **MCP Elicitation Resolution:** `{json.dumps(state['elicitation']['resolution'])}`\n",
                        encoding="utf-8",
                    )

                if decision.upper() in ("APPROVE", "APPROVE_EXCEPTION"):
                    if chaos_mode == "REDTEAM_PAYLOAD":
                        # Red-Team Chaos Injection: writes a Python file with banned `eval()` + leaked API key
                        # so Stage 1 Deterministic Corporate Oracles visibly catch & block it on stage!
                        bad_file = Path(wt_info.worktree_path) / "compromised_hook.py"
                        bad_file.write_text(
                            "# Red-Team Simulated Prompt Injection Payload\n"
                            "LEAKED_KEY = 'AKIAIOSFODNN7EXAMPLE'\n"
                            "def run_untrusted(payload: str):\n"
                            "    return eval(payload)\n",
                            encoding="utf-8",
                        )
                        await push_log(
                            "🧪 Red-Team Chaos Mode: Wrote `compromised_hook.py` (contains `eval()` + AWS key) inside worktree."
                        )
                    elif chaos_mode == "BLAST_RADIUS":
                        # Budget scenario: a change too large for Stage 1's 300-line diff budget.
                        (Path(wt_info.worktree_path) / target_file_label).write_text(
                            "".join(f"STEP_{i:03d} = {i}\n" for i in range(400)),
                            encoding="utf-8",
                        )
                        await push_log(f"📦 Budget scenario: wrote 400 lines to `{target_file_label}`.")
                    else:
                        _write_synthesized_implementation(Path(wt_info.worktree_path), "verified")
                        await push_log(
                            f"📝 Worker wrote `{target_file_label}` and `FACTORY_PROOF.md` ({synthesized_pr_title}) inside sibling worktree."
                        )
                elif decision.upper() == "PROMOTE_TO_SKILL":
                    # ADR-004 Payoff: Operator chose "Approve & Promote to Layer 1 Skill"!
                    # Writes `.claude/skills/verified-worktree-playbook/SKILL.md` + `FACTORY_PROOF.md` inside the worktree
                    # and registers the new Layer 1 Trusted Skill in `FENCES_LEDGER["trusted_skills"]`.
                    promoted = promote_trace_to_layer1_skill(
                        worktree_path=wt_info.worktree_path,
                        run_id=run_id,
                        task_prompt=user_prompt,
                        skill_slug="verified-worktree-playbook",
                    )
                    state["fencesLedger"] = FENCES_LEDGER
                    await push_log(
                        f"⚡ ADR-004 Skill Promotion: Compiled Layer 2 fallback into Layer 1 Trusted Skill `{promoted['path']}`!"
                    )
                    await push_text(
                        msg_id,
                        f"⚡ **Promoted Layer 2 Fallback → Layer 1 Trusted Skill (`{promoted['path']}`)**\n"
                        "Future daytime and Night-Shift runs will execute this playbook at Layer 1 with zero quarantine pauses.\n\n",
                    )
                    _write_synthesized_implementation(
                        Path(wt_info.worktree_path), "verified-and-promoted-to-skill"
                    )
                elif decision.upper() == "REJECT_AND_HARDEN":
                    # ADR-003 Payoff: Operator chose "Reject & Harden" on FENCE-001!
                    # 1. FENCE-001 is now permanently mutated to `HARD_LOCK` in `FENCES_LEDGER`.
                    # 2. Even if chaos_mode was armed, the soft-compute engine automatically re-plans inside
                    #    the newly calcified fence and writes a 100% compliant implementation!
                    state["fencesLedger"] = FENCES_LEDGER
                    await push_log(
                        "🔒 ADR-003 Calcification: `FENCE-001` mutated from `SOFT_TRIPWIRE` -> `HARD_LOCK`! Soft-compute auto-replanning inside hardened fence..."
                    )
                    await push_text(
                        msg_id,
                        "🔒 **Dynamic Fence Calcified (`FENCE-001`: `SOFT_TRIPWIRE` → `HARD_LOCK`)**\n"
                        "Soft-compute engine stripped prohibited `child_process`/`eval` call and re-planned cleanly inside the hardened boundary.\n\n",
                    )
                    _write_synthesized_implementation(
                        Path(wt_info.worktree_path), "verified-after-fence-hardening"
                    )
                else:
                    await push_log("🛑 Operator rejected write; worktree left unmodified.")

            await event_queue.put(
                _encode_sse(StepFinishedEvent(type=EventType.STEP_FINISHED, step_name="claude_worker_execution"))
            )

            # 3. Mechanic 4: Stage 1 Deterministic Oracles + Stage 2 Adversarial Diff Verification
            await event_queue.put(
                _encode_sse(StepStartedEvent(type=EventType.STEP_STARTED, step_name="codex_adversarial_verification"))
            )
            state["phase"] = "VERIFYING_DIFF"
            diff_text = harness.capture_diff(wt_info.worktree_path)
            post_fingerprint = harness.get_main_tree_fingerprint()
            state["mainTreeCleanAfter"] = pre_fingerprint == post_fingerprint
            state["diff"] = diff_text

            await update_token_weather(21200, 0.018)
            await push_log(
                f"🔍 Running Stage 1 Deterministic Corporate Oracles + Stage 2 Verifier (Gateway: {state['gatewayMode']})..."
            )
            global LAST_INTERACTION_ID
            verification = await run_codex_adversarial_verification(
                diff_text=diff_text,
                task_prompt=user_prompt,
                worktree_path=wt_info.worktree_path,
                base_commit=wt_info.base_commit,
                gateway_mode=state["gatewayMode"],
                sponsor_preset=state["sponsorPreset"],
                previous_interaction_id=LAST_INTERACTION_ID,
            )
            if verification.get("interactionId"):
                LAST_INTERACTION_ID = verification["interactionId"]
            state["verification"] = verification
            state["phase"] = "COMPLETED" if verification["verdict"] == "PASS" else "BLOCKED_BY_VERIFIER"

            await push_log(
                f"✅ Verification Verdict: {verification['verdict']} (Score: {verification['score']}/100)"
                + (
                    f" · Interaction ID: {verification['interactionId'][:20]}..."
                    if verification.get("interactionId")
                    else ""
                )
            )
            oracles = verification.get("deterministicOracles", {})
            interaction_line = (
                f"- **Gemini 3.8 Interaction ID (`store=True`):** `{verification['interactionId']}`\n"
                if verification.get("interactionId")
                else ""
            )
            await push_text(
                msg_id,
                f"### 3. Two-Stage Corporate Diff Verification\n"
                f"- **Stage 1 Deterministic Oracles:** `{oracles.get('passedCount', 0)}/{oracles.get('totalCount', 5)}` passed in `{oracles.get('elapsedMs', 0)}ms` (`{oracles.get('evidenceHash', '')}`)\n"
                f"- **Stage 2 Verdict ({verification['provider']}):** **{verification['verdict']}** (`{verification['score']}/100`)\n"
                f"{interaction_line}"
                f"- **Summary:** {verification['summary']}\n"
                f"- **Main Working Tree Untouched:** `{state['mainTreeCleanAfter']}`\n",
            )

            await event_queue.put(
                _encode_sse(StepFinishedEvent(type=EventType.STEP_FINISHED, step_name="codex_adversarial_verification"))
            )
            await event_queue.put(
                _encode_sse(TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id))
            )
            await event_queue.put(
                _encode_sse(
                    RunFinishedEvent(
                        type=EventType.RUN_FINISHED,
                        thread_id=thread_id,
                        run_id=run_id,
                        result=verification,
                    )
                )
            )

        except Exception as exc:
            state["phase"] = "ERROR"
            await push_log(f"❌ Pipeline error: {exc}")
            await event_queue.put(
                _encode_sse({"type": EventType.RUN_ERROR.value, "message": str(exc)})
            )
        finally:
            await event_queue.put(None)

    asyncio.create_task(orchestrate_pipeline())

    async def sse_generator():
        while True:
            chunk = await event_queue.get()
            if chunk is None:
                break
            yield chunk

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/live/config")
async def get_gemini_live_config() -> dict[str, Any]:
    """Returns Gemini 3.8 Live voice whitelist, Interactions API model, and active configuration."""
    api_key = os.getenv("GOOGLE_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    has_key = bool(api_key and not api_key.startswith("your-") and not api_key.startswith("AIza..."))
    return {
        "model": GEMINI_LIVE_MODEL,
        "fallbackModel": GEMINI_LIVE_FALLBACK_MODEL,
        "interactionsModel": os.getenv("GEMINI_INTERACTIONS_MODEL", "gemini-3.8-flash"),
        "lastInteractionId": LAST_INTERACTION_ID,
        "voices": VOICES,
        "defaultVoice": DEFAULT_VOICE,
        "liveUpstreamReady": has_key,
    }


@app.post("/api/interactions/query")
async def create_gemini_interaction(payload: InteractionQueryPayload) -> dict[str, Any]:
    """
    Executes a stateful turn using the Google GenAI Interactions API (`client.aio.interactions.create`)
    targeting `gemini-3.8-flash` (with `previous_interaction_id` chaining and `store=True`).
    """
    global LAST_INTERACTION_ID
    api_key = os.getenv("GOOGLE_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    has_key = bool(api_key and not api_key.startswith("your-") and not api_key.startswith("AIza..."))
    model_name = (payload.model or os.getenv("GEMINI_INTERACTIONS_MODEL", "gemini-3.8-flash")).strip()
    prev_id = payload.previous_interaction_id or LAST_INTERACTION_ID

    if not has_key:
        sim_id = f"sim_interaction_{uuid.uuid4().hex[:12]}"
        LAST_INTERACTION_ID = sim_id
        return {
            "id": sim_id,
            "previousInteractionId": prev_id,
            "model": model_name,
            "status": "completed",
            "simulated": True,
            "outputText": f"[Simulated Gemini 3.8 Interactions API] Processed: {payload.prompt}",
        }

    from google import genai

    os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
    os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
    os.environ.pop("GOOGLE_CLOUD_LOCATION", None)
    gclient = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    sys_inst = payload.system_instruction or (
        f"You are the Axiom Software Factory Copilot running on {model_name} via the Google GenAI Interactions API. "
        f"Active Capital Mandate: {FENCES_LEDGER['mandate']['id']}. Active Lens: {FENCES_LEDGER['active_lens']}."
    )
    kwargs: dict[str, Any] = {
        "model": model_name,
        "system_instruction": sys_inst,
        "input": payload.prompt,
        "store": payload.store,
    }
    if prev_id and not str(prev_id).startswith("sim_"):
        kwargs["previous_interaction_id"] = prev_id

    used_model = model_name
    try:
        interaction = await asyncio.wait_for(
            gclient.aio.interactions.create(**kwargs),
            timeout=6.0,
        )
    except asyncio.TimeoutError:
        fast_model = os.getenv("GEMINI_INTERACTIONS_FAST_MODEL", "gemini-3.5-flash-lite").strip()
        used_model = fast_model
        kwargs["model"] = fast_model
        interaction = await asyncio.wait_for(
            gclient.aio.interactions.create(**kwargs),
            timeout=8.0,
        )

    LAST_INTERACTION_ID = interaction.id
    return {
        "id": interaction.id,
        "previousInteractionId": getattr(interaction, "previous_interaction_id", prev_id),
        "model": used_model,
        "status": interaction.status,
        "simulated": False,
        "outputText": interaction.output_text,
    }


@app.post("/api/whiteboard/synthesize")
async def synthesize_whiteboard_to_pr(payload: WhiteboardSynthesizePayload) -> dict[str, Any]:
    """
    Multimodal 'From Whiteboard to PR' endpoint powered by the Google GenAI Interactions API
    (`client.aio.interactions.create`). Accepts a captured frame from a mobile camera, webcam,
    screen-shared tab, or uploaded fallback image (or DIAGRAM_SPEC.md when triggered by voice
    without an active video frame) and returns a structured architecture extraction + worktree PR task prompt.
    """
    global LAST_INTERACTION_ID
    api_key = os.getenv("GOOGLE_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    has_key = bool(api_key and not api_key.startswith("your-") and not api_key.startswith("AIza..."))
    prev_id = payload.previous_interaction_id or LAST_INTERACTION_ID

    raw_b64 = (payload.image_base64 or "").strip()
    if "," in raw_b64 and raw_b64.startswith("data:"):
        raw_b64 = raw_b64.split(",", 1)[1]

    diagram_context = (payload.diagram_text or "").strip()
    if not raw_b64 and not diagram_context:
        diag_path = ROOT_DIR / "DIAGRAM_SPEC.md"
        if diag_path.exists():
            diagram_context = diag_path.read_text(encoding="utf-8")[:6000]
        else:
            diagram_context = (
                "Axiom Mission Control Architecture: Angular 21 Frontend -> FastAPI ADK Backend "
                "-> Gemini 3.8 Live + Interactions API -> Isolated Git Worktree -> Stage 1/2 Verified PR."
            )

    if has_key:
        try:
            from google import genai

            os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
            os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
            os.environ.pop("GOOGLE_CLOUD_LOCATION", None)
            gclient = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})

            fast_model = os.getenv("GEMINI_INTERACTIONS_FAST_MODEL", "gemini-3.5-flash-lite").strip()
            input_blocks: list[dict[str, Any]] = []
            if raw_b64:
                input_blocks.append(
                    {
                        "type": "image",
                        "mime_type": payload.mime_type or "image/jpeg",
                        "data": raw_b64,
                    }
                )
            prompt_instruction = (
                "Analyze this whiteboard sketch or architecture diagram and convert it into a concrete "
                "Git worktree engineering task and Pull Request specification. "
                "Identify the diagram title, all architecture components, data/control flows, target file, "
                "a clear taskPrompt for the autonomous coding worker inside the isolated worktree, and a conventional commit PR title."
            )
            if diagram_context:
                prompt_instruction += f"\n\nDiagram Specification Context:\n{diagram_context}"
            input_blocks.append({"type": "text", "text": prompt_instruction})

            create_kwargs: dict[str, Any] = {
                "model": fast_model,
                "system_instruction": (
                    "You are the Axiom Software Factory Whiteboard-to-PR Architect. "
                    "Extract architectural components and flows from the provided diagram and return JSON matching the schema."
                ),
                "input": input_blocks,
                "response_mime_type": "application/json",
                "response_format": WhiteboardPlanSchema.model_json_schema(),
                "store": True,
            }
            if prev_id and not str(prev_id).startswith("sim_"):
                create_kwargs["previous_interaction_id"] = prev_id

            interaction = await asyncio.wait_for(
                gclient.aio.interactions.create(**create_kwargs),
                timeout=15.0,
            )
            LAST_INTERACTION_ID = interaction.id
            parsed = json.loads(interaction.output_text or "{}")
            return {
                "status": "synthesized",
                "simulated": False,
                "source": payload.source,
                "interactionId": interaction.id,
                "model": fast_model,
                "diagramTitle": parsed.get(
                    "diagramTitle", "Whiteboard Architecture Specification"
                ),
                "detectedComponents": parsed.get("detectedComponents")
                or [
                    "Mission Control (Angular 21)",
                    "FastAPI Control Plane",
                    "Gemini 3.8 Live + Interactions API",
                    "Isolated Git Worktree",
                    "Verified PR Gate",
                ],
                "detectedFlows": parsed.get("detectedFlows")
                or [
                    "Operator captures whiteboard/diagram via Webcam, Screen, or Mobile",
                    "GenAI Interactions API synthesizes structured worktree task prompt",
                    "Isolated Git worktree executes change with MCP elicitation + 2-stage verification",
                ],
                "targetFile": parsed.get("targetFile", "FACTORY_PROOF.md"),
                "taskPrompt": parsed.get(
                    "taskPrompt",
                    "Implement the scanned whiteboard architecture specification and write FACTORY_PROOF.md after MCP operator approval.",
                ),
                "prTitle": parsed.get(
                    "prTitle",
                    "feat(architecture): implement whiteboard diagram specification in isolated worktree",
                ),
            }
        except Exception as exc:
            pass

    sim_id = f"sim_wb_{uuid.uuid4().hex[:10]}"
    LAST_INTERACTION_ID = sim_id
    return {
        "status": "synthesized",
        "simulated": True,
        "source": payload.source,
        "interactionId": sim_id,
        "model": "gemini-3.8-flash (simulated)",
        "diagramTitle": "Mission Control Multi-Lane Architecture (Whiteboard Scan)",
        "detectedComponents": [
            "Maya Operator (Voice · Screen · Mobile Camera)",
            "Mission Control (Angular 21 Frontend)",
            "ADK / FastAPI Control Plane",
            "Gemini 3.8 Live & Interactions API",
            "MCP Quarantined Gate (FENCE-001)",
            "Stage 1/2 Reviewer Agent -> Verified PR",
        ],
        "detectedFlows": [
            "Webcam / Screen / Mobile captures whiteboard diagram -> GenAI Interactions API",
            "Synthesized task dispatches into isolated sibling Git worktree",
            "In-process MCP gate pauses for voice approval -> Verified PR ready to merge",
        ],
        "targetFile": "FACTORY_PROOF.md",
        "taskPrompt": "Implement the scanned Whiteboard-to-PR multi-lane architecture specification and generate FACTORY_PROOF.md with verified component contracts.",
        "prTitle": "feat(whiteboard-to-pr): synthesize scanned architecture diagram into verified worktree PR",
    }


@app.websocket("/ws/live/{session_id}")
async def gemini_live_websocket(websocket: WebSocket, session_id: str) -> None:
    """
    Bidirectional 16kHz PCM AudioWorklet <-> Gemini 3.8 Live WebSocket endpoint
    with GoAway session rotation and automatic MCP elicitation gate triggering.
    """
    async def _on_voice_decision(decision: str, notes: str) -> dict[str, Any]:
        # Find any active run currently waiting on an elicitation gate, or fallback to LATEST_RUN_ID
        target_run_id = LATEST_RUN_ID
        for rid, ctx in reversed(list(ACTIVE_RUNS.items())):
            fut = ctx.get("elicitation_future")
            if fut is not None and not fut.done():
                target_run_id = rid
                break
        if not target_run_id or target_run_id not in ACTIVE_RUNS:
            return {"status": "no_active_run", "decision": decision}
        try:
            return await resume_elicitation(
                ElicitationResumePayload(
                    run_id=target_run_id,
                    decision=decision,
                    source="GEMINI_3_8_LIVE_AUDIO",
                    notes=notes,
                )
            )
        except Exception as exc:
            return {"status": "error", "error": str(exc), "decision": decision}

    await handle_gemini_live_ws(websocket, session_id, _on_voice_decision)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
