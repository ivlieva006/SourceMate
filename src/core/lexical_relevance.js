// src/lexical_relevance.js
const { toks, cosine, norm } = require('./utils.js');

const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'over', 'under', 'about', 'using',
  'use', 'used', 'based', 'study', 'analysis', 'research', 'article', 'paper',
  'как', 'для', 'про', 'при', 'что', 'это', 'или', 'его', 'она', 'они', 'над',
  'под', 'без', 'после', 'через', 'исследование', 'анализ', 'статья', 'работа'
]);

function meaningfulTokens(text) {
  return toks(text).filter(t => !STOPWORDS.has(t));
}

function includesPhrase(textNorm, phrase) {
  const p = norm(phrase);
  return p.length > 2 && textNorm.includes(p);
}

function softTokenMatch(needle, haystackTokens) {
  if (!needle || needle.length < 4) return false;
  const prefix = needle.slice(0, Math.min(6, Math.max(4, needle.length - 1)));
  return haystackTokens.some(t => t === needle || t.startsWith(prefix) || needle.startsWith(t.slice(0, Math.min(6, t.length))));
}

function matchesTerm(textNorm, textTokens, phrase) {
  const p = norm(phrase);
  if (p.length <= 2) return false;
  if (textNorm.includes(p)) return true;

  const phraseTokens = meaningfulTokens(p);
  if (!phraseTokens.length) return false;
  return phraseTokens.every(t => softTokenMatch(t, textTokens));
}

function tokenCoverage(needles, haystackTokens) {
  const wanted = [...new Set(needles.filter(Boolean))];
  if (!wanted.length) return 0;
  const hay = new Set(haystackTokens);
  const matched = wanted.filter(t => hay.has(t)).length;
  return matched / wanted.length;
}

function phraseCoverage(phrases, titleNorm, textNorm, titleTokens, textTokens) {
  const clean = (phrases || [])
    .map(String)
    .map(s => s.trim())
    .filter(Boolean);
  if (!clean.length) return { matched: 0, total: 0, titleMatches: 0 };

  let matched = 0;
  let titleMatches = 0;
  for (const phrase of clean) {
    if (matchesTerm(titleNorm, titleTokens, phrase)) {
      matched += 1;
      titleMatches += 1;
    } else if (matchesTerm(textNorm, textTokens, phrase)) {
      matched += 1;
    }
  }

  return { matched, total: clean.length, titleMatches };
}

/**
 * Вычислить лексическую релевантность 0..100
 * @param {string} query - исходный запрос пользователя
 * @param {object} item  - {title, description, type, year, source, url}
 * @param {object} profile - {include_terms, exclude_terms, year_min, doc_types, disambiguation}
 */
function computeLexicalRelevance(query, item, profile = {}) {
  const qTok = meaningfulTokens(query);
  const title = (item.title || '');
  const abs   = (item.description || '');
  const titleTok = meaningfulTokens(title);
  const absTok = meaningfulTokens(abs);
  const txtTok = [...titleTok, ...absTok];
  const titleNorm = norm(title);
  const textNorm = norm(`${title} ${abs}`);

  // 1) Базовое сходство: заголовок важнее аннотации.
  let score = cosine(qTok, titleTok) * 42 + cosine(qTok, txtTok) * 28;

  // 2) Покрытие смысловых токенов запроса.
  const titleCoverage = tokenCoverage(qTok, titleTok);
  const textCoverage = tokenCoverage(qTok, txtTok);
  score += titleCoverage * 18 + textCoverage * 14;

  // 3) Точная фраза из пользовательского запроса.
  if (includesPhrase(titleNorm, query)) score += 16;
  else if (includesPhrase(textNorm, query)) score += 9;

  // 4) Ключевые термины и обязательные понятия из профиля темы.
  const includePhrases = [
    ...(profile.include_terms || []),
    ...(profile.synonyms || [])
  ];
  const mustPhrases = profile.must_have_concepts || [];
  const includeCoverage = phraseCoverage(includePhrases, titleNorm, textNorm, titleTok, txtTok);
  const mustCoverage = phraseCoverage(mustPhrases, titleNorm, textNorm, titleTok, txtTok);

  if (includeCoverage.total) {
    score += (includeCoverage.matched / includeCoverage.total) * 14;
    score += includeCoverage.titleMatches * 3;
  }

  if (mustCoverage.total) {
    const ratio = mustCoverage.matched / mustCoverage.total;
    score += ratio * 24;
    score += mustCoverage.titleMatches * 4;
    if (ratio === 0) score -= 28;
    else if (ratio <= 0.5) score -= 14;
  }

  // 5) Наказание за стоп-термины и отвергнутые значения.
  const excl = [
    ...(profile.exclude_terms || []),
    ...(profile.disambiguation?.reject_meanings || [])
  ];
  for (const t of excl) {
    if (!t) continue;
    if (matchesTerm(titleNorm, titleTok, t)) score -= 26;
    else if (matchesTerm(textNorm, txtTok, t)) score -= 16;
  }

  // 6) Свежесть (мягкий буст)
  const y = Number(item.year) || 0;
  if (y >= 2021) score += 6;
  else if (y >= 2018) score += 3;

  // 7) Тип документа
  const type = (item.type || '').toLowerCase();
  if (type.includes('journal-article')) score += 4;
  if (type.includes('conference')) score += 2;
  if (type.includes('book') || type.includes('chapter')) score += 2;

  // 8) Ограничение диапазона 0..100
  score = Math.max(0, Math.min(100, Math.round(score)));

  return score;
}

module.exports = { computeLexicalRelevance };
