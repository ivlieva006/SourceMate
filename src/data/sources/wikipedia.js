const pLimit = require('p-limit').default;
const { WIKI_LIMIT } = require('../../config/config.js');
const { preferLang } = require('../../core/utils.js');

async function searchWikipedia(q){
  const wikiLang = preferLang(q) === 'ru' ? 'ru' : 'en';
  const url=`https://${wikiLang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srsearch=${encodeURIComponent(q)}&srlimit=${WIKI_LIMIT}`;
  const js=await fetch(url).then(r=>r.json());
  const pages=js?.query?.search||[];
  const limit=pLimit(2);
  return Promise.all(pages.map(p=>limit(async()=>{
    const s=`https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.title)}`;
    const d=await fetch(s).then(r=>r.json());
    return {
      source: wikiLang === 'ru' ? 'Википедия' : 'Wikipedia',
      title:d?.title||p.title,
      url:d?.content_urls?.desktop?.page||`https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
      description:d?.extract||'',
      year:undefined,
      doi:undefined,
      type:'reference',
      language: wikiLang
    };
  })));
}
module.exports = { searchWikipedia };
