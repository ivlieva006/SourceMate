require('dotenv').config();

const cfg = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  LLM_ENABLED: (process.env.LLM_ENABLED || 'false').toLowerCase() === 'true',
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  LLM_MODEL: process.env.LLM_MODEL || 'llama3.1',
  LLM_REQUIRED: true,

  CROSSREF_ROWS: 40,
  S2_LIMIT: 16,
  WIKI_LIMIT: 4,
  OPENALEX_LIMIT: 20,
  CYBERLENINKA_LIMIT: 20,

  MAX_RESULTS: 48,
  TG_LIMIT: 4096,
  SAFE_MARGIN: 200,
  MIN_AI_RELEVANCE_BASE: 70, 
  TIMEOUT_LLM_MS: 15000,
  TIMEOUT_SEARCH_MS: 30000,
  LLM_PARALLEL: 4,  
  DYNAMIC_THRESHOLD: true, 


  MIN_AI_RELEVANCE: 70, // порог релевантности
};

module.exports = cfg;
