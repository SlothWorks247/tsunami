/**
 * Text chunking utility for RAG embeddings.
 *
 * Splits long text into overlapping chunks suitable for vector embeddings.
 * Chunking strategy:
 *   1. Split by paragraph boundaries (double newline)
 *   2. Accumulate paragraphs up to ~TARGET_CHARS
 *   3. If a single paragraph exceeds TARGET_CHARS, split by sentences
 *   4. If a single sentence exceeds TARGET_CHARS, split by characters
 *   5. Adjacent chunks overlap by ~OVERLAP_CHARS for boundary continuity
 *
 * Each chunk is prefixed with [Note: {title}] for context.
 */

const TARGET_CHARS = 2000;
const OVERLAP_CHARS = 200;

function splitSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g);
  return matches ? matches : [text];
}

function splitByChars(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/**
 * Chunk a text string into overlapping passages.
 *
 * @param {string} text - The full text content to chunk.
 * @param {string} title - Note title, used as a prefix for each chunk.
 * @returns {{ text: string, chunkIndex: number }[]}
 */
function chunkText(text, title) {
  if (!text || !text.trim()) return [];

  const prefix = title ? `[Note: ${title}]\n` : '';
  const fullText = prefix + text.trim();

  if (fullText.length <= TARGET_CHARS) {
    return [{ text: fullText, chunkIndex: 0 }];
  }

  const paragraphs = fullText.split(/\n\s*\n/);
  const chunks = [];
  let current = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (para.length > TARGET_CHARS) {
      if (current.trim()) {
        chunks.push({ text: current.trim(), chunkIndex: chunkIndex++ });
        current = current.slice(-OVERLAP_CHARS);
      }

      const sentences = splitSentences(para);
      for (const sentence of sentences) {
        if (sentence.length > TARGET_CHARS) {
          if (current.trim()) {
            chunks.push({ text: current.trim(), chunkIndex: chunkIndex++ });
            current = current.slice(-OVERLAP_CHARS);
          }
          const charChunks = splitByChars(sentence, TARGET_CHARS - OVERLAP_CHARS);
          for (const cc of charChunks) {
            if (current.trim()) {
              chunks.push({ text: current.trim(), chunkIndex: chunkIndex++ });
              current = current.slice(-OVERLAP_CHARS);
            }
            current += cc;
          }
        } else if (current.length + sentence.length > TARGET_CHARS && current.trim()) {
          chunks.push({ text: current.trim(), chunkIndex: chunkIndex++ });
          current = current.slice(-OVERLAP_CHARS) + sentence;
        } else {
          current += sentence;
        }
      }
    } else if (current.length + para.length + 2 > TARGET_CHARS && current.trim()) {
      chunks.push({ text: current.trim(), chunkIndex: chunkIndex++ });
      current = current.slice(-OVERLAP_CHARS) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim()) {
    chunks.push({ text: current.trim(), chunkIndex: chunkIndex++ });
  }

  return chunks;
}

module.exports = { chunkText, TARGET_CHARS, OVERLAP_CHARS };
