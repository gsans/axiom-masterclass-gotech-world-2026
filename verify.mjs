// Setup check: no npm install needed. Run from the repo folder with `npm run verify`.
import { readFileSync, existsSync } from 'node:fs';

const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail(`Node v20 or newer required (you have v${process.versions.node}). Install from nodejs.org`);

if (!existsSync('.env')) fail('No .env file. Run:  cp .env.example .env  then paste your key into .env');

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const key = env.GEMINI_API_KEY;
if (!key || key === 'your-api-key-here') {
  fail('Open .env and replace your-api-key-here with your key from https://aistudio.google.com/apikey');
}

const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
const TIMEOUT_SECONDS = 60;
const busy = (what) =>
  `${what} Your key isn't confirmed yet. Try again in a few minutes.\n` +
  '   If it keeps happening, switch to gemini-3.5-flash-lite in .env (the options are listed there).';

console.log(`Checking your key with ${model} (up to ${TIMEOUT_SECONDS} seconds)...`);

let res;
let body;
try {
  res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly: READY' }] }] }),
    signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
  });
  body = await res.json().catch((e) => {
    if (e.name === 'TimeoutError') throw e;
    return {};
  });
} catch (e) {
  if (e.name === 'TimeoutError') fail(busy(`${model} didn't reply within ${TIMEOUT_SECONDS} seconds, so it's probably overloaded.`));
  fail('Could not reach Google. Check your internet connection and try again.');
}

if (!res.ok) {
  const reason = body?.error?.message || res.statusText;
  if (res.status === 503) fail(busy(`${model} is overloaded right now.`));
  if (res.status === 400 || res.status === 403) fail(`Google rejected the key. Copy it again from https://aistudio.google.com/apikey\n   (${reason})`);
  if (res.status === 404) fail(`Model "${model}" not found. (${reason})`);
  if (res.status === 429) fail(`Rate limit or quota reached. Wait a minute and retry. (${reason})`);
  fail(`API error ${res.status}: ${reason}`);
}

const text = body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
if (!text) fail(busy(`${model} returned an empty reply.`));
console.log(`✅ Ready for Tuesday — Node v${process.versions.node} | ${model}: ${text}`);
