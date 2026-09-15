/**
 * Retrieval layer for RAG (Retrieval-Augmented Generation).
 *
 * Supports two retrieval modes controlled by voyageConfig.mode:
 *   'smart'   — vector search via Atlas $vectorSearch (default)
 *   'normal'  — context stuffing (all notes)
 *
 * Smart mode falls back to context stuffing when vector search fails
 * at runtime (no embeddings, index missing, API error, etc.).
 *
 * Returns { context, count, total, method } where method is 'vector' or 'stuffing'.
 *
 * Unlike digitaltwin, tsunami scopes notes by (customer, app) collection
 * rather than by personId, so no filter field is needed in $vectorSearch.
 */

const {
  getAppNotesCollection,
  getAppNoteChunksCollection,
} = require("../db");
const { generateEmbedding } = require("./embeddings");
const { logStep } = require("./logger");

const VECTOR_SEARCH_LIMIT = 15;
const VECTOR_SEARCH_CANDIDATES = 100;
const MAX_NOTES = 5;

async function getContextStuffing(sessionId, customerSlug, appSlug) {
  const notes = await getAppNotesCollection(sessionId, customerSlug, appSlug)
    .find({
      $or: [
        { type: "text" },
        { textContent: { $exists: true, $ne: "" } },
      ],
    })
    .sort({ createdAt: -1 })
    .toArray();

  if (notes.length === 0)
    return { context: "", count: 0, total: 0, method: "stuffing" };

  const formattedNotes = [];
  for (const n of notes) {
    const content = n.type === "text" ? n.body : n.textContent;
    if (!content || !content.trim()) continue;
    const typeLabel = n.type === "file" ? `file: ${n.filename}` : "text";
    formattedNotes.push(`[Note: ${n.title} (${typeLabel})]\n${content}`);
  }

  return {
    context: formattedNotes.join("\n\n---\n\n"),
    count: formattedNotes.length,
    total: notes.length,
    method: "stuffing",
  };
}

async function getVectorSearchResults(
  sessionId,
  customerSlug,
  appSlug,
  query,
  voyageConfig
) {
  const model = voyageConfig.model || "voyage-4-lite";
  logStep(
    sessionId,
    `Embedding query via ${model} (input_type: query)...`,
    "info"
  );

  const queryEmbedding = await generateEmbedding(
    query,
    voyageConfig.apiKey,
    model,
    "query"
  );

  if (!queryEmbedding || queryEmbedding.length === 0) {
    logStep(sessionId, "Query embedding returned empty vector", "error");
    return null;
  }

  logStep(
    sessionId,
    `Query embedded: ${queryEmbedding.length} dimensions`,
    "success"
  );
  logStep(
    sessionId,
    `Running $vectorSearch (100 candidates, top 15 chunks)...`,
    "info"
  );

  const chunks = await getAppNoteChunksCollection(
    sessionId,
    customerSlug,
    appSlug
  )
    .aggregate([
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: VECTOR_SEARCH_CANDIDATES,
          limit: VECTOR_SEARCH_LIMIT,
        },
      },
      {
        $project: {
          noteId: 1,
          text: 1,
          chunkIndex: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();

  if (chunks.length === 0) {
    logStep(sessionId, "Vector search returned 0 chunks", "info");
    return null;
  }

  const uniqueNoteIds = [...new Set(chunks.map((c) => c.noteId))].slice(
    0,
    MAX_NOTES
  );
  logStep(
    sessionId,
    `Vector search returned ${chunks.length} chunks from ${uniqueNoteIds.length} notes (top ${MAX_NOTES} selected)`,
    "success"
  );

  const notes = await getAppNotesCollection(sessionId, customerSlug, appSlug)
    .find({ _id: { $in: uniqueNoteIds } })
    .toArray();

  const noteMap = new Map(notes.map((n) => [n._id.toString(), n]));
  const orderedNoteIds = uniqueNoteIds.filter((id) =>
    noteMap.has(id.toString())
  );

  const totalNotes = await getAppNotesCollection(
    sessionId,
    customerSlug,
    appSlug
  ).countDocuments({
    $or: [
      { type: "text" },
      { textContent: { $exists: true, $ne: "" } },
    ],
  });

  const formattedNotes = [];
  for (const noteId of orderedNoteIds) {
    const n = noteMap.get(noteId.toString());
    if (!n) continue;
    const content = n.type === "text" ? n.body : n.textContent;
    if (!content || !content.trim()) continue;
    const typeLabel = n.type === "file" ? `file: ${n.filename}` : "text";
    formattedNotes.push(`[Note: ${n.title} (${typeLabel})]\n${content}`);
  }

  if (formattedNotes.length === 0) {
    return null;
  }

  return {
    context: formattedNotes.join("\n\n---\n\n"),
    count: formattedNotes.length,
    total: totalNotes,
    method: "vector",
  };
}

async function getRelevantNotes(
  sessionId,
  customerSlug,
  appSlug,
  query,
  voyageConfig
) {
  const mode = (voyageConfig && voyageConfig.mode) || "smart";

  if (mode === "normal") {
    logStep(
      sessionId,
      "Retrieval mode: normal (context stuffing — all notes)",
      "info"
    );
    return getContextStuffing(sessionId, customerSlug, appSlug);
  }

  if (!voyageConfig || !voyageConfig.apiKey) {
    logStep(
      sessionId,
      "No embedding API key configured — using context stuffing",
      "info"
    );
    return getContextStuffing(sessionId, customerSlug, appSlug);
  }

  logStep(sessionId, `Retrieval mode: smart (vector search)`, "info");
  try {
    const result = await getVectorSearchResults(
      sessionId,
      customerSlug,
      appSlug,
      query,
      voyageConfig
    );
    if (result) return result;
    logStep(
      sessionId,
      "Vector search returned no results — falling back to context stuffing",
      "info"
    );
    return getContextStuffing(sessionId, customerSlug, appSlug);
  } catch (err) {
    logStep(
      sessionId,
      `Vector search failed: ${err.message} — falling back to context stuffing`,
      "error"
    );
    console.warn(
      "Vector search failed, falling back to context stuffing:",
      err.message
    );
    return getContextStuffing(sessionId, customerSlug, appSlug);
  }
}

module.exports = { getRelevantNotes };
