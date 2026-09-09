const {
  getCustomerDb,
  getCustomersCollection,
  getAppNotesCollection,
} = require("../db");

const SAMPLE_SIZE = 100;
const LARGE_BODY_WARN_BYTES = 1 * 1024 * 1024; // 1 MB
const LARGE_BODY_URGENT_BYTES = 8 * 1024 * 1024; // 8 MB

function typeOf(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value && value._bsontype === "ObjectId") return "objectId";
  return typeof value;
}

/**
 * Samples documents from a customer+app's notes collection and reports
 * schema design concerns: field-type drift, oversized documents, and
 * missing recommended indexes.
 */
async function generateSchemaReport(customerSlug, appSlug) {
  const customer = await getCustomersCollection().findOne({
    dbSlug: customerSlug,
  });
  if (!customer) {
    throw new Error("Customer not found");
  }
  const app = (customer.apps || []).find((a) => a.appSlug === appSlug);
  if (!app) {
    throw new Error("App not found for this customer");
  }

  const notesCollection = getAppNotesCollection(customerSlug, appSlug);

  const sample = await notesCollection
    .aggregate([{ $sample: { size: SAMPLE_SIZE } }])
    .toArray();

  // --- Field type drift ---
  const fieldTypes = new Map(); // fieldName -> Set of types
  for (const doc of sample) {
    for (const [key, value] of Object.entries(doc)) {
      if (key === "_id") continue;
      const t = typeOf(value);
      if (t === "null") continue; // null/missing doesn't count as drift
      if (!fieldTypes.has(key)) fieldTypes.set(key, new Set());
      fieldTypes.get(key).add(t);
    }
  }
  const driftFields = [...fieldTypes.entries()].filter(
    ([, types]) => types.size > 1
  );

  // --- Oversized documents ---
  const oversized = [];
  for (const doc of sample) {
    const approxSize = Buffer.byteLength(JSON.stringify(doc));
    if (approxSize >= LARGE_BODY_URGENT_BYTES) {
      oversized.push({ id: doc._id, size: approxSize, level: "urgent" });
    } else if (approxSize >= LARGE_BODY_WARN_BYTES) {
      oversized.push({ id: doc._id, size: approxSize, level: "warning" });
    }
  }

  // --- Index check on notes collection ---
  const existingIndexes = await notesCollection.indexes();
  const indexKeys = existingIndexes.map((i) => JSON.stringify(i.key));
  const hasCreatedAtIndex = indexKeys.some((k) => k === JSON.stringify({ createdAt: -1 }));
  const hasExternalIdIndex = existingIndexes.some(
    (i) => i.key && i.key.externalId !== undefined
  );

  // --- GridFS bucket index check ---
  const db = getCustomerDb(customerSlug);
  let gridfsChunksIndexOk = true;
  try {
    const chunksIndexes = await db
      .collection(`${appSlug}-uploads.chunks`)
      .indexes();
    gridfsChunksIndexOk = chunksIndexes.some(
      (i) => i.key && i.key.files_id !== undefined && i.key.n !== undefined
    );
  } catch {
    // chunks collection may not exist yet if no files uploaded
    gridfsChunksIndexOk = true;
  }

  // --- Type/source breakdown ---
  const typeCounts = { text: 0, file: 0, other: 0 };
  for (const doc of sample) {
    if (doc.type === "text") typeCounts.text++;
    else if (doc.type === "file") typeCounts.file++;
    else typeCounts.other++;
  }

  const lines = [];
  lines.push(`SCHEMA DESIGN FINDINGS`);
  lines.push(`Customer: ${customer.name}`);
  lines.push(`App: ${app.name}`);
  lines.push(`Sampled ${sample.length} document(s) (max sample size: ${SAMPLE_SIZE})`);
  lines.push("");

  lines.push(`Document Type Breakdown`);
  lines.push(`- Text notes: ${typeCounts.text}`);
  lines.push(`- File notes: ${typeCounts.file}`);
  if (typeCounts.other) lines.push(`- Other/unrecognized: ${typeCounts.other}`);
  lines.push("");

  lines.push(`Field Type Consistency`);
  if (driftFields.length === 0) {
    lines.push(`- No field-type drift detected across sampled documents.`);
  } else {
    for (const [field, types] of driftFields) {
      lines.push(
        `- WARNING: field "${field}" has inconsistent types across documents: ${[...types].join(
          ", "
        )}. Consider normalizing to a single type.`
      );
    }
  }
  lines.push("");

  lines.push(`Document Size`);
  if (oversized.length === 0) {
    lines.push(`- No oversized documents found in sample.`);
  } else {
    for (const o of oversized) {
      const label = o.level === "urgent" ? "URGENT" : "WARNING";
      lines.push(
        `- ${label}: document ${o.id} is approximately ${(o.size / 1024 / 1024).toFixed(
          2
        )} MB. Consider splitting large content out (e.g. GridFS) rather than storing inline.`
      );
    }
  }
  lines.push("");

  lines.push(`Indexes`);
  lines.push(
    `- createdAt index: ${hasCreatedAtIndex ? "present" : "MISSING - recommended for sorting notes by date"}`
  );
  lines.push(
    `- externalId unique/sparse index: ${
      hasExternalIdIndex ? "present" : "MISSING - recommended for future external sync dedupe (e.g. Salesforce)"
    }`
  );
  lines.push(
    `- GridFS chunks index (files_id + n): ${
      gridfsChunksIndexOk ? "present" : "MISSING - GridFS reads/writes may be slow without it"
    }`
  );

  const text = lines.join("\n");

  return {
    text,
    data: {
      customer: customer.name,
      app: app.name,
      sampledCount: sample.length,
      typeCounts,
      driftFields: driftFields.map(([field, types]) => ({
        field,
        types: [...types],
      })),
      oversized,
      hasCreatedAtIndex,
      hasExternalIdIndex,
      gridfsChunksIndexOk,
    },
  };
}

module.exports = { generateSchemaReport };
