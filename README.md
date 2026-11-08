# Axiom Masterclass — Agentic Engineering (ADK & MCP)

**GoTech World 2026** · Tue 10 Nov, 10:00–17:00 · Coding Area, Day 1 · ROMEXPO, Pavilion B1, Bucharest

**Hub:** [linktr.ee/build_with_ai](https://linktr.ee/build_with_ai)

## Before Tuesday: 3 steps (~15 min)

### 1. Install Antigravity IDE

Download **Antigravity IDE (Standalone)** from [antigravity.google/download](https://antigravity.google/download), install it, and sign in with your **personal Google account (Gmail)**.

> [!WARNING]
> **Free tier: don't run any agents in Antigravity before Tuesday.** The weekly quota is small and you'll need all of it during the workshop.

### 2. Get a Google AI Studio API key

> [!IMPORTANT]
> **You need this key for the code labs, and it's not in the setup PDF.**
> Signing in to Antigravity is **not** enough. The key is separate and free.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with the same Gmail account.
2. Click **Create API key** and copy it.
3. Keep it private. Don't post it in chat or commit it to Git.

> [!WARNING]
> **Free keys get about 60 requests a day with Gemini 3.5 Flash Lite, the model we use.** One question to a lab agent uses 2 to 6 requests. Don't overdo it: run the setup check once, and save the rest for the workshop.

### 3. Get the repo and check your key

You need [Node.js](https://nodejs.org) v20 or newer and Git. Open a terminal (Antigravity's built-in terminal is fine) and run these one at a time:

```bash
git clone https://github.com/gsans/axiom-masterclass-gotech-world-2026.git
```
```bash
cd axiom-masterclass-gotech-world-2026
```
```bash
npm install
```

> [!TIP]
> `npm install` downloads about 380 MB and can take a few minutes. Run it on a good connection before you travel, because conference wifi will be slow.

```bash
cp .env.example .env
```

Open the new `.env` file, replace `your-api-key-here` with your key, and save. Then run:

```bash
npm run verify
```

✅ **Done** when you see `Ready for Tuesday`. If you see ❌, the message tells you what to fix.

## On the day

At the start of each block, run `git pull` in the repo folder to get the new lab.

## Reading (optional)

* [Setup guide (PDF)](./manuals/Axiom-Masterclass-Setup-Instructions.pdf)
* [Slow Engineering Field Manual (PDF)](./manuals/Slow-Engineering-Field-Manual-Gerard-Sans.pdf)

## What's in the repo

* `verify.mjs`: the key check that `npm run verify` runs
* `manuals/`: setup guide and field manual
* `notebooks/`: reference notebooks for each block (read-only)
* `labs/`: block 1–4 labs (released live on Tuesday)
