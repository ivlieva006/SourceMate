// src/core/aggregate.js

const {
  MAX_RESULTS,
  MIN_AI_RELEVANCE_BASE,
  TIMEOUT_LLM_MS,
  TIMEOUT_SEARCH_MS,
  LLM_PARALLEL,
  DYNAMIC_THRESHOLD
} = require('../config/config.js');

const { llmExpandQuery, llmRelevance } = require('../llm/llm.js');
const { buildDomainProfile } = require('./domain_profile.js');
const { searchAll } = require('../data/sources/index.js');
const { dedup, preferLang, toks, norm } = require('./utils.js');
const { scoreHeuristicWithProfile, diversifyByVenue } = require('./ranking.js');
const { computeLexicalRelevance } = require('./lexical_relevance.js');

const pLimit = require('p-limit').default;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject)=>setTimeout(()=>reject(new Error(`Timeout ${ms}ms`)), ms))
  ]);
}

function median(nums){ if(!nums.length) return 0; const a=[...nums].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }

function meaningfulSet(text) {
  return new Set(toks(text).filter(t => t.length > 2));
}

function overlapShare(a, b) {
  if (!a.size || !b.size) return 0;
  let matched = 0;
  for (const t of a) if (b.has(t)) matched += 1;
  return matched / a.size;
}

function keepSearchVariant(original, variant, profile) {
  if (variant === original) return true;

  const originalTokens = meaningfulSet(original);
  const variantTokens = meaningfulSet(variant);
  const profileTokens = meaningfulSet([
    ...(profile.include_terms || []),
    ...(profile.must_have_concepts || []),
    ...(profile.synonyms || [])
  ].join(' '));

  const originalOverlap = overlapShare(originalTokens, variantTokens);
  const profileOverlap = overlapShare(profileTokens, variantTokens);
  const rejected = (profile.disambiguation?.reject_meanings || [])
    .some(term => norm(variant).includes(norm(String(term))));

  return !rejected && (originalOverlap >= 0.35 || profileOverlap >= 0.25);
}

function buildSearchVariants(query, expanded, profile) {
  const candidates = [
    query,
    ...expanded,
    ...((profile.include_terms || []).slice(0, 4).map(t => `${query} ${t}`)),
    ...((profile.must_have_concepts || []).slice(0, 3).map(t => `${query} ${t}`))
  ];

  const seen = new Set();
  return candidates
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .filter(v => {
      const key = norm(v);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return keepSearchVariant(query, v, profile);
    })
    .slice(0, 8);
}

function hasCyrillic(text = '') {
  return /[А-Яа-яЁё]/.test(text);
}

function isRussianItem(item) {
  return item.language === 'ru'
    || hasCyrillic(`${item.title || ''} ${item.description || ''}`)
    || /киберленинка|нэб|википедия/i.test(item.source || '');
}

async function aggregate(query){
  // 1) Профиль темы
  const profile = await withTimeout(buildDomainProfile(query), 12000).catch(()=>null) || {};
  const lang = preferLang(query);
  const qTok = toks(query);

  // 2) Расширяем запрос через LLM
  const exp = await withTimeout(llmExpandQuery(query, profile), 12000).catch(()=>[]) || [];
  const variants = buildSearchVariants(query, exp, profile);

  // 3) Поиск по источникам
  const settled = await withTimeout(Promise.allSettled(
    variants.map(v => searchAll(v).then(items => items.map(it => ({ ...it, _queryVariant: v }))))
  ), TIMEOUT_SEARCH_MS).catch(()=>[]);
  let items = dedup((settled||[]).filter(r=>r.status==='fulfilled').flatMap(r=>r.value));
  if (!items.length) return [];

  // 4) Прескоринг (контекстный) + обрезка до разумного размера.
  // Лексику считаем до обрезки, иначе хорошие статьи с аннотацией,
  // но неидеальным заголовком, могут не дойти до LLM.
  items = items
    .map(x => {
      const _h = scoreHeuristicWithProfile(x, qTok, lang, profile);
      const _lexRel = computeLexicalRelevance(query, x, profile);
      const originalBoost = x._queryVariant === query ? 8 : 0;
      const ruBoost = lang === 'ru' && isRussianItem(x) ? 14 : 0;
      const _preScore = Math.round(_h * 0.45 + _lexRel * 0.55 + originalBoost + ruBoost);
      return { ...x, _h, _lexRel, _preScore };
    })
    .filter(x => x._lexRel >= 25 || x._preScore >= 28)
    .sort((a,b)=>b._preScore-a._preScore)
    .slice(0, 48);

  // 5) LLM-вердикты (ограниченная параллельность + таймауты)
  const limit = pLimit(LLM_PARALLEL);
  const judged = await Promise.all(items.map(it => limit(async ()=>{
    try {
      const r = await withTimeout(llmRelevance(query, it, profile), TIMEOUT_LLM_MS);
      return { ...it, _aiRel: Number(r?.relevance)||0, _aiVerdict: r?.verdict||'include' };
    } catch {
      return { ...it, _aiRel: 0, _aiVerdict: 'unknown' };
    }
  })));

  // 6) Динамический порог по состоянию LLM
  const rels = judged.map(j=>j._aiRel||0);
  const aliveShare = rels.filter(x=>x>0).length / Math.max(1, rels.length);
  const med = median(rels);
  let MIN_AI = MIN_AI_RELEVANCE_BASE;
  if (DYNAMIC_THRESHOLD) {
    if (aliveShare < 0.6 || med < 40) MIN_AI = Math.max(45, MIN_AI - 20);
  }

  // 7) Блендинг: 65% LLM, 35% лексика; если LLM=0, опираемся на лексику.
  for (const it of judged) {
    const ai = it._aiRel || 0;
    const lx = it._lexRel || 0;
    const ruBoost = lang === 'ru' && isRussianItem(it) ? 8 : 0;
    it._blend = Math.min(100, Math.round( (ai>0 ? 0.65*ai + 0.35*lx : lx) + ruBoost ));
  }

  // 8) Фильтр + сортировка по бленду (и страховка по лексике)
  let filtered = judged
    .filter(it => (it._aiVerdict !== 'exclude'))
    .filter(it => (it._aiRel >= MIN_AI) || (it._blend >= Math.max(58, MIN_AI - 8)) || (it._lexRel >= 68))
    .sort((a,b)=> (b._blend||0) - (a._blend||0));

  if (!filtered.length) {
    // крайний фоллбэк — отдать лучшие по лексике
    filtered = judged.sort((a,b)=> (b._lexRel||0) - (a._lexRel||0)).slice(0, MAX_RESULTS);
  }

  // 9) Разнообразие по изданиям без сильного разрушения итогового ранга.
  return diversifyByVenue(filtered, MAX_RESULTS);
}

module.exports = { aggregate };
