const { aggregate } = require('./aggregate.js');
const { extractTextFromBuffer, cleanText } = require('./file_text.js');
const { enrichSourcesWithText, fallbackText } = require('./source_content.js');
const { LLM_ENABLED } = require('../config/config.js');
const { llmMatchAdvice } = require('../llm/llm.js');

const SOURCE_FETCH_LIMIT = Number(process.env.ANTIPLAGIARISM_SOURCE_LIMIT || 12);
const SOURCE_FETCH_PARALLEL = Number(process.env.ANTIPLAGIARISM_SOURCE_PARALLEL || 3);
const SHINGLE_SIZE = Number(process.env.ANTIPLAGIARISM_SHINGLE_SIZE || 5);

const STOP = new Set([
  'что', 'как', 'для', 'это', 'или', 'при', 'над', 'под', 'про', 'без', 'уже',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were'
]);

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .match(/[a-zа-я0-9]{3,}/gi)?.filter(w => !STOP.has(w)) || [];
}

function shingles(list, size = SHINGLE_SIZE) {
  const out = new Map();
  for (let i = 0; i <= list.length - size; i += 1) {
    const key = list.slice(i, i + size).join(' ');
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(i);
  }
  return out;
}

function inferTopic(text, filename = '') {
  const first = cleanText(text).split(/[.!?]/).find(s => words(s).length >= 4) || '';
  const candidate = first || filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return candidate.split(/\s+/).slice(0, 14).join(' ').trim();
}

function sourceText(item) {
  return cleanText(item._contentText || fallbackText(item));
}

function publicSourceMeta(source) {
  const authors = Array.isArray(source.authors)
    ? source.authors
    : String(source.authors || '').split(/,\s*/).map(a => a.trim()).filter(Boolean);

  return {
    title: source.title || 'Источник без названия',
    description: source.description || '',
    url: source.url || '',
    source: source.source || '',
    year: source.year || '',
    type: source.type || '',
    doi: source.doi || '',
    citations: source.citations || source.citationCount || '',
    authors,
    venue: source.venue || source.source || '',
    publisher: source.publisher || '',
    score: source._blend || source._lexRel || source._aiRel || source.score || 0,
    fetched: Boolean(source._contentFetched)
  };
}

function snippetFromWords(list, index, size) {
  const start = Math.max(0, index - 10);
  const end = Math.min(list.length, index + size + 18);
  return list.slice(start, end).join(' ');
}

function uniqueNumbers(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function compactPositions(positions, gap = SHINGLE_SIZE + 2) {
  const sorted = uniqueNumbers(positions);
  const groups = [];
  for (const pos of sorted) {
    const last = groups[groups.length - 1];
    if (!last || pos - last[last.length - 1] > gap) groups.push([pos]);
    else last.push(pos);
  }
  return groups;
}

function compareWithSources(documentText, sources) {
  const docWords = words(documentText);
  const docShingles = shingles(docWords);
  const matched = new Set();

  const matches = sources.map(source => {
    const sw = words(sourceText(source));
    const sourceShingles = shingles(sw);
    const docPositions = [];
    const sharedShingles = new Set();

    for (const [shingle, docIndexes] of docShingles) {
      if (sourceShingles.has(shingle)) {
        matched.add(shingle);
        sharedShingles.add(shingle);
        docPositions.push(...docIndexes);
      }
    }

    const sharedCount = sharedShingles.size;
    const sourceCoverage = sourceShingles.size ? sharedCount / sourceShingles.size : 0;
    const docCoverage = docShingles.size ? sharedCount / docShingles.size : 0;
    const score = Math.min(100, Math.round(Math.max(sourceCoverage * 100, docCoverage * 100 * 2.2)));
    const fragmentGroups = compactPositions(docPositions).slice(0, 4);

    return {
      ...publicSourceMeta(source),
      fetched: Boolean(source._contentFetched),
      sourceTextStatus: source._contentReason || '',
      score,
      matchedFragments: fragmentGroups.map(group => snippetFromWords(docWords, group[0], SHINGLE_SIZE + group.length))
    };
  })
    .filter(item => item.score > 0 && item.matchedFragments.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const suspiciousShare = docShingles.size ? matched.size / docShingles.size : 0;
  const similarity = Math.min(100, Math.round(suspiciousShare * 100));
  const originality = Math.max(0, 100 - similarity);

  return {
    words: docWords.length,
    checkedFragments: docShingles.size,
    similarity,
    originality,
    matches
  };
}

async function addLlmAdvice(report) {
  if (!LLM_ENABLED || !report.matches?.length) return report;

  const tasks = [];
  report.matches.slice(0, 5).forEach((match) => {
    match.matchedFragments.slice(0, 2).forEach((fragment) => {
      tasks.push({ match, fragment });
    });
  });

  for (const task of tasks.slice(0, 6)) {
    try {
      task.match.advice ||= [];
      const advice = await Promise.race([
        llmMatchAdvice(task.fragment, task.match),
        new Promise((_, reject) => setTimeout(() => reject(new Error('llm-timeout')), 8000))
      ]);
      if (advice) task.match.advice.push(advice);
    } catch {
      // Advice is optional; exact matching already produced the report.
    }
  }

  return report;
}

async function analyzeAntiplagiarism({ buffer, filename, mimetype, topic }) {
  const text = await extractTextFromBuffer(buffer, filename, mimetype);
  if (words(text).length < 40) {
    throw new Error('В файле слишком мало текста для проверки');
  }

  const query = String(topic || '').trim() || inferTopic(text, filename);
  if (!query) throw new Error('Укажите тему проверки');

  const sources = await aggregate(query);
  const enrichedSources = await enrichSourcesWithText(sources, {
    limit: SOURCE_FETCH_LIMIT,
    parallel: SOURCE_FETCH_PARALLEL
  });
  const comparison = compareWithSources(text, enrichedSources);

  const report = {
    topic: query,
    filename,
    sourceItems: enrichedSources.slice(0, 8).map(publicSourceMeta),
    sourcesChecked: sources.length,
    sourcesFetched: enrichedSources.filter(source => source._contentFetched).length,
    ...comparison,
    generatedAt: new Date().toISOString()
  };

  return addLlmAdvice(report);
}

function formatReportText(report) {
  const lines = [
    `Проверка файла: ${report.filename || 'документ'}`,
    `Тема: ${report.topic}`,
    `Оригинальность: ${report.originality}%`,
    `Совпадения: ${report.similarity}%`,
    `Проверено источников: ${report.sourcesChecked}`,
    `Загружено текстов источников: ${report.sourcesFetched || 0}`,
    `Слов в документе: ${report.words}`
  ];

  if (report.matches.length) {
    lines.push('', 'Похожие источники:');
    report.matches.slice(0, 5).forEach((match, index) => {
      lines.push(`${index + 1}. ${match.title} — ${match.score}%${match.fetched ? ' (текст источника загружен)' : ''}`);
      if (match.url) lines.push(match.url);
      if (match.matchedFragments?.length) {
        lines.push(`Фрагмент: ${match.matchedFragments[0].slice(0, 360)}${match.matchedFragments[0].length > 360 ? '…' : ''}`);
      }
      if (match.advice?.length) lines.push(`Совет: ${match.advice[0]}`);
    });
  } else {
    lines.push('', 'Заметных совпадений с найденными источниками не обнаружено.');
  }

  return lines.join('\n');
}

module.exports = {
  analyzeAntiplagiarism,
  compareWithSources,
  formatReportText
};
