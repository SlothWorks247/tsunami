const express = require("express");
const {
  getCustomersCollection,
  slugify,
  ensureAppIndexes,
} = require("../db");

const router = express.Router();

// GET /api/customers - list all customers
router.get("/", async (req, res) => {
  try {
    const customers = await getCustomersCollection()
      .find({})
      .sort({ name: 1 })
      .toArray();
    res.json(customers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

// POST /api/customers - create a new customer { name }
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Customer name is required" });
    }

    const dbSlug = slugify(name);
    const customers = getCustomersCollection();

    const existing = await customers.findOne({ dbSlug });
    if (existing) {
      return res
        .status(409)
        .json({ error: `A customer named "${name}" already exists.` });
    }

    const doc = {
      name: name.trim(),
      dbSlug,
      discountPercent: null,
      apps: [],
      createdAt: new Date(),
    };
    const result = await customers.insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to create customer" });
  }
});

// PATCH /api/customers/:customerSlug - update discount override
router.patch("/:customerSlug", async (req, res) => {
  try {
    const { customerSlug } = req.params;
    const { discountPercent } = req.body;

    if (
      discountPercent !== null &&
      (typeof discountPercent !== "number" ||
        discountPercent < 0 ||
        discountPercent > 100)
    ) {
      return res
        .status(400)
        .json({ error: "discountPercent must be a number between 0 and 100, or null" });
    }

    const customers = getCustomersCollection();
    const result = await customers.findOneAndUpdate(
      { dbSlug: customerSlug },
      { $set: { discountPercent } },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// GET /api/customers/:customerSlug/apps - list a customer's apps
router.get("/:customerSlug/apps", async (req, res) => {
  try {
    const { customerSlug } = req.params;
    const customer = await getCustomersCollection().findOne({
      dbSlug: customerSlug,
    });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(customer.apps || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list apps" });
  }
});

// POST /api/customers/:customerSlug/apps - create an app { name }
router.post("/:customerSlug/apps", async (req, res) => {
  try {
    const { customerSlug } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "App name is required" });
    }

    const appSlug = slugify(name);
    const customers = getCustomersCollection();
    const customer = await customers.findOne({ dbSlug: customerSlug });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const alreadyExists = (customer.apps || []).some(
      (a) => a.appSlug === appSlug
    );
    if (alreadyExists) {
      return res
        .status(409)
        .json({ error: `An app named "${name}" already exists for this customer.` });
    }

    const newApp = { name: name.trim(), appSlug, createdAt: new Date() };
    await customers.updateOne(
      { dbSlug: customerSlug },
      { $push: { apps: newApp } }
    );

    await ensureAppIndexes(customerSlug, appSlug);

    res.status(201).json(newApp);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to create app" });
  }
});

module.exports = router;
