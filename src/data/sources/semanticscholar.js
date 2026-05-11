const { S2_LIMIT } = require('../../config/config.js');

async function searchSemanticScholar(q){
  const f=['title','year','abstract','url','externalIds','venue','citationCount','publicationVenue','authors'].join(',');
  const url=`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${S2_LIMIT}&fields=${f}`;
  const js=await fetch(url).then(r=>r.json());
  const data=js?.data||[];
  return data.map(p=>({
    source: p.venue || 'Semantic Scholar',
    title: p.title,
    url: p.url,
    description: p.abstract || '',
    year: p.year,
    doi: p.externalIds?.DOI,
    citations: p.citationCount || 0,
    authors: Array.isArray(p.authors) ? p.authors.map(a => a.name).filter(Boolean).slice(0, 8) : [],
    venue: p.publicationVenue?.name || p.venue || '',
    type: 'paper'
  })).filter(x=>x.title&&x.url);
}
module.exports = { searchSemanticScholar };
