// src/ranking.js
const { toks, cosine, hostOf, norm } = require('./utils.js');

function scoreHeuristic(it, qTok, lang){
  const t = toks(it.title||'');
  let s = cosine(qTok, t)*60;
  if (lang==='ru' && /[А-Яа-яЁё]/.test(`${it.title||''} ${it.description||''}`)) s+=10;
  if (lang==='en' && !/[А-Яа-яЁё]/.test(it.title||'')) s+=4;
  if ((it.type||'').includes('journal-article')) s+=3;
  if (it.year && it.year>=2018) s+=4;
  return s;
}

function scoreHeuristicWithProfile(it, qTok, lang, profile){
  const text = norm((it.title||'') + ' ' + (it.description||''));
  let s = scoreHeuristic(it, qTok, lang);
  for (const t of [
    ...(profile?.include_terms||[]),
    ...(profile?.must_have_concepts||[])
  ]) {
    if (text.includes(norm(String(t)))) s += 8;
  }
  for (const x of [
    ...(profile?.exclude_terms||[]),
    ...(profile?.disambiguation?.reject_meanings||[])
  ]) {
    if (text.includes(norm(String(x)))) s -= 16;
  }
  const neg = new Set(profile?.disambiguation?.negative_domains || []);
  const host = hostOf(it.url||''); if (host && neg.has(host)) s -= 15;
  if (it.year && it.year >= (profile?.year_min || 2018)) s += 2;
  return s;
}

function diversifyByVenue(items, limit=48, maxPerVenue=4){
  const out = [];
  const counts = new Map();
  const overflow = [];
  for (const it of items) {
    const v = (it.source || 'unknown').toLowerCase();
    const n = counts.get(v) || 0;
    if (n < maxPerVenue) {
      out.push(it);
      counts.set(v, n + 1);
    } else {
      overflow.push(it);
    }
    if (out.length >= limit) return out;
  }
  return out.concat(overflow).slice(0, limit);
}

function roundRobinByVenue(items, limit=48){
  const groups=new Map();
  for(const it of items){
    const v=(it.source||'unknown').toLowerCase();
    if(!groups.has(v)) groups.set(v,[]);
    groups.get(v).push(it);
  }
  const keys=[...groups.keys()];
  const out=[];
  for(let i=0; out.length<Math.min(limit, items.length); i++){
    const k=keys[i%keys.length], g=groups.get(k);
    if (g?.length) out.push(g.shift());
    if (keys.every(key => (groups.get(key)?.length||0)===0)) break;
  }
  return out;
}

module.exports = { scoreHeuristic, scoreHeuristicWithProfile, roundRobinByVenue, diversifyByVenue };
