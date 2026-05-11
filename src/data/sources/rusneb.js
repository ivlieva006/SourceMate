// === rusneb.js ===
// Поиск по Национальной электронной библиотеке (https://rusneb.ru)

async function searchRusneb(query, limit = 10) {
  const url = `https://rusneb.ru/api/catalog/?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  const items = data?.items || [];
  return items.map(it => ({
    source: 'НЭБ (rusneb.ru)',
    title: it.title || 'Без названия',
    url: it.url || '',
    description: it.description || '',
    year: it.year,
    authors: it.authors?.join(', '),
    type: it.type || 'book',
    doi: undefined // НЭБ не использует DOI
  }));
}

module.exports = { searchRusneb };
