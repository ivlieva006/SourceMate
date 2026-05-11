// src/llm.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const { LLM_BASE_URL, LLM_MODEL, LLM_ENABLED } = require('../config/config.js');

async function llmChat(messages) {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model: LLM_MODEL, temperature: 0.1, messages })
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// Достаём первый валидный {...} из ответа
function safeJsonPick(s) {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function llmExpandQuery(q, profile = null) {
  if (!LLM_ENABLED) return [];
  const sys = `Return STRICT JSON: {"queries":[string,...]} (4–8 items).
Consider synonyms, near-discipline phrases, RU/EN as needed.
Avoid off-topic meanings from profile.disambiguation.reject_meanings.`;
  const msgs = [{ role:'system', content: sys }];
  if (profile) msgs.push({ role:'system', content: `PROFILE: ${JSON.stringify(profile)}` });
  msgs.push({ role:'user', content: q });

  const c = await llmChat(msgs);
  const j = safeJsonPick(c);
  return Array.isArray(j?.queries) ? j.queries.slice(0,8) : [];
}

async function llmRelevance(query, item, profile = null) {
  if (!LLM_ENABLED) return null;
  const sys = `Return ONLY JSON: {"relevance":0-100,"verdict":"include|exclude","reason":"short"}.
Judge conceptual fit (not only word overlap). If profile provided, prefer must_have concepts and penalize reject meanings/negative domains.`;
  const msgs = [{ role:'system', content: sys }];
  if (profile) msgs.push({ role:'system', content: `PROFILE: ${JSON.stringify(profile)}` });
  msgs.push({
    role:'user',
    content:
`Query: ${query}
Title: ${item.title||''}
Year: ${item.year||''}
Type: ${item.type||''}
Source: ${item.source||''}
URL: ${item.url||''}
Abstract: ${item.description||''}`
  });

  const c = await llmChat(msgs);
  const j = safeJsonPick(c);
  if (!j) return null;
  return {
    relevance: Number(j.relevance) || 0,
    verdict: (j.verdict === 'include' || j.verdict === 'exclude') ? j.verdict : 'include',
  };
}

async function llmMatchAdvice(fragment, source) {
  if (!LLM_ENABLED) return '';
  const sys = `Return ONLY JSON: {"advice":"short Russian recommendation"}.
Explain how to rewrite or cite the fragment. Do not invent bibliographic facts.`;
  const c = await llmChat([
    { role: 'system', content: sys },
    {
      role: 'user',
      content:
`Fragment: ${fragment}
Source title: ${source.title || ''}
Source: ${source.source || ''}
URL: ${source.url || ''}`
    }
  ]);
  const j = safeJsonPick(c);
  return String(j?.advice || '').trim();
}

module.exports = { llmChat, llmExpandQuery, llmRelevance, llmMatchAdvice, safeJsonPick };
