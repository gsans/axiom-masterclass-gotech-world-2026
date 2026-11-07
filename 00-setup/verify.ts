import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

async function verify() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) throw new Error(`Node v20+ required. Found v${process.versions.node}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    throw new Error('Set GEMINI_API_KEY in .env (from aistudio.google.com)');
  }

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_VERIFICATION_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    contents: 'Reply: READY',
  });
  console.log(`✅ Node v${process.versions.node} | API: ${res.text?.trim()}`);
}

verify().catch((e) => {
  console.error('❌ Verification failed:', e.message);
  process.exit(1);
});
