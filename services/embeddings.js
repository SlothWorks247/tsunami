/**
 * Embedding client for the MongoDB Atlas Embedding and Reranking API.
 *
 * Calls the /v1/embeddings endpoint at ai.mongodb.com to generate vector
 * embeddings using Voyage AI models. The API is compatible with the
 * Voyage AI REST API format. API keys are managed through the MongoDB
 * Atlas UI (AI Model APIs).
 *
 * Uses Node's built-in fetch (Node 18+). No external npm dependency.
 *
 * For RAG retrieval, pass inputType="document" when embedding notes
 * and inputType="query" when embedding search queries. This lets Voyage
 * prepend the appropriate prompt for better retrieval accuracy.
 * Embeddings with and without inputType are compatible.
 */

const EMBEDDING_ENDPOINT = 'https://ai.mongodb.com/v1/embeddings';
const MAX_BATCH = 50;

const EMBEDDING_MODELS = {
  'voyage-4-large': 1024,
  'voyage-4': 1024,
  'voyage-4-lite': 1024,
  'voyage-4-nano': 512,
  'voyage-code-4': 1024,
  'voyage-3': 1024,
  'voyage-3-lite': 512,
  'voyage-3.5': 1024,
  'voyage-3.5-lite': 512,
  'voyage-finance-2': 1024,
  'voyage-law-2': 1024,
  'voyage-code-3': 1024,
};

const DEFAULT_MODEL = 'voyage-4-lite';

function getEmbeddingDimensions(model) {
  return EMBEDDING_MODELS[model] || EMBEDDING_MODELS[DEFAULT_MODEL];
}

/**
 * Generate embeddings for an array of text strings.
 *
 * @param {string[]} texts - Array of text strings to embed.
 * @param {string} apiKey - MongoDB Atlas model API key.
 * @param {string} model - Embedding model name (e.g. "voyage-4-lite").
 * @param {string|null} inputType - "query" or "document" for RAG, null for generic.
 * @returns {Promise<{ embeddings: number[][], usage: object|null }>}
 */
async function generateEmbeddings(texts, apiKey, model, inputType) {
  if (!texts || texts.length === 0) {
    return { embeddings: [], usage: null };
  }
  if (!apiKey) {
    throw new Error('A model API key is required to generate embeddings.');
  }

  const useModel = model || DEFAULT_MODEL;
  const allEmbeddings = [];
  let totalUsage = null;

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);

    const body = { input: batch, model: useModel };
    if (inputType) {
      body.input_type = inputType;
    }

    let res;
    try {
      res = await fetch(EMBEDDING_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Could not reach the Atlas Embedding and Reranking API. Check your network and API key. (${err.message})`
      );
    }

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.error?.message || body.error || body.detail || JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => res.statusText);
      }
      throw new Error(`Embedding request failed (${res.status}): ${detail}`);
    }

    const data = await res.json();
    const batchEmbeddings = (data.data || []).map((d) => d.embedding);
    allEmbeddings.push(...batchEmbeddings);

    if (data.usage) {
      if (!totalUsage) totalUsage = { total_tokens: 0 };
      totalUsage.total_tokens += data.usage.total_tokens || 0;
    }
  }

  return { embeddings: allEmbeddings, usage: totalUsage };
}

/**
 * Generate an embedding for a single text string.
 *
 * @param {string} text - Text to embed.
 * @param {string} apiKey - MongoDB Atlas model API key.
 * @param {string} model - Embedding model name.
 * @param {string|null} inputType - "query" or "document" for RAG.
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text, apiKey, model, inputType) {
  const { embeddings } = await generateEmbeddings([text], apiKey, model, inputType);
  return embeddings[0];
}

module.exports = {
  generateEmbeddings,
  generateEmbedding,
  getEmbeddingDimensions,
  EMBEDDING_MODELS,
  DEFAULT_MODEL,
};
