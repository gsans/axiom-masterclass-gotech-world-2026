# Axiom Masterclass — Agentic Engineering (ADK & MCP)
**GoTech World 2026** | Tue 10 Nov, 10:00–17:00 | Coding Area — Day 1 | ROMEXPO, Pavilion B1, Bucharest
**Hub**: [linktr.ee/build_with_ai](https://linktr.ee/build_with_ai)

## Before Tuesday (~15 min)

### 1. Install Antigravity IDE
Download **Antigravity IDE (Standalone)** from [antigravity.google/download](https://antigravity.google/download) and sign in with your **personal Google account (Gmail)**.

> ⚠️ **Free tier: don't run IDE agents before Tuesday.** The weekly quota is tight; save it for the workshop.

### 2. Get a Google AI Studio API key
Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → copy it.
(This key is for the code labs. It is separate from your Antigravity login.)

### 3. Get the repo and check your key
You need Node.js v20 or newer ([nodejs.org](https://nodejs.org)) and Git. In a terminal:

```bash
git clone https://github.com/gsans/axiom-masterclass-gotech-world-2026.git
```
```bash
cd axiom-masterclass-gotech-world-2026
```
```bash
cp .env.example .env
```
Open the new `.env` file and replace `your-api-key-here` with your key. Save it. Then:

```bash
npm run verify
```
You should see `✅ Ready for Tuesday`. If not, the message tells you what to fix.

That's it. No `npm install` needed until Tuesday. Never share or commit your `.env`.

**Optional pre-reading:** [`manuals/Slow-Engineering-Field-Manual-Gerard-Sans.pdf`](./manuals/Slow-Engineering-Field-Manual-Gerard-Sans.pdf)
**Full setup guide (PDF):** [`manuals/Axiom-Masterclass-Setup-Instructions.pdf`](./manuals/Axiom-Masterclass-Setup-Instructions.pdf)

## On the day
In the repo folder, run `git pull` at the start of each block to get the new lab.

## What's in here
* `00-setup/` — the key check used by `npm run verify`
* `manuals/` — setup guide and Slow Engineering field manual
* `notebooks/` — read-only reference notebooks (`01-b1` to `07-b4`)
* `labs/` — `block-1` to `block-4` (released live on Tuesday)
