# Mission Control: the Axiom Software Factory demo

The closing demo from the Axiom Masterclass at GoTech World 2026. A coding agent works on a throwaway repo in its own Git worktree. Every change goes through a human gate, deterministic checks and an independent AI reviewer before it can be merged. You drive it from Mission Control by clicking or by voice.

It's a proof of concept for teaching, not a product. It only works on the `sample-repo` folder it creates for itself.

## What you need

* [Node.js](https://nodejs.org) 20.19 or newer, and Git
* Python 3.10 or newer
* [uv](https://docs.astral.sh/uv/getting-started/installation/) (recommended) or pip
* Chrome, if you want to try voice
* A Google AI Studio key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Workshop attendees can reuse the key from the labs.

It runs on macOS, Linux and Windows. On Windows, run the commands in **Git Bash**, which comes with Git.

## Set it up (about 10 minutes)

From the root of this repo:
```bash
cd mission-control
```
```bash
cp .env.example .env
```

Open `mission-control/.env`, replace `your-google-api-key` with your key, and save.

Create the sample repo the agent will work on:
```bash
./scripts/make-sample-repo.sh
```

Install the backend:
```bash
cd backend
```
```bash
uv sync
```
This downloads about 200 MB, most of it the Claude Agent SDK, which bundles Claude Code. Use a good connection.

No uv? Use pip instead:
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```
On Windows the pip path is `.venv/Scripts/pip`.

Install the frontend, in a second terminal from `mission-control`:
```bash
cd frontend-angular
```
```bash
npm install
```

## Run it

Two terminals, both left running. Ports 8000 and 4200 must be free.

Backend, from `mission-control/backend`:
```bash
.venv/bin/uvicorn server:app --port 8000
```
On Windows use `.venv/Scripts/uvicorn`.

Frontend, from `mission-control/frontend-angular`:
```bash
npm start
```

Open [http://localhost:4200](http://localhost:4200). The header shows which models are really running.

## Try it

1. Press **Dispatch run**. The progress rail moves through Dispatch, Worktree and Agent.
2. After about 15 seconds the agent stops at the gate: "Waiting on a human".
3. Press **Approve exception**. The rail runs through the checks to the verdict.
4. Open **Checking the work** to see the score, the five checks and the diff.
5. Open **Fences and skills** to see the boundary rules.

The buttons under the Dispatch input each fill in a task that tests one control. The dice picks one at random. Approve at the gate to see what happens.

| Button | What happens |
|---|---|
| Clean run | Passes all the checks and the reviewer |
| Safety | The checks block `eval()` before any model sees the code |
| Secrets | The secret scanner blocks an AWS key |
| Budget | 400 lines is over the 300-line change limit, so it's blocked |
| Anti-slop | The checks pass, but the reviewer fails the placeholder code |

To see the system learn: open **Settings**, arm the chaos probe, press **Run chaos probe**, then **Reject and harden FENCE-001**. Press **Reset fences and skills** in the Fences tab to start again.

**Voice:** press **Connect live** in the bottom dock and allow the microphone. Then say "approve" or "reject" at the gate.

Other things to explore: **Whiteboard to PR** turns a sketch from your webcam, a shared tab or an upload into a task. **AG-UI Copilot** lets you approve from inside the chat.

## What's real and what's scripted

* **Real:** the Git worktrees, the gate, the five deterministic checks, the reviewer (Gemini), voice (Gemini Live) and the Markdown copilot.
* **Scripted by default:** the coding agent. Without an Anthropic key it writes prepared changes, so every run is free and repeatable.

To use a real Claude agent, add `ANTHROPIC_API_KEY` to `.env` and restart the backend. Each run is capped at $0.50 (`AXIOM_HARD_BUDGET_USD`). The Safety, Secrets and Budget buttons are designed for the scripted agent, because a real model may refuse to write `eval()` or a key in the first place.

**Quota:** each run uses one or two reviewer requests. Free keys get about 20 requests a day on Gemini 3.8 Flash. When that runs out, or the model is busy, the reviewer retries on Gemini 3.5 Flash Lite. If that fails too, the review is **deferred**. It is never passed without a review.

## Troubleshooting

| You see | Fix |
|---|---|
| Dispatch fails, or a network or CORS error in the browser console | The backend isn't running, or isn't on port 8000. Start it and check `curl -s localhost:8000/health` says `"status":"ok"` |
| `uv sync` fails with a network timeout | Slow connection. Run `UV_HTTP_TIMEOUT=600 uv sync` |
| `"git_valid": false` in the health check | Run `./scripts/make-sample-repo.sh` from `mission-control` |
| Port already in use | Stop whatever is on port 8000 or 4200. The frontend expects the backend on 8000 |
| Reviewer says "simulated" or "deferred" | No key, or the key is wrong. Check `GOOGLE_API_KEY` in `.env`, then restart the backend |
| 429 or quota errors | Wait a minute. If it persists you've used today's free quota |
| Voice doesn't connect | Use Chrome and allow the microphone. Live models need a valid key |
| A change to `.env` does nothing | `.env` is only read at startup. Restart the backend |

## How it fits together

For the full picture, with versions, the gate, AG-UI events, the voice bridge and the checks, read [TECH-STACK.md](./TECH-STACK.md).

* `backend/`: FastAPI. `server.py` runs the jobs and streams AG-UI events, `worktree_harness.py` holds the worktrees, checks and reviewer, and `gemini_live_bridge.py` handles voice.
* `frontend-angular/`: Angular 21 with NgRx. Live audio is adapted from [gsans/gemini-3-live-angular](https://github.com/gsans/gemini-3-live-angular).
* `scripts/make-sample-repo.sh`: creates `sample-repo`, the only code the agent touches. Worktrees go in `.factory-worktrees`. Both are ignored by Git.

Don't point `TARGET_REPO_PATH` at real code. Keep your keys in `.env`, which Git ignores.
