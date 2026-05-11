const he = require('he');
const pdf = require('pdf-parse');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const MAX_SOURCE_BYTES = Number(process.env.ANTIPLAGIARISM_SOURCE_MAX_BYTES || 3 * 1024 * 1024);
const SOURCE_TIMEOUT_MS = Number(process.env.ANTIPLAGIARISM_SOURCE_TIMEOUT_MS || 9000);

function cleanHtml(html) {
  return he.decode(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function fallbackText(source) {
  return [
    source.title,
    source.description,
    source.source,
    source.year
  ].filter(Boolean).join(' ');
}

async function limitedBuffer(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_SOURCE_BYTES) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchSourceText(source) {
  const url = String(source.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { text: fallbackText(source), fetched: false, reason: 'no-url' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'SourceMate/1.0 (+https://localhost)',
        'Accept': 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.6'
      }
    });

    if (!response.ok) {
      return { text: fallbackText(source), fetched: false, reason: `http-${response.status}` };
    }

    const type = response.headers.get('content-type') || '';
    const buffer = await limitedBuffer(response);
    let text = '';

    if (/pdf/i.test(type) || /\.pdf($|\?)/i.test(url)) {
      const parsed = await pdf(buffer).catch(() => null);
      text = parsed?.text || '';
    } else {
      text = cleanHtml(buffer.toString('utf8'));
    }

    text = text.replace(/\s+/g, ' ').trim();
    if (text.length < 300) {
      return { text: fallbackText(source), fetched: false, reason: 'too-short' };
    }

    return { text, fetched: true, reason: 'ok' };
  } catch (error) {
    return { text: fallbackText(source), fetched: false, reason: error.name || error.code || 'fetch-error' };
  } finally {
    clearTimeout(timer);
  }
}

async function enrichSourcesWithText(sources, { limit = 12, parallel = 3 } = {}) {
  const queue = sources.slice(0, limit);
  const enriched = new Array(queue.length);
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const current = index;
      index += 1;
      const source = queue[current];
      const content = await fetchSourceText(source);
      enriched[current] = { ...source, _contentText: content.text, _contentFetched: content.fetched, _contentReason: content.reason };
    }
  }

  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
  return [
    ...enriched.filter(Boolean),
    ...sources.slice(limit).map(source => ({ ...source, _contentText: fallbackText(source), _contentFetched: false, _contentReason: 'not-fetched' }))
  ];
}

module.exports = {
  enrichSourcesWithText,
  fetchSourceText,
  fallbackText
};
