const { MongoClient, GridFSBucket } = require("mongodb");

const clients = new Map();

/**
 * Turn an arbitrary display name (customer or app name) into a safe,
 * lowercase, hyphenated slug suitable for use as a MongoDB database or
 * collection name segment.
 */
function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error(
      `"${name}" could not be converted into a valid identifier. Use letters or numbers.`
    );
  }
  if (slug.length > 38) {
    throw new Error(
      `"${name}" is too long (${slug.length} chars). Please use a shorter name (max 38 characters once slugified).`
    );
  }
  return slug;
}

const DEFAULT_PRICING_TIERS = [
  { tier: "M0", ramGB: null, storageGB: 0.5, vCPUs: null, monthlyPrice: 0 },
  { tier: "M2", ramGB: null, storageGB: 2, vCPUs: null, monthlyPrice: 9 },
  { tier: "M5", ramGB: null, storageGB: 5, vCPUs: null, monthlyPrice: 25 },
  { tier: "M10", ramGB: 2, storageGB: 10, vCPUs: 2, monthlyPrice: 58.4 },
  { tier: "M20", ramGB: 4, storageGB: 20, vCPUs: 2, monthlyPrice: 146.0 },
  { tier: "M30", ramGB: 8, storageGB: 40, vCPUs: 2, monthlyPrice: 394.2 },
  { tier: "M40", ramGB: 16, storageGB: 80, vCPUs: 4, monthlyPrice: 759.2 },
  { tier: "M50", ramGB: 32, storageGB: 160, vCPUs: 8, monthlyPrice: 1460.0 },
  { tier: "M60", ramGB: 64, storageGB: 320, vCPUs: 16, monthlyPrice: 2883.5 },
  { tier: "M80", ramGB: 128, storageGB: 750, vCPUs: 32, monthlyPrice: 5329.0 },
  { tier: "M140", ramGB: 192, storageGB: 1000, vCPUs: 48, monthlyPrice: 8022.7 },
  { tier: "M200", ramGB: 256, storageGB: 1500, vCPUs: 64, monthlyPrice: 10650.7 },
  { tier: "M300", ramGB: 384, storageGB: 2000, vCPUs: 96, monthlyPrice: 15950.5 },
  { tier: "M400", ramGB: 488, storageGB: 3000, vCPUs: 64, monthlyPrice: 16352.0 },
  { tier: "M700", ramGB: 768, storageGB: 4000, vCPUs: 96, monthlyPrice: 24279.7 },
];

/**
 * Builds a full mongodb+srv connection string from separate host/username/
 * password fields, URL-encoding credentials so special characters are safe.
 */
function buildConnectionUri({ host, username, password }) {
  const cleanHost = String(host || "")
    .trim()
    .replace(/^mongodb(\+srv)?:\/\//, "")
    .replace(/\/.*$/, "");
  const user = encodeURIComponent(String(username || "").trim());
  const pass = encodeURIComponent(String(password || "").trim());
  return `mongodb+srv://${user}:${pass}@${cleanHost}/?retryWrites=true&w=majority&appName=NotesToSizingPOV`;
}

async function connect(sessionId, host, username, password) {
  if (!host || !host.trim()) throw new Error("Cluster host is required");
  if (!username || !username.trim()) throw new Error("Username is required");
  if (!password) throw new Error("Password is required");

  const uri = buildConnectionUri({ host, username, password });
  const candidateClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 10,
    maxIdleTimeMS: 30000,
  });

  try {
    await candidateClient.connect();
    await candidateClient.db("admin").command({ ping: 1 });
  } catch (err) {
    await candidateClient.close().catch(() => {});
    throw new Error(`Failed to connect: ${err.message || "unknown error"}`);
  }

  const prevClient = clients.get(sessionId);
  if (prevClient) {
    await prevClient.close().catch(() => {});
  }

  clients.set(sessionId, candidateClient);
  await seedPricingConfig(sessionId);

  return { host: host.trim().replace(/^mongodb(\+srv)?:\/\//, "").replace(/\/.*$/, "") };
}

function getClient(sessionId) {
  return clients.get(sessionId) || null;
}

async function removeClient(sessionId) {
  const client = clients.get(sessionId);
  if (client) {
    try {
      await client.close();
    } catch (err) {
    }
    clients.delete(sessionId);
  }
}

/**
 * Closes and removes every tracked MongoClient. Used on process shutdown
 * so abandoned connection pools don't linger as open sockets after the
 * server exits.
 */
async function closeAllClients() {
  const ids = Array.from(clients.keys());
  await Promise.all(ids.map((id) => removeClient(id)));
}

/**
 * Periodically compares the sessions tracked by the express-session store
 * against the sessionIds we're holding MongoClients for, and closes any
 * MongoClient whose session has expired or been destroyed. Without this,
 * a browser tab closed without hitting "Disconnect" (or a session that
 * simply outlives its 8h cookie) leaves its MongoClient - and its whole
 * connection pool - open forever, slowly exhausting file descriptors.
 */
function startSessionSweep(sessionStore, intervalMs = 15 * 60 * 1000) {
  if (!sessionStore || typeof sessionStore.all !== "function") return null;

  const sweep = () => {
    sessionStore.all((err, sessions) => {
      if (err) return;
      const activeIds = new Set(Object.keys(sessions || {}));
      for (const sessionId of clients.keys()) {
        if (!activeIds.has(sessionId)) {
          removeClient(sessionId).catch(() => {});
        }
      }
    });
  };

  const timer = setInterval(sweep, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

function isConnected(sessionId) {
  return clients.has(sessionId);
}

function getConnectedHost(sessionId) {
  const client = clients.get(sessionId);
  if (!client) return null;
  return client.s.options.hosts[0].host;
}

async function seedPricingConfig(sessionId) {
  const platformDb = getClient(sessionId).db("platform");
  const existing = await platformDb
    .collection("pricingConfig")
    .findOne({ _id: "default" });
  if (!existing) {
    await platformDb.collection("pricingConfig").insertOne({
      _id: "default",
      tiers: DEFAULT_PRICING_TIERS,
      discountPercent: 0,
      updatedAt: new Date(),
    });
    console.log("Seeded platform.pricingConfig with default Atlas pricing.");
  }
}

function getPlatformDb(sessionId) {
  const client = getClient(sessionId);
  if (!client) {
    throw new Error("Not connected to a database. Please log in again.");
  }
  return client.db("platform");
}

function getCustomersCollection(sessionId) {
  return getPlatformDb(sessionId).collection("customers");
}

function getPricingConfigCollection(sessionId) {
  return getPlatformDb(sessionId).collection("pricingConfig");
}

function getCustomerDb(sessionId, dbSlug) {
  const client = getClient(sessionId);
  if (!client) {
    throw new Error("Not connected to a database. Please log in again.");
  }
  return client.db(dbSlug);
}

function getAppNotesCollection(sessionId, dbSlug, appSlug) {
  return getCustomerDb(sessionId, dbSlug).collection(`${appSlug}.notes`);
}

function getAppNoteChunksCollection(sessionId, dbSlug, appSlug) {
  return getCustomerDb(sessionId, dbSlug).collection(`${appSlug}.note_chunks`);
}

function getAppBucket(sessionId, dbSlug, appSlug) {
  return new GridFSBucket(getCustomerDb(sessionId, dbSlug), {
    bucketName: `${appSlug}-uploads`,
  });
}

/**
 * Create the recommended indexes for an app's notes collection. Idempotent
 * and self-healing - safe to call every time a note is created, not just
 * when the app is first created.
 */
async function ensureAppIndexes(sessionId, dbSlug, appSlug) {
  const notes = getAppNotesCollection(sessionId, dbSlug, appSlug);
  await notes.createIndex({ createdAt: -1 });

  try {
    await notes.dropIndex("externalId_1");
  } catch {
  }

  await notes.createIndex(
    { externalId: 1 },
    {
      unique: true,
      partialFilterExpression: { externalId: { $type: "string" } },
    }
  );

  const chunks = getAppNoteChunksCollection(sessionId, dbSlug, appSlug);
  await chunks.createIndex({ noteId: 1 });
}

/**
 * Ensure a MongoDB Atlas Vector Search index exists on the app's
 * note_chunks collection. Creates the index if missing, or recreates it
 * if the embedding dimensions have changed.
 */
async function ensureAppVectorIndex(sessionId, dbSlug, appSlug, dimensions) {
  const chunks = getAppNoteChunksCollection(sessionId, dbSlug, appSlug);
  const dims = dimensions || 1024;

  let existing = [];
  try {
    existing = await chunks.listSearchIndexes("vector_index").toArray();
  } catch {
  }

  if (existing.length > 0) {
    const currentDims = existing[0].latestDefinition?.fields?.find(
      (f) => f.type === "vector"
    )?.numDimensions;
    if (currentDims === dims) return;

    try {
      await chunks.dropSearchIndex("vector_index");
    } catch {
    }
  }

  await chunks.createSearchIndex({
    name: "vector_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: dims,
          similarity: "cosine",
        },
      ],
    },
  });
}

module.exports = {
  slugify,
  buildConnectionUri,
  connect,
  getClient,
  removeClient,
  closeAllClients,
  startSessionSweep,
  isConnected,
  getConnectedHost,
  getPlatformDb,
  getCustomersCollection,
  getPricingConfigCollection,
  getCustomerDb,
  getAppNotesCollection,
  getAppNoteChunksCollection,
  getAppBucket,
  ensureAppIndexes,
  ensureAppVectorIndex,
  DEFAULT_PRICING_TIERS,
};
