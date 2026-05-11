const { searchCrossref } = require('./crossref.js');
const { searchSemanticScholar } = require('./semanticscholar.js');
const { searchWikipedia } = require('./wikipedia.js');
const { searchOpenAlexRu } = require('./openalex.js');
const { searchCyberLeninka } = require('./cyberleninka.js');
let searchRusneb; try { ({ searchRusneb } = require('./rusneb.js')); } catch {}

async function searchAll(query) {
  const [c,s,w,o,cl,n] = await Promise.allSettled([
    searchCrossref(query),
    searchSemanticScholar(query),
    searchWikipedia(query),
    searchOpenAlexRu(query),
    searchCyberLeninka(query),
    searchRusneb ? searchRusneb(query) : Promise.resolve([])
  ]);
  const out = [];
  for (const r of [c,s,w,o,cl,n]) if (r.status==='fulfilled') out.push(...r.value);
  return out;
}

module.exports = { searchAll };
