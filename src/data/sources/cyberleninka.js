const he = require('he');
const { CYBERLENINKA_LIMIT } = require('../../config/config.js');

function cleanText(s = '') {
  return he.decode(String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function articleDescription(article) {
  const annotation = cleanText(article.annotation || '');
  if (annotation) return annotation;

  const ocr = Array.isArray(article.ocr) ? article.ocr.map(cleanText).join(' ') : '';
  return ocr.replace(/\s+/g, ' ').trim();
}

async function searchCyberLeninka(q) {
  const res = await fetch('https://cyberleninka.ru/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'source-finder-bot/1.6'
    },
    body: JSON.stringify({
      mode: 'articles',
      q,
      size: CYBERLENINKA_LIMIT,
      from: 0
    })
  });

  if (!res.ok) return [];
  const js = await res.json();
  const articles = js?.articles || [];

  return articles.map(article => ({
    source: article.journal ? `КиберЛенинка • ${cleanText(article.journal)}` : 'КиберЛенинка',
    title: cleanText(article.name),
    url: article.link ? `https://cyberleninka.ru${article.link}` : '',
    description: articleDescription(article),
    year: article.year,
    authors: Array.isArray(article.authors) ? article.authors.join(', ') : undefined,
    doi: undefined,
    type: 'journal-article',
    language: 'ru'
  })).filter(x => x.title && x.url);
}

module.exports = { searchCyberLeninka };
