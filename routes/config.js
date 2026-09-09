const express = require("express");
const { getPricingConfigCollection } = require("../db");

const router = express.Router();

// GET /api/config/pricing
router.get("/pricing", async (req, res) => {
  try {
    const config = await getPricingConfigCollection().findOne({
      _id: "default",
    });
    if (!config) {
      return res.status(404).json({ error: "Pricing config not found" });
    }
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load pricing config" });
  }
});

// PUT /api/config/pricing - replace tiers and/or discountPercent
router.put("/pricing", async (req, res) => {
  try {
    const { tiers, discountPercent } = req.body;

    const update = { updatedAt: new Date() };

    if (tiers !== undefined) {
      if (!Array.isArray(tiers)) {
        return res.status(400).json({ error: "tiers must be an array" });
      }
      for (const t of tiers) {
        if (!t.tier || typeof t.monthlyPrice !== "number") {
          return res.status(400).json({
            error:
              "Each tier must have a 'tier' name and numeric 'monthlyPrice'",
          });
        }
      }
      update.tiers = tiers;
    }

    if (discountPercent !== undefined) {
      if (
        typeof discountPercent !== "number" ||
        discountPercent < 0 ||
        discountPercent > 100
      ) {
        return res
          .status(400)
          .json({ error: "discountPercent must be a number between 0 and 100" });
      }
      update.discountPercent = discountPercent;
    }

    const result = await getPricingConfigCollection().findOneAndUpdate(
      { _id: "default" },
      { $set: update },
      { returnDocument: "after", upsert: true }
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update pricing config" });
  }
});

module.exports = router;
