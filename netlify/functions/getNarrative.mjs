// POST /api/getNarrative  { name, address, ... }  ->  { narrative, cached }
//
// Writes a short plain-language description from verified facts only.
// Cost controls:
//   - per-IP rate limit (config below)
//   - shared cache in Netlify Blobs: each building is generated once, for everyone
//   - a daily generation cap (NARRATIVE_DAILY_LIMIT, default 300)
//   - capped output length, and a pinned, inexpensive model

import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const MODEL = process.env.NARRATIVE_MODEL || 'google/gemini-3.1-flash-lite';
const DAILY_LIMIT = Number(process.env.NARRATIVE_DAILY_LIMIT || 300);
const PROMPT_VERSION = 2;

const FIELDS = {
  name: 200,
  historicName: 200,
  address: 200,
  year: 100,
  architect: 200,
  landmarkDate: 50,
  styles: 200,
  styleSummary: 1200,
  type: 100,
  chrsRating: 200,
  nationalRegister: 100,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function cleanFacts(body) {
  const facts = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    const v = body?.[key];
    if (typeof v === 'string' && v.trim()) facts[key] = v.trim().slice(0, max);
  }
  return facts;
}

function buildPrompt(f) {
  const line = (label, v) => `- ${label}: ${v ?? 'Not available'}`;
  return `Write a short description of a Chicago building for someone standing in front of it, using ONLY the verified facts below. Do not add any names, dates, events, materials or other details that are not stated.

VERIFIED FACTS (from City of Chicago records):
${line('Name', f.name)}
${line('Historic name', f.historicName)}
${line('Address', f.address)}
${line('Year built', f.year)}
${line('Architect', f.architect)}
${line('Building type', f.type)}
${line('Architectural style', f.styles)}
${line('Chicago Landmark designation date', f.landmarkDate)}
${line('Chicago Historic Resources Survey rating', f.chrsRating)}
${line('National Register of Historic Places', f.nationalRegister)}

GENERAL DESCRIPTION OF THE STYLE (from the City's style guide; describes the style in general, NOT this specific building):
${f.styleSummary ?? 'Not available'}

INSTRUCTIONS:
- 1-2 short paragraphs, under 150 words, plain language.
- You may explain what the style is generally known for, but never claim this building has a particular feature unless it is in the facts.
- Skip facts marked "Not available" rather than mentioning them.
- No headings, lists or markdown.`;
}

async function cacheStore() {
  try {
    return getStore('narratives');
  } catch {
    return null; // Blobs unavailable (e.g. plain local dev): run without cache
  }
}

async function underDailyLimit(store) {
  if (!store) return true;
  const key = `count/${new Date().toISOString().slice(0, 10)}`;
  try {
    const n = Number((await store.get(key)) ?? 0);
    if (n >= DAILY_LIMIT) return false;
    await store.set(key, String(n + 1)); // approximate: not atomic, fine as a safety cap
  } catch (err) {
    console.error('Daily counter error:', err.message);
  }
  return true;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const facts = cleanFacts(body);
  if (!facts.name && !facts.address) return json({ error: 'bad_request' }, 400);

  const store = await cacheStore();
  const cacheKey = createHash('sha256')
    .update(JSON.stringify({ v: PROMPT_VERSION, model: MODEL, facts }))
    .digest('hex');

  if (store) {
    try {
      const hit = await store.get(`n/${cacheKey}`);
      if (hit) return json({ narrative: hit, cached: true });
    } catch (err) {
      console.error('Cache read error:', err.message);
    }
  }

  if (!process.env.OPENROUTER_API_KEY) return json({ error: 'not_configured' }, 503);
  if (!(await underDailyLimit(store))) return json({ error: 'daily_limit' }, 429);

  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'X-Title': 'Chicago Architecture Explorer',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: buildPrompt(facts) }],
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.error('OpenRouter request failed:', err.message);
    return json({ error: 'upstream_unavailable' }, 502);
  }

  const data = await res.json().catch(() => null);
  const narrative = data?.choices?.[0]?.message?.content?.trim();
  if (!res.ok || !narrative) {
    console.error('OpenRouter error:', res.status, JSON.stringify(data?.error ?? data)?.slice(0, 300));
    return json({ error: 'upstream_error' }, 502);
  }

  if (store) {
    try {
      await store.set(`n/${cacheKey}`, narrative);
    } catch (err) {
      console.error('Cache write error:', err.message);
    }
  }
  return json({ narrative, cached: false });
};

export const config = {
  path: '/api/getNarrative',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
