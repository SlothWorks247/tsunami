/**
 * File text extraction service.
 *
 * Extracts text content from uploaded files so it can be stored on the
 * note document and later embedded for vector search.
 *
 * Supported formats:
 *   - Plain text: .txt, .csv, .json, .md, .log, .xml, .html, .js, .py, .yaml, etc.
 *   - PDF: .pdf
 *   - Word: .docx
 *   - Excel: .xlsx
 *   - PowerPoint: .pptx
 *   - Images: .png, .jpg, .jpeg, .gif, .bmp, .webp (via OCR with tesseract.js)
 *
 * Never throws — always returns a string (empty on failure).
 */

const PLAIN_TEXT_EXTS = [
  'txt', 'csv', 'json', 'md', 'log', 'xml', 'html', 'htm',
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs',
  'yaml', 'yml', 'ini', 'cfg', 'conf', 'sh', 'bat', 'sql',
  'rtf', 'css', 'scss', 'less', 'vue', 'jsx', 'tsx',
];

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

const MAX_TEXT_LENGTH = 100000;

const pdfParse = require('pdf-parse');

function getExtension(filename) {
  const parts = String(filename || '').toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function truncate(text) {
  if (text.length > MAX_TEXT_LENGTH) {
    return text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }
  return text;
}

async function extractFromPdf(buffer) {
  const origWarn = console.warn;
  const origErr = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } finally {
    console.warn = origWarn;
    console.error = origErr;
  }
}

async function extractFromDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

async function extractFromXlsx(buffer) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheets.push(`[Sheet: ${name}]\n${csv}`);
  }
  return sheets.join('\n\n');
}

async function extractFromPptx(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1], 10);
      const numB = parseInt(b.match(/slide(\d+)/)[1], 10);
      return numA - numB;
    });

  const slides = [];
  for (const slideFile of slideFiles) {
    const content = await zip.files[slideFile].async('string');
    const texts = [];
    const regex = /<a:t>([^<]*)<\/a:t>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1].trim()) texts.push(match[1]);
    }
    if (texts.length > 0) {
      const slideNum = slideFile.match(/slide(\d+)/)[1];
      slides.push(`[Slide ${slideNum}]\n${texts.join('\n')}`);
    }
  }
  return slides.join('\n\n');
}

async function extractFromImage(buffer) {
  const Tesseract = require('tesseract.js');
  const { data } = await Tesseract.recognize(buffer, 'eng');
  return data.text || '';
}

async function extractText(buffer, mimeType, filename) {
  if (!buffer || buffer.length === 0) return '';

  const ext = getExtension(filename);

  try {
    let text = '';

    if (PLAIN_TEXT_EXTS.includes(ext)) {
      text = buffer.toString('utf8');
    } else if (ext === 'pdf') {
      text = await extractFromPdf(buffer);
    } else if (ext === 'docx') {
      text = await extractFromDocx(buffer);
    } else if (ext === 'xlsx') {
      text = await extractFromXlsx(buffer);
    } else if (ext === 'pptx') {
      text = await extractFromPptx(buffer);
    } else if (IMAGE_EXTS.includes(ext)) {
      text = await extractFromImage(buffer);
    } else {
      return '';
    }

    return truncate((text || '').trim());
  } catch (err) {
    console.warn(`Text extraction failed for ${filename}: ${err.message}`);
    return '';
  }
}

module.exports = { extractText };
