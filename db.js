const { MongoClient, GridFSBucket } = require("mongodb");

const uri = process.env.ATLAS_URI;

if (!uri) {
  throw new Error(
    "ATLAS_URI is not set. Copy .env.example to .env and fill in your Atlas connection string."
  );
}

const client = new MongoClient(uri);

let connected = false;

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
 * Connect the shared MongoClient and make sure the platform database has a
 * seeded pricingConfig document. Safe to call multiple times.
 */
async function connect() {
  if (connected) return client;
  await client.connect();
  connected = true;
  await seedPricingConfig();
  return client;
}

async function seedPricingConfig() {
  const platformDb = client.db("platform");
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
  return client.db("platform");
}

function getCustomersCollection() {
  return getPlatformDb().collection("customers");
}

function getPricingConfigCollection() {
  return getPlatformDb().collection("pricingConfig");
}

function getCustomerDb(dbSlug) {
  return client.db(dbSlug);
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
 * Create the recommended indexes for a newly created app's notes collection.
 * Idempotent - safe to call more than once.
 */
async function ensureAppIndexes(dbSlug, appSlug) {
  const notes = getAppNotesCollection(dbSlug, appSlug);
  await notes.createIndex({ createdAt: -1 });
  await notes.createIndex(
    { externalId: 1 },
    { unique: true, sparse: true }
  );
}

module.exports = {
  client,
  connect,
  slugify,
  getPlatformDb,
  getCustomersCollection,
  getPricingConfigCollection,
  getCustomerDb,
  getAppNotesCollection,
  getAppBucket,
  ensureAppIndexes,
  DEFAULT_PRICING_TIERS,
};
