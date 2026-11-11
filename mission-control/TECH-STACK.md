# Tech stack

How Mission Control is built, for engineers who want to read the code or reuse a piece of it. Each section names the file to open.

```
 Browser (Angular 21)                         Backend (FastAPI, Python 3.10+)
 ─────────────────────                        ───────────────────────────────
 Dispatch / chat ──POST /api/factory/run──▶  run_factory_sse ──▶ git worktree (isolated lane)
        ▲                                           │
        └──── AG-UI events over SSE ◀───────────────┤  claude-agent-sdk worker (headless)
                                                    │     └─ in-process MCP server "axiom_gate"
 Approve button ─POST /api/elicitation/resume─▶     │          request_human_elicitation ⏸ (asyncio.Future)
 Voice "approve" ──WebSocket /ws/live/{id}───▶ Gemini Live bridge ─┘  resumes the same Future
                                                    │
                                                    ├─ Stage 1: deterministic oracles (no model)
                                                    └─ Stage 2: independent reviewer (Gemini Interactions API)
```

| Layer | Technology | Version | Where |
|---|---|---|---|
| Frontend | Angular 21, standalone components, signals, control flow | 21.2 | `frontend-angular/src/app/` |
| State | NgRx Store + Effects + DevTools | 21.1 | `src/app/store/` |
| Agent-UI protocol | AG-UI (`ag-ui-protocol` in Python, `@ag-ui/core` in the browser) | 1.0 | `server.py`, `ag-ui-chat.component.ts` |
| Backend | FastAPI + Uvicorn, Server-Sent Events, WebSockets | 0.162 | `backend/server.py` |
| Coding worker | Claude Agent SDK (headless Claude Code) | 0.2.174 | `server.py` → `run_factory_sse` |
| Tool protocol | MCP, in-process SDK server (MCP Python SDK underneath) | 2.3 | `server.py` → `create_sdk_mcp_server` |
| Voice | Gemini Live API via `google-genai`, AudioWorklets | 3.0 | `backend/gemini_live_bridge.py`, `gemini-live-audio.service.ts` |
| Reviewer, copilot, whiteboard | Gemini Interactions API (`client.aio.interactions.create`) | | `worktree_harness.py`, `server.py` |
| Isolation | `git worktree` sibling lanes | | `worktree_harness.py` → `WorktreeHarness` |
| Rendering | `marked` (GFM) through Angular's sanitizer | 16.4.1 | `src/app/markdown.pipe.ts` |

## Headless worker: Claude Agent SDK

The worker is Claude Code run as a library, not a terminal. `server.py` calls `query(prompt, options)` with `ClaudeAgentOptions`:

- **Tool allowlist.** `allowed_tools` is `Read`, `Glob`, `Grep`, `Write`, `Edit` and `Skill`, plus the gate tool. Project settings load with `setting_sources=["project"]`. An architect/builder split is sketched in `subagent_roster`, but it isn't passed to the SDK yet.
- **`can_use_tool` callback.** A two-layer cascade: approved skills run at Layer 1, and anything from the `mcp__fallback__*` layer goes to the human gate first.
- **Hard limits.** `max_turns=4` and `max_budget_usd` come from `AXIOM_HARD_BUDGET_USD`, which defaults to $0.50 per run.
- **Working directory.** It is the isolated worktree, never your main checkout.

Without a real `ANTHROPIC_API_KEY`, the same code path runs a scripted worker. It calls the MCP tool handler directly and writes template files. The header tells you which one is running.

## Human gate: MCP tool with elicitation-style pause

`axiom_gate` is an in-process MCP server built with `create_sdk_mcp_server`. It runs inside the FastAPI process, with no subprocess or stdio. Its one tool, `request_human_elicitation`, does three things:

1. It emits an AG-UI `TOOL_CALL_START`, so the UI shows the question and the gate frame.
2. It `await`s an `asyncio.Future`. The agent run is suspended mid-tool-call, so it uses no tokens and keeps no polling loop.
3. It resolves when either `POST /api/elicitation/resume` (button or chat) or a spoken "approve" on the Live bridge sets the Future. It then returns the decision to the model as the tool result.

This follows the MCP elicitation pattern, where a tool asks a human for input mid-call. It is implemented as a blocking tool, not with the protocol's `elicitation/create` client request, because in-process SDK servers have no separate client to ask. The decision can be `APPROVE`, `REJECT_AND_HARDEN`, which adds a fence rule, or `PROMOTE_TO_SKILL`, which saves the trace as a Layer 1 skill.

## Streaming to the UI: AG-UI over SSE

`POST /api/factory/run` returns a `StreamingResponse` of AG-UI events, encoded with `ag_ui.core`:

| Event type | Used for |
|---|---|
| `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` | Run lifecycle |
| `STEP_STARTED` / `STEP_FINISHED` | The progress rail: worktree, worker, verification |
| `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` | Markdown narration in the chat |
| `TOOL_CALL_START` / `TOOL_CALL_RESULT` / `TOOL_CALL_END` | The gate card, rendered in the chat as an approval prompt |
| `STATE_SNAPSHOT` | Full run state: phase, worktree, oracles, verdict, diff |

The browser reads the stream with `fetch`. `app.component.ts` → `handleAgUiSseEvent` turns each event into NgRx actions. Because the protocol is standard, the same backend could drive any AG-UI client, such as CopilotKit.

## Voice: Gemini Live bridge

The browser never holds the Google key. Audio goes through the backend:

- **Browser.** An `AudioWorklet` records the mic as 16 kHz PCM and sends it over a WebSocket to `/ws/live/{session_id}`. A second worklet plays 24 kHz PCM back. See `public/worklets/` and `gemini-live-audio.service.ts`.
- **Backend.** `client.aio.live.connect` with audio responses, input and output transcription, a prebuilt voice, and context-window compression. See `gemini_live_bridge.py`.
- **Long sessions.** When the server sends `GoAway`, the bridge opens the next session first, drains the old one, and replays a ring buffer of recent mic audio, so a session rotation isn't heard.
- **Voice as control.** Transcripts are scanned for "approve", "reject and harden" and "promote to skill". A match resolves the same `asyncio.Future` as the button.
- **Fallback.** `GEMINI_LIVE_MODEL` is tried first, then `GEMINI_LIVE_FALLBACK_MODEL`.

## Verification: deterministic first, model second

Stage 1 is in `worktree_harness.py` → `run_deterministic_corporate_oracles`. It costs nothing and is the same every time:

| Oracle | Blocks on |
|---|---|
| Protected paths | Changes to fenced files, such as `src/core/auth.ts` |
| AST gate | `eval`, `exec`, `compile` or `__import__`, found by parsing the Python files (`ast.parse`) |
| Secret scan | Known key patterns plus Shannon entropy > 4.6 bits |
| Blast radius | More than 300 changed lines |
| Evidence stamp | Records `sha256(base commit + diff)` so the verdict is tied to the exact change |

Stage 2 runs only if Stage 1 passes. A different model family from the worker scores the diff against a Pydantic schema (`DiffVerificationSchema`). By default that is Gemini through the Interactions API, falling back to Flash Lite. If no independent reviewer is available, the item is **deferred**. It is never silently passed.

## Other Gemini Interactions API uses

- **AG-UI Copilot chat:** `POST /api/interactions/query`. It is stateful through `previous_interaction_id`.
- **Whiteboard to PR:** `POST /api/whiteboard/synthesize`. It takes a webcam frame, shared tab or uploaded image, and returns components, flows and a task prompt for the worker. If a voice command triggers it with no image, it reads `DIAGRAM_SPEC.md` instead.

## Not on the main path

`@google/adk`, `@a2ui/angular` and `@modelcontextprotocol/sdk` are installed, and A2UI is registered in `app.config.ts`. They come from the starter kit the frontend grew from, and the Mission Control screen doesn't use them. The gateway switch (cloud, night shift or local air-gap through a `pxpipe` proxy) and the sponsor presets are settings that change labels and routing in the Settings drawer. Each one needs its own local infrastructure to do real work.
