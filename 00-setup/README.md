# 00-setup

`verify.mjs` checks your Node version and your Gemini API key. Run it from the repo root with `npm run verify`. The steps are in the [main README](../README.md#3-get-the-repo-and-check-your-key).

## Two separate quotas
* **Antigravity IDE login (Gmail)**: powers the IDE agents (5-hour rolling + 7-day weekly cap). **Free tier: don't run IDE agents before Tuesday.**
* **Google AI Studio key (`GEMINI_API_KEY` in `.env`)**: powers the code labs.
