const express = require("express");
const multer = require("multer");
const { ObjectId } = require("mongodb");
const {
  getAppNotesCollection,
  getAppBucket,
  getCustomersCollection,
} = require("../db");
const { generateSizingReport } = require("../services/sizingAnalyzer");
const { generateSchemaReport } = require("../services/schemaLinter");

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Confirms the customer + app combination exists in the registry before
 * we touch/create anything in their database. Returns the app object if
 * found, or null.
 */
async function findApp(customerSlug, appSlug) {
  const customer = await getCustomersCollection().findOne({
    dbSlug: customerSlug,
  });
  if (!customer) return null;
  const app = (customer.apps || []).find((a) => a.appSlug === appSlug);
  return app || null;
}

// GET /api/customers/:customerSlug/apps/:appSlug/notes
router.get("/notes", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const app = await findApp(customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    const notes = await getAppNotesCollection(customerSlug, appSlug)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.json(notes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list notes" });
  }
});

// POST /api/customers/:customerSlug/apps/:appSlug/notes - create a text note
router.post("/notes", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const { title, body } = req.body;

    const app = await findApp(customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ error: "Note body is required" });
    }

    const now = new Date();
    const doc = {
      title: title.trim(),
      type: "text",
      body,
      source: "manual",
      externalId: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await getAppNotesCollection(
      customerSlug,
      appSlug
    ).insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create note" });
  }
});

// POST /api/customers/:customerSlug/apps/:appSlug/notes/upload - file/image note
router.post("/notes/upload", upload.single("file"), async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const { title } = req.body;

    const app = await findApp(customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });
    }

    const bucket = getAppBucket(customerSlug, appSlug);
    const uploadStream = bucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on("error", (err) => {
      console.error(err);
      res.status(500).json({ error: "Failed to store file" });
    });

    uploadStream.on("finish", async () => {
      const now = new Date();
      const doc = {
        title: (title && title.trim()) || req.file.originalname,
        type: "file",
        fileId: uploadStream.id,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size,
        source: "manual",
        externalId: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await getAppNotesCollection(
        customerSlug,
        appSlug
      ).insertOne(doc);
      res.status(201).json({ ...doc, _id: result.insertedId });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// GET /api/customers/:customerSlug/apps/:appSlug/files/:fileId - stream file back
router.get("/files/:fileId", async (req, res) => {
  try {
    const { customerSlug, appSlug, fileId } = req.params;
    const app = await findApp(customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    let objectId;
    try {
      objectId = new ObjectId(fileId);
    } catch {
      return res.status(400).json({ error: "Invalid file id" });
    }

    const bucket = getAppBucket(customerSlug, appSlug);
    const files = await bucket.find({ _id: objectId }).toArray();
    if (!files.length) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = files[0];
    res.set("Content-Type", file.contentType || "application/octet-stream");
    res.set(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(file.filename)}"`
    );

    const downloadStream = bucket.openDownloadStream(objectId);
    downloadStream.on("error", () => {
      res.status(500).end();
    });
    downloadStream.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch file" });
  }
});

// GET /api/customers/:customerSlug/apps/:appSlug/analysis/sizing
router.get("/analysis/sizing", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const report = await generateSizingReport(customerSlug, appSlug);
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to generate sizing report" });
  }
});

// GET /api/customers/:customerSlug/apps/:appSlug/analysis/schema
router.get("/analysis/schema", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const report = await generateSchemaReport(customerSlug, appSlug);
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to generate schema report" });
  }
});

module.exports = router;
