const { MongoClient, GridFSBucket } = require("mongodb");

let mongoClient = null;
let connectedHost = null;

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

function isConnected() {
  return mongoClient !== null;
}

function getConnectedHost() {
  return connectedHost;
}

/**
 * Attempts to connect to Atlas with the given credentials. On success,
 * seeds the pricing config and stores the client (in memory only - not
 * persisted anywhere) for the rest of the app to use. Throws with a clear
 * message on failure.
 */
async function connectWithCredentials({ host, username, password }) {
  if (!host || !host.trim()) throw new Error("Cluster host is required");
  if (!username || !username.trim()) throw new Error("Username is required");
  if (!password) throw new Error("Password is required");

  const uri = buildConnectionUri({ host, username, password });
  const candidateClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
  });

  try {
    await candidateClient.connect();
    // Confirm auth actually works, not just TCP/TLS connectivity.
    await candidateClient.db("admin").command({ ping: 1 });
  } catch (err) {
    await candidateClient.close().catch(() => {});
    throw new Error(
      `Failed to connect: ${err.message || "unknown error"}`
    );
  }

  // Tear down any previous connection before adopting the new one.
  if (mongoClient) {
    await mongoClient.close().catch(() => {});
  }

  mongoClient = candidateClient;
  connectedHost = host.trim().replace(/^mongodb(\+srv)?:\/\//, "").replace(/\/.*$/, "");

  await seedPricingConfig();

  return { host: connectedHost };
}

async function disconnect() {
  if (mongoClient) {
    await mongoClient.close().catch(() => {});
  }
  mongoClient = null;
  connectedHost = null;
}

function getClient() {
  if (!mongoClient) {
    throw new Error("Not connected to a database yet");
  }
  return mongoClient;
}

async function seedPricingConfig() {
  const platformDb = getClient().db("platform");
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

function getPlatformDb() {
  return getClient().db("platform");
}

function getCustomersCollection() {
  return getPlatformDb().collection("customers");
}

function getPricingConfigCollection() {
  return getPlatformDb().collection("pricingConfig");
}

function getCustomerDb(dbSlug) {
  return getClient().db(dbSlug);
}

function getAppNotesCollection(dbSlug, appSlug) {
  return getCustomerDb(dbSlug).collection(`${appSlug}.notes`);
}

function getAppBucket(dbSlug, appSlug) {
  return new GridFSBucket(getCustomerDb(dbSlug), {
    bucketName: `${appSlug}-uploads`,
  });
}

/**
 * Create the recommended indexes for an app's notes collection. Idempotent
 * and self-healing - safe to call every time a note is created, not just
 * when the app is first created.
 *
 * Note: externalId uses a *partial* index (only indexing documents where
 * externalId is an actual string), not a sparse index. A plain sparse index
 * would still index documents where externalId is explicitly set to null
 * (every manual note has externalId: null by design), causing a duplicate
 * key error as soon as a second note was created. If an older, broken
 * sparse index exists from a previous version of this app, it's dropped
 * and replaced automatically.
 */
async function ensureAppIndexes(dbSlug, appSlug) {
  const notes = getAppNotesCollection(dbSlug, appSlug);
  await notes.createIndex({ createdAt: -1 });

  try {
    await notes.dropIndex("externalId_1");
  } catch {
    // Index didn't exist - nothing to clean up.
  }

  await notes.createIndex(
    { externalId: 1 },
    {
      unique: true,
      partialFilterExpression: { externalId: { $type: "string" } },
    }
  );
}

module.exports = {
  slugify,
  buildConnectionUri,
  isConnected,
  getConnectedHost,
  connectWithCredentials,
  disconnect,
  getPlatformDb,
  getCustomersCollection,
  getPricingConfigCollection,
  getCustomerDb,
  getAppNotesCollection,
  getAppBucket,
  ensureAppIndexes,
  DEFAULT_PRICING_TIERS,
};
