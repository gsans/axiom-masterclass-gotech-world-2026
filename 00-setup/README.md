# Setup Sanity Check (`00-setup`)

Complete [`../manuals/Axiom-Masterclass-Setup-Instructions.pdf`](../manuals/Axiom-Masterclass-Setup-Instructions.pdf) first.

## Two Separate Quotas
* **Antigravity IDE Login (Gmail)**: Powers IDE agents (5h rolling + 7d weekly cap). **Free Tier: Do not run IDE agents before Tuesday.**
* **Google AI Studio Key (`GEMINI_API_KEY`)**: Powers code labs via `.env`.

## Verify Code Environment
```bash
cp .env.example .env   # Add GEMINI_API_KEY from aistudio.google.com/apikey
npm install
npm run verify
```
