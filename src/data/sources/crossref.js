const he = require('he');
const { CROSSREF_ROWS } = require('../../config/config.js');

async function searchCrossref(q){
  const url=`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${CROSSREF_ROWS}&sort=score&order=desc`;
  const js=await fetch(url,{headers:{'User-Agent':'source-finder-bot/1.6'}}).then(r=>r.json());
  const items=js?.message?.items||[];
  return items.map(it=>{
    const container=it['container-title']?.[0];
    const publisher=it.publisher;
    const src=container||publisher||'Crossref';
    const linkHtml = Array.isArray(it.link)
      ? it.link.find(l=>(l['content-type']||'').includes('text/html'))?.URL || it.link[0]?.URL
      : null;
    return {
      source: src,
      title: it.title?.[0],
      url: linkHtml || it.URL,
      description: it.abstract ? he.decode(String(it.abstract).replace(/<\/?jats:[^>]+>/g,'')) : '',
      year: it['issued']?.['date-parts']?.[0]?.[0] || it['created']?.['date-parts']?.[0]?.[0],
      doi: it.DOI,
      citations: it['is-referenced-by-count'] || 0,
      authors: Array.isArray(it.author)
        ? it.author.map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 8)
        : [],
      venue: container || '',
      publisher: publisher || '',
      type: it.type || ''
    };
  }).filter(x=>x.title&&x.url);
}
module.exports = { searchCrossref };
