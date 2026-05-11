const { OPENALEX_LIMIT } = require('../../config/config.js');

function restoreAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';

  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) words[pos] = word;
  }

  return words.filter(Boolean).join(' ');
}

function bestUrl(work) {
  return work.primary_location?.landing_page_url
    || work.open_access?.oa_url
    || work.doi
    || work.id;
}

async function searchOpenAlexRu(q) {
  const params = new URLSearchParams({
    search: q,
    filter: 'language:ru',
    'per-page': String(OPENALEX_LIMIT),
    sort: 'relevance_score:desc'
  });

  const url = `https://api.openalex.org/works?${params.toString()}`;
  const js = await fetch(url, {
    headers: { 'User-Agent': 'source-finder-bot/1.6 (mailto:example@example.com)' }
  }).then(r => r.ok ? r.json() : null);

  const works = js?.results || [];
  return works.map(work => ({
    source: work.primary_location?.source?.display_name || 'OpenAlex RU',
    title: work.display_name || work.title,
    url: bestUrl(work),
    description: restoreAbstract(work.abstract_inverted_index),
    year: work.publication_year,
    doi: work.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, '') : undefined,
    citations: work.cited_by_count || 0,
    authors: (work.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 8),
    venue: work.primary_location?.source?.display_name || '',
    type: work.type || 'paper',
    language: work.language || 'ru'
  })).filter(x => x.title && x.url);
}

module.exports = { searchOpenAlexRu };
