const {
  getCustomerDb,
  getCustomersCollection,
  getPricingConfigCollection,
} = require("../db");

const BYTES_PER_MB = 1024 * 1024;
const GROWTH_MULTIPLIER = 3; // headroom buffer applied to current working set

async function getCollStats(db, collectionName) {
  try {
    return await db.command({ collStats: collectionName });
  } catch (err) {
    // Collection may not exist yet (e.g. no files uploaded) - treat as empty.
    return { size: 0, storageSize: 0, totalIndexSize: 0, count: 0 };
  }
}

/**
 * Computes a heuristic Atlas cluster tier recommendation for a given
 * customer + app based on the actual data currently stored for that app
 * (notes collection + its GridFS upload bucket collections).
 */
async function generateSizingReport(customerSlug, appSlug) {
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

  const pricingConfig = await getPricingConfigCollection().findOne({
    _id: "default",
  });
  if (!pricingConfig) {
    throw new Error("Pricing config not found - has the server seeded it yet?");
  }

  const db = getCustomerDb(customerSlug);

  const notesStats = await getCollStats(db, `${appSlug}.notes`);
  const filesStats = await getCollStats(db, `${appSlug}-uploads.files`);
  const chunksStats = await getCollStats(db, `${appSlug}-uploads.chunks`);

  const totalDataBytes =
    (notesStats.size || 0) + (filesStats.size || 0) + (chunksStats.size || 0);
  const totalIndexBytes =
    (notesStats.totalIndexSize || 0) +
    (filesStats.totalIndexSize || 0) +
    (chunksStats.totalIndexSize || 0);
  const totalStorageBytes =
    (notesStats.storageSize || 0) +
    (filesStats.storageSize || 0) +
    (chunksStats.storageSize || 0);

  const dataMB = totalDataBytes / BYTES_PER_MB;
  const indexMB = totalIndexBytes / BYTES_PER_MB;
  const storageMB = totalStorageBytes / BYTES_PER_MB;
  const workingSetMB = dataMB + indexMB;
  const projectedMB = workingSetMB * GROWTH_MULTIPLIER;

  const sortedTiers = [...pricingConfig.tiers].sort(
    (a, b) => a.storageGB - b.storageGB
  );

  let recommendedTier = null;
  for (const tier of sortedTiers) {
    const tierStorageMB = tier.storageGB * 1024;
    const ramOk = tier.ramGB == null || tier.ramGB * 1024 >= workingSetMB;
    if (tierStorageMB >= projectedMB && ramOk) {
      recommendedTier = tier;
      break;
    }
  }

  let exceedsLargestTier = false;
  if (!recommendedTier) {
    recommendedTier = sortedTiers[sortedTiers.length - 1];
    exceedsLargestTier = true;
  }

  const effectiveDiscount =
    customer.discountPercent != null
      ? customer.discountPercent
      : pricingConfig.discountPercent || 0;

  const listPrice = recommendedTier.monthlyPrice;
  const discountedPrice = listPrice * (1 - effectiveDiscount / 100);

  const noteCount = notesStats.count || 0;
  const fileCount = filesStats.count || 0;

  const lines = [];
  lines.push(`SIZING RECOMMENDATION`);
  lines.push(`Customer: ${customer.name}`);
  lines.push(`App: ${app.name}`);
  lines.push("");
  lines.push(`Current Data Footprint`);
  lines.push(`- Notes stored: ${noteCount}`);
  lines.push(`- Files stored: ${fileCount}`);
  lines.push(`- Data size: ${dataMB.toFixed(2)} MB`);
  lines.push(`- Index size: ${indexMB.toFixed(2)} MB`);
  lines.push(`- Storage size (on disk): ${storageMB.toFixed(2)} MB`);
  lines.push(`- Working set (data + indexes): ${workingSetMB.toFixed(2)} MB`);
  lines.push("");
  lines.push(
    `Projected Working Set (with ${GROWTH_MULTIPLIER}x growth headroom): ${projectedMB.toFixed(
      2
    )} MB`
  );
  lines.push("");
  lines.push(`Recommended Tier: ${recommendedTier.tier}`);
  if (exceedsLargestTier) {
    lines.push(
      `  NOTE: projected working set exceeds the largest configured tier (${recommendedTier.tier}). Consider a sharded cluster.`
    );
  }
  lines.push(
    `- RAM: ${recommendedTier.ramGB != null ? recommendedTier.ramGB + " GB" : "Shared"}`
  );
  lines.push(`- Default Storage: ${recommendedTier.storageGB} GB`);
  lines.push(
    `- vCPUs: ${recommendedTier.vCPUs != null ? recommendedTier.vCPUs : "Shared"}`
  );
  lines.push(`- List Price: $${listPrice.toFixed(2)}/month`);
  if (effectiveDiscount > 0) {
    lines.push(
      `- Discount Applied: ${effectiveDiscount}% -> $${discountedPrice.toFixed(
        2
      )}/month`
    );
  }
  lines.push("");
  lines.push(
    `Methodology: this is a heuristic estimate based only on data currently stored for this app (via collStats), with a ${GROWTH_MULTIPLIER}x buffer applied for growth. It does not reflect live query load, connections, or throughput - use Atlas's Performance Advisor / Real-Time Metrics once a cluster is live for further tuning.`
  );

  const text = lines.join("\n");

  return {
    text,
    data: {
      customer: customer.name,
      app: app.name,
      noteCount,
      fileCount,
      dataMB,
      indexMB,
      storageMB,
      workingSetMB,
      projectedMB,
      recommendedTier: recommendedTier.tier,
      listPrice,
      effectiveDiscount,
      discountedPrice,
      exceedsLargestTier,
    },
  };
}

module.exports = { generateSizingReport };
