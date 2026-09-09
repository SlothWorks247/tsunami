const { getCustomersCollection, getPricingConfigCollection } = require("../db");

const DEFAULT_GROWTH_MULTIPLIER = 3;
const DEFAULT_INDEX_OVERHEAD_PERCENT = 15;

const SIZING_DISCOVERY_QUESTIONS = [
  "How many documents/records do they expect to store?",
  "What is the average size of each document (in KB)?",
  "What is their expected data growth over the next 12 months?",
];

function buildInsufficientInfoReport(customer, app) {
  const lines = [];
  lines.push(`MORE INFORMATION NEEDED`);
  lines.push(`Customer: ${customer.name}`);
  lines.push(`App: ${app.name}`);
  lines.push("");
  lines.push(
    `To calculate a sizing recommendation, ask the customer:`
  );
  for (const q of SIZING_DISCOVERY_QUESTIONS) {
    lines.push(`- ${q}`);
  }

  return {
    text: lines.join("\n"),
    data: {
      customer: customer.name,
      app: app.name,
      needsMoreInfo: true,
      questions: SIZING_DISCOVERY_QUESTIONS,
    },
  };
}

/**
 * Computes a heuristic Atlas cluster tier recommendation for a given
 * customer + app based on manually provided estimates (data size, growth
 * multiplier, index overhead), since reading the actual sizing
 * requirements out of the customer's notes via AI is not yet implemented.
 * If the required dataSizeGB input is missing/invalid, returns a list of
 * discovery questions to ask the customer instead of a calculation.
 */
async function generateSizingReport(
  customerSlug,
  appSlug,
  { dataSizeGB, growthMultiplier, indexOverheadPercent } = {}
) {
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

  const parsedDataSizeGB = Number(dataSizeGB);
  if (!dataSizeGB || !Number.isFinite(parsedDataSizeGB) || parsedDataSizeGB <= 0) {
    return buildInsufficientInfoReport(customer, app);
  }

  const parsedGrowthMultiplier =
    growthMultiplier != null && Number.isFinite(Number(growthMultiplier)) && Number(growthMultiplier) > 0
      ? Number(growthMultiplier)
      : DEFAULT_GROWTH_MULTIPLIER;

  const parsedIndexOverheadPercent =
    indexOverheadPercent != null &&
    Number.isFinite(Number(indexOverheadPercent)) &&
    Number(indexOverheadPercent) >= 0
      ? Number(indexOverheadPercent)
      : DEFAULT_INDEX_OVERHEAD_PERCENT;

  const pricingConfig = await getPricingConfigCollection().findOne({
    _id: "default",
  });
  if (!pricingConfig) {
    throw new Error("Pricing config not found - has the server seeded it yet?");
  }

  const dataMB = parsedDataSizeGB * 1024;
  const indexMB = dataMB * (parsedIndexOverheadPercent / 100);
  const workingSetMB = dataMB + indexMB;
  const projectedMB = workingSetMB * parsedGrowthMultiplier;

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

  const lines = [];
  lines.push(`SIZING RECOMMENDATION`);
  lines.push(`Customer: ${customer.name}`);
  lines.push(`App: ${app.name}`);
  lines.push("");
  lines.push(
    `Based on: ${parsedDataSizeGB} GB estimated data, ${parsedGrowthMultiplier}x growth, ${parsedIndexOverheadPercent}% index overhead`
  );
  lines.push("");
  lines.push(`Estimated Working Set`);
  lines.push(`- Data size: ${dataMB.toFixed(2)} MB`);
  lines.push(`- Estimated index size: ${indexMB.toFixed(2)} MB`);
  lines.push(`- Working set (data + indexes): ${workingSetMB.toFixed(2)} MB`);
  lines.push("");
  lines.push(
    `Projected Working Set (with ${parsedGrowthMultiplier}x growth headroom): ${projectedMB.toFixed(
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
    `Methodology: this is a heuristic estimate based on manually provided estimates (not yet AI-derived from your notes), with the growth/index-overhead assumptions above applied. It does not reflect live query load, connections, or throughput - use Atlas's Performance Advisor / Real-Time Metrics once a cluster is live for further tuning.`
  );

  const text = lines.join("\n");

  return {
    text,
    data: {
      customer: customer.name,
      app: app.name,
      dataSizeGB: parsedDataSizeGB,
      growthMultiplier: parsedGrowthMultiplier,
      indexOverheadPercent: parsedIndexOverheadPercent,
      dataMB,
      indexMB,
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
