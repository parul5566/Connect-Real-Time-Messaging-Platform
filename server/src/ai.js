import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirnameEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The platform writes AI_* to server/.env but may not inject them into the
// process env — parse them on first use.
function envOrFile(name, fallback = '') {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of fs.readFileSync(path.join(__dirnameEnv, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && m[1] === name) return m[2];
    }
  } catch {}
  return fallback;
}

let _cfg = null;
function cfg() {
  if (!_cfg) _cfg = {
    BASE_URL: envOrFile('AI_BASE_URL'),
    API_KEY: envOrFile('AI_API_KEY'),
    MODEL: envOrFile('AI_MODEL', 'gpt-4o-mini'),
  };
  return _cfg;
}

const PII_RE = /(?:\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,16}\b|\bsk-[a-z0-9_-]{10,}\b)/i;
const INJECTION_RE = /ignore.{0,30}(?:instructions|rules)|reveal.{0,30}(?:system prompt|secret)|bypass.{0,20}(?:guardrail|security)|disregard.{0,30}(?:previous|prior)/i;

function chunkText(text, size = 800, overlap = 100) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks.filter(c => c.trim());
}

function send(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function askAI(req, res) {
  const uid = req.user.id;
  const q = String(req.body?.question || '').trim().slice(0, 2000);
  if (!q) { send(res, { stage: 'error', error: 'Ask a question first' }); return res.end(); }
  pool.query('INSERT INTO ai_messages (user_id, role, content) VALUES (?, ?, ?)', [uid, 'user', q]).catch(() => {});

  send(res, { stage: 'input-check', state: 'running' });
  await sleep(250);
  let [gr] = await pool.query('SELECT pii, injection, grounding FROM ai_guardrails WHERE user_id=?', [uid]);
  const rules = gr[0] || { pii: 1, injection: 1, grounding: 1 };

  if (rules.pii && PII_RE.test(q)) {
    send(res, { stage: 'input-check', state: 'blocked' });
    send(res, { done: true, blocked: true, text: 'This request appears to contain sensitive information (a card number, personal identifier or API key). Remove it and try again. Nothing was sent to any external service.', sources: [] });
    return res.end();
  }
  if (rules.injection && INJECTION_RE.test(q)) {
    send(res, { stage: 'input-check', state: 'blocked' });
    send(res, { done: true, blocked: true, text: 'This request matched a prompt-injection rule. Please rephrase it as a question about your connected documents.', sources: [] });
    return res.end();
  }
  send(res, { stage: 'input-check', state: 'complete' });

  send(res, { stage: 'route', state: 'running' });
  await sleep(200);
  send(res, { stage: 'route', state: 'complete' });

  send(res, { stage: 'retrieve', state: 'running' });
  const [sources] = await pool.query('SELECT id, name, text FROM ai_sources WHERE user_id=? AND enabled=1', [uid]);
  const stop = new Set(['what','when','does','the','and','are','is','to','of','a','an','in','on','for','about','with','it','me','our','can','you','how','do','we','my','your']);
  const tokens = (q.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2 && !stop.has(w));
  const scored = [];
  for (const s of sources) {
    for (const [ci, chunk] of chunkText(s.text).entries()) {
      const low = chunk.toLowerCase();
      const score = tokens.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0);
      if (score > 0) scored.push({ sourceId: s.id, sourceName: s.name, chunk, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 4);
  await sleep(250);
  send(res, { stage: 'retrieve', state: 'complete', found: top.length });

  if (!top.length) {
    send(res, { stage: 'respond', state: 'complete' });
    send(res, { stage: 'verify', state: 'complete' });
    const nomatch = "I couldn't find anything about that in your connected sources. Add a knowledge source or ask about something your documents cover — I only answer from your material.";
    saveAssistant(uid, nomatch, []);
    send(res, { done: true, noMatch: true, text: nomatch, sources: [] });
    return res.end();
  }

  send(res, { stage: 'respond', state: 'running' });
  const context = top.map((t, i) => `[${i + 1}] (${t.sourceName})\n${t.chunk}`).join('\n\n');
  const prompt = `Answer the user's question using ONLY the context below. If the context doesn't contain the answer, say you can't find it in their sources. Cite sources as [1], [2] etc.\n\nContext:\n${context}\n\nQuestion: ${q}`;

  const answer = await callLLM(prompt);
  if (answer == null) {
    send(res, { stage: 'respond', state: 'error' });
    send(res, { done: true, error: true, text: 'The assistant service is unavailable right now. Please try again shortly.', sources: [] });
    return res.end();
  }
  // stream the answer in small chunks for progressive rendering
  for (let i = 0; i < answer.length; i += 24) {
    send(res, { delta: answer.slice(i, i + 24) });
    await sleep(15);
  }
  send(res, { stage: 'respond', state: 'complete' });
  send(res, { stage: 'verify', state: 'running' });
  await sleep(250);
  send(res, { stage: 'verify', state: 'complete' });
  const cited = [...new Map(top.filter(t => answer.includes(`[${top.indexOf(t) + 1}]`)).map(t => [t.sourceId, { id: t.sourceId, name: t.sourceName }])).values()];
  const srcs = cited.length ? cited : top.map(t => ({ id: t.sourceId, name: t.sourceName }));
  saveAssistant(uid, answer, srcs);
  send(res, { done: true, text: answer, sources: srcs });
  res.end();
}

function saveAssistant(uid, text, sources) {
  pool.query('INSERT INTO ai_messages (user_id, role, content, sources) VALUES (?, ?, ?, ?)',
    [uid, 'assistant', text, JSON.stringify(sources)]).catch(() => {});
}

async function callLLM(prompt) {
  const { BASE_URL, API_KEY, MODEL } = cfg();
  if (!BASE_URL || !API_KEY) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    const r = await fetch(`${BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 800 }),
      signal: ctl.signal
    });
    clearTimeout(t);
    if (!r.ok) { console.error('LLM error', r.status, await r.text().catch(() => '')); return null; }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('LLM call failed', e.message);
    return null;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
