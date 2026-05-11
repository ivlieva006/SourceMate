const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');

const MAX_TEXT_CHARS = 180000;

function cleanText(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function extensionOf(filename = '') {
  return path.extname(filename).toLowerCase();
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text || '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractTextFromBuffer(buffer, filename = '', mimetype = '') {
  const ext = extensionOf(filename);
  const type = String(mimetype || '').toLowerCase();

  if (ext === '.txt' || type.startsWith('text/')) {
    return cleanText(buffer.toString('utf8'));
  }

  if (ext === '.docx' || type.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer });
    return cleanText(result.value);
  }

  if (ext === '.pdf' || type.includes('pdf')) {
    return cleanText(await extractPdf(buffer));
  }

  throw new Error('Поддерживаются только TXT, DOCX и PDF');
}

module.exports = { extractTextFromBuffer, cleanText };
