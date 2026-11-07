# Axiom Masterclass — Agentic Engineering (ADK & MCP)
**GoTech World 2026** | Tue 10 Nov, 10:00–17:00 | Coding Area — Day 1 | ROMEXPO, Pavilion B1, Bucharest
**Hub**: [linktr.ee/build_with_ai](https://linktr.ee/build_with_ai)

## Before Tuesday (~15 min)

### 1. Install Antigravity IDE
Download from [antigravity.google/download](https://antigravity.google/download) → **Antigravity IDE (Standalone)**, then sign in with your **personal Google account (Gmail)**.
Full details: [`manuals/Axiom-Masterclass-Setup-Instructions.pdf`](./manuals/Axiom-Masterclass-Setup-Instructions.pdf).

> ⚠️ **Free tier: do not run IDE agents before Tuesday.** The weekly quota is tight; save it for the workshop.

### 2. Get a Google AI Studio API key
Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). This powers the code labs and is **separate** from your Antigravity login quota.

### 3. Clone and verify (Node v20 LTS or v22+)
```bash
git clone https://github.com/gsans/axiom-masterclass-gotech-world-2026.git
cd axiom-masterclass-gotech-world-2026
cp .env.example .env   # paste your key into GEMINI_API_KEY
npm install
npm run verify         # expect: ✅ Node vXX | API: READY
```
Never commit `.env` (it is already in `.gitignore`).

### 4. Pre-reading
[`manuals/Slow-Engineering-Field-Manual-Gerard-Sans.pdf`](./manuals/Slow-Engineering-Field-Manual-Gerard-Sans.pdf)

## On the day
Run `git pull` at the start of each block — labs are unlocked live.

## Structure
* `00-setup/` — API key sanity check (`npm run verify`)
* `manuals/` — Setup & Slow Engineering PDFs
* `notebooks/` — Read-only reference `.ipynb` files (`01-b1` to `07-b4`)
* `labs/` — `block-1` to `block-4` (unlocked live on Tuesday)
