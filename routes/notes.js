const express = require("express");
const multer = require("multer");
const { ObjectId } = require("mongodb");
const {
  getAppNotesCollection,
  getAppNoteChunksCollection,
  getAppBucket,
  getCustomersCollection,
  ensureAppIndexes,
  ensureAppVectorIndex,
} = require("../db");
const { generateSizingReport } = require("../services/sizingAnalyzer");
const { generateSchemaReport } = require("../services/schemaLinter");
const { extractText } = require("../services/fileParser");
const { chunkText } = require("../services/chunker");
const {
  generateEmbeddings,
  getEmbeddingDimensions,
} = require("../services/embeddings");
const { logStep } = require("../services/logger");

const router = express.Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Confirms the customer + app combination exists in the registry before
 * we touch/create anything in their database. Returns the app object if
 * found, or null.
 */
async function findApp(sessionId, customerSlug, appSlug) {
  const customer = await getCustomersCollection(sessionId).findOne({
    dbSlug: customerSlug,
  });
  if (!customer) return null;
  const app = (customer.apps || []).find((a) => a.appSlug === appSlug);
  return app || null;
}

function getNoteContent(note) {
  if (!note) return "";
  return note.type === "text" ? note.body : note.textContent;
}

async function generateAndStoreChunks(
  sessionId,
  customerSlug,
  appSlug,
  noteId,
  title,
  content,
  voyageConfig
) {
  if (!content || !content.trim()) return 0;
  if (!voyageConfig || !voyageConfig.apiKey) return 0;

  const model = voyageConfig.model || "voyage-4-lite";
  const chunks = chunkText(content, title);
  if (chunks.length === 0) return 0;

  logStep(
    sessionId,
    `Note "${title}": chunking text into ${chunks.length} passage${chunks.length > 1 ? "s" : ""} (~2000 chars each)`,
    "info"
  );

  logStep(
    sessionId,
    `Note "${title}": generating embeddings for ${chunks.length} chunk${chunks.length > 1 ? "s" : ""} via ${model} (input_type: document)...`,
    "info"
  );
  const { embeddings } = await generateEmbeddings(
    chunks.map((c) => c.text),
    voyageConfig.apiKey,
    model,
    "document"
  );

  if (!embeddings || embeddings.length === 0) {
    logStep(
      sessionId,
      `Note "${title}": embedding API returned no vectors`,
      "error"
    );
    return 0;
  }

  if (embeddings.length !== chunks.length) {
    logStep(
      sessionId,
      `Note "${title}": embedding API returned ${embeddings.length} vectors for ${chunks.length} chunks — storing only matched pairs`,
      "error"
    );
  }

  const usableCount = Math.min(embeddings.length, chunks.length);
  if (usableCount === 0) return 0;

  logStep(
    sessionId,
    `Note "${title}": received ${embeddings.length} embeddings (${embeddings[0].length} dims each)`,
    "success"
  );

  const docs = [];
  for (let i = 0; i < usableCount; i++) {
    docs.push({
      noteId,
      chunkIndex: chunks[i].chunkIndex,
      text: chunks[i].text,
      embedding: embeddings[i],
      embeddingModel: model,
      createdAt: new Date(),
    });
  }

  await getAppNoteChunksCollection(sessionId, customerSlug, appSlug).insertMany(
    docs
  );
  logStep(
    sessionId,
    `Note "${title}": ${docs.length} chunk${docs.length > 1 ? "s" : ""} stored in note_chunks collection`,
    "success"
  );

  const dims = getEmbeddingDimensions(model);
  logStep(
    sessionId,
    `Ensuring Atlas Vector Search index (${dims} dims, cosine)...`,
    "info"
  );
  await ensureAppVectorIndex(sessionId, customerSlug, appSlug, dims);

  return docs.length;
}

async function deleteChunksForNote(sessionId, customerSlug, appSlug, noteId) {
  try {
    await getAppNoteChunksCollection(
      sessionId,
      customerSlug,
      appSlug
    ).deleteMany({ noteId });
  } catch {
  }
}

function getVoyageConfig(req) {
  if (!req.session || !req.session.voyageApiKey) return null;
  return {
    apiKey: req.session.voyageApiKey,
    model: req.session.voyageModel || "voyage-4-lite",
  };
}

// GET /api/customers/:customerSlug/apps/:appSlug/notes
router.get("/notes", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    const notes = await getAppNotesCollection(
      req.sessionID,
      customerSlug,
      appSlug
    )
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

    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ error: "Note body is required" });
    }

    await ensureAppIndexes(req.sessionID, customerSlug, appSlug);

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
      req.sessionID,
      customerSlug,
      appSlug
    ).insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });

    const voyageConfig = getVoyageConfig(req);
    if (voyageConfig) {
      try {
        await generateAndStoreChunks(
          req.sessionID,
          customerSlug,
          appSlug,
          result.insertedId,
          doc.title,
          body,
          voyageConfig
        );
      } catch (err) {
        console.warn(
          "Embedding failed for note",
          result.insertedId,
          ":",
          err.message
        );
      }
    }
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

    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ error: "No file uploaded (field name must be 'file')" });
    }

    await ensureAppIndexes(req.sessionID, customerSlug, appSlug);

    logStep(
      req.sessionID,
      `Extracting text from file "${req.file.originalname}" (${req.file.mimetype})...`,
      "info"
    );
    const textContent = await extractText(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );
    logStep(
      req.sessionID,
      `Text extracted: ${textContent ? textContent.length : 0} characters`,
      textContent ? "success" : "error"
    );

    const bucket = getAppBucket(req.sessionID, customerSlug, appSlug);
    const uploadStream = bucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on("error", (err) => {
      console.error(err);
      res.status(500).json({ error: "Failed to store file" });
    });

    uploadStream.on("finish", async () => {
      try {
        const now = new Date();
        const doc = {
          title: (title && title.trim()) || req.file.originalname,
          type: "file",
          textContent,
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
          req.sessionID,
          customerSlug,
          appSlug
        ).insertOne(doc);
        res.status(201).json({ ...doc, _id: result.insertedId });

        const voyageConfig = getVoyageConfig(req);
        if (voyageConfig) {
          try {
            await generateAndStoreChunks(
              req.sessionID,
              customerSlug,
              appSlug,
              result.insertedId,
              doc.title,
              textContent,
              voyageConfig
            );
          } catch (err) {
            console.warn(
              "Embedding failed for file note",
              result.insertedId,
              ":",
              err.message
            );
          }
        }
      } catch (err) {
        console.error(err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to store file note" });
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// PUT /api/customers/:customerSlug/apps/:appSlug/notes/:noteId - edit a text
// note's title/body, or rename a file note's title (JSON only - use the
// /upload variant below to replace a file note's underlying file).
router.put("/notes/:noteId", async (req, res) => {
  try {
    const { customerSlug, appSlug, noteId } = req.params;
    const { title, body } = req.body;

    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    let objectId;
    try {
      objectId = new ObjectId(noteId);
    } catch {
      return res.status(400).json({ error: "Invalid note id" });
    }

    const notes = getAppNotesCollection(req.sessionID, customerSlug, appSlug);
    const existing = await notes.findOne({ _id: objectId });
    if (!existing) {
      return res.status(404).json({ error: "Note not found" });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const update = { title: title.trim(), updatedAt: new Date() };

    if (existing.type === "text") {
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Note body is required" });
      }
      update.body = body;
    }

    await notes.updateOne({ _id: objectId }, { $set: update });
    const updated = await notes.findOne({ _id: objectId });
    res.json(updated);

    if (existing.type === "text") {
      await deleteChunksForNote(
        req.sessionID,
        customerSlug,
        appSlug,
        objectId
      );
      const voyageConfig = getVoyageConfig(req);
      if (voyageConfig) {
        try {
          await generateAndStoreChunks(
            req.sessionID,
            customerSlug,
            appSlug,
            objectId,
            update.title,
            update.body,
            voyageConfig
          );
        } catch (err) {
          console.warn(
            "Embedding failed for note",
            objectId,
            ":",
            err.message
          );
        }
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update note" });
  }
});

// PUT /api/customers/:customerSlug/apps/:appSlug/notes/:noteId/upload -
// replace a file note's underlying file (multipart, field `file`, optional
// `title`). Old GridFS file is deleted after the new one is stored.
router.put(
  "/notes/:noteId/upload",
  upload.single("file"),
  async (req, res) => {
    try {
      const { customerSlug, appSlug, noteId } = req.params;
      const { title } = req.body;

      const app = await findApp(req.sessionID, customerSlug, appSlug);
      if (!app) {
        return res.status(404).json({ error: "Customer or app not found" });
      }

      let objectId;
      try {
        objectId = new ObjectId(noteId);
      } catch {
        return res.status(400).json({ error: "Invalid note id" });
      }

      const notes = getAppNotesCollection(
        req.sessionID,
        customerSlug,
        appSlug
      );
      const existing = await notes.findOne({ _id: objectId });
      if (!existing) {
        return res.status(404).json({ error: "Note not found" });
      }
      if (existing.type !== "file") {
        return res
          .status(400)
          .json({ error: "Only file notes can have their file replaced" });
      }
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "No file uploaded (field name must be 'file')" });
      }

      logStep(
        req.sessionID,
        `Extracting text from replacement file "${req.file.originalname}" (${req.file.mimetype})...`,
        "info"
      );
      const textContent = await extractText(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      logStep(
        req.sessionID,
        `Text extracted: ${textContent ? textContent.length : 0} characters`,
        textContent ? "success" : "error"
      );

      const bucket = getAppBucket(req.sessionID, customerSlug, appSlug);
      const uploadStream = bucket.openUploadStream(req.file.originalname, {
        contentType: req.file.mimetype,
      });

      uploadStream.end(req.file.buffer);

      uploadStream.on("error", (err) => {
        console.error(err);
        res.status(500).json({ error: "Failed to store replacement file" });
      });

      uploadStream.on("finish", async () => {
        try {
          const oldFileId = existing.fileId;

          const update = {
            title: (title && title.trim()) || req.file.originalname,
            textContent,
            fileId: uploadStream.id,
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            size: req.file.size,
            updatedAt: new Date(),
          };

          await notes.updateOne({ _id: objectId }, { $set: update });

          try {
            await bucket.delete(new ObjectId(oldFileId));
          } catch (err) {
            console.warn(
              `Could not delete old GridFS file ${oldFileId}:`,
              err.message
            );
          }

          const updated = await notes.findOne({ _id: objectId });
          res.json(updated);

          await deleteChunksForNote(
            req.sessionID,
            customerSlug,
            appSlug,
            objectId
          );
          const voyageConfig = getVoyageConfig(req);
          if (voyageConfig) {
            try {
              await generateAndStoreChunks(
                req.sessionID,
                customerSlug,
                appSlug,
                objectId,
                update.title,
                textContent,
                voyageConfig
              );
            } catch (err) {
              console.warn(
                "Embedding failed for file note",
                objectId,
                ":",
                err.message
              );
            }
          }
        } catch (err) {
          console.error(err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to replace file note" });
          }
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to replace file" });
    }
  }
);

// DELETE /api/customers/:customerSlug/apps/:appSlug/notes/:noteId
router.delete("/notes/:noteId", async (req, res) => {
  try {
    const { customerSlug, appSlug, noteId } = req.params;

    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    let objectId;
    try {
      objectId = new ObjectId(noteId);
    } catch {
      return res.status(400).json({ error: "Invalid note id" });
    }

    const notes = getAppNotesCollection(req.sessionID, customerSlug, appSlug);
    const existing = await notes.findOne({ _id: objectId });
    if (!existing) {
      return res.status(404).json({ error: "Note not found" });
    }

    if (existing.type === "file" && existing.fileId) {
      const bucket = getAppBucket(req.sessionID, customerSlug, appSlug);
      try {
        await bucket.delete(new ObjectId(existing.fileId));
      } catch (err) {
        console.warn(
          `Could not delete GridFS file ${existing.fileId} for note ${noteId}:`,
          err.message
        );
      }
    }

    await deleteChunksForNote(req.sessionID, customerSlug, appSlug, objectId);
    await notes.deleteOne({ _id: objectId });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// GET /api/customers/:customerSlug/apps/:appSlug/files/:fileId - stream file back
router.get("/files/:fileId", async (req, res) => {
  try {
    const { customerSlug, appSlug, fileId } = req.params;
    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    let objectId;
    try {
      objectId = new ObjectId(fileId);
    } catch {
      return res.status(400).json({ error: "Invalid file id" });
    }

    const bucket = getAppBucket(req.sessionID, customerSlug, appSlug);
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

// POST /api/customers/:customerSlug/apps/:appSlug/notes/backfill-embeddings
router.post("/notes/backfill-embeddings", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const voyageConfig = getVoyageConfig(req);

    if (!voyageConfig) {
      return res.status(400).json({
        error:
          "Embedding API key is not configured. Open Settings to add one.",
      });
    }

    const app = await findApp(req.sessionID, customerSlug, appSlug);
    if (!app) {
      return res.status(404).json({ error: "Customer or app not found" });
    }

    const notes = await getAppNotesCollection(
      req.sessionID,
      customerSlug,
      appSlug
    )
      .find({
        $or: [
          { type: "text" },
          { textContent: { $exists: true, $ne: "" } },
        ],
      })
      .toArray();

    logStep(
      req.sessionID,
      `Backfill starting for ${notes.length} note${notes.length !== 1 ? "s" : ""} (model: ${voyageConfig.model || "voyage-4-lite"})...`,
      "info"
    );

    const chunksCol = getAppNoteChunksCollection(
      req.sessionID,
      customerSlug,
      appSlug
    );
    let embedded = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (let idx = 0; idx < notes.length; idx++) {
      const note = notes[idx];
      const existingChunks = await chunksCol.countDocuments({
        noteId: note._id,
      });
      if (existingChunks > 0) {
        logStep(
          req.sessionID,
          `Note ${idx + 1}/${notes.length}: "${note.title}" — already has ${existingChunks} chunks, skipping`,
          "info"
        );
        skipped++;
        continue;
      }

      const content = getNoteContent(note);
      if (!content || !content.trim()) {
        logStep(
          req.sessionID,
          `Note ${idx + 1}/${notes.length}: "${note.title}" — no text content, skipping`,
          "info"
        );
        skipped++;
        continue;
      }

      logStep(
        req.sessionID,
        `Note ${idx + 1}/${notes.length}: "${note.title}" — chunking + embedding...`,
        "info"
      );
      try {
        const count = await generateAndStoreChunks(
          req.sessionID,
          customerSlug,
          appSlug,
          note._id,
          note.title,
          content,
          voyageConfig
        );
        embedded++;
        logStep(
          req.sessionID,
          `Note ${idx + 1}/${notes.length}: "${note.title}" — ${count} chunks embedded`,
          "success"
        );
      } catch (err) {
        failed++;
        errors.push({ noteId: note._id, title: note.title, error: err.message });
        logStep(
          req.sessionID,
          `Note ${idx + 1}/${notes.length}: "${note.title}" — failed: ${err.message}`,
          "error"
        );
        console.warn(`Backfill failed for note "${note.title}":`, err.message);
      }
    }

    logStep(
      req.sessionID,
      `Backfill complete: ${embedded} embedded, ${skipped} skipped, ${failed} failed (of ${notes.length} notes)`,
      embedded > 0 ? "success" : "info"
    );

    res.json({
      total: notes.length,
      embedded,
      skipped,
      failed,
      errors,
      firstError: errors.length > 0 ? errors[0].error : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to backfill embeddings." });
  }
});

// POST /api/customers/:customerSlug/apps/:appSlug/analysis/sizing
// body: { dataSizeGB, growthMultiplier, indexOverheadPercent }
router.post("/analysis/sizing", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const { dataSizeGB, growthMultiplier, indexOverheadPercent } = req.body;
    const report = await generateSizingReport(
      req.sessionID,
      customerSlug,
      appSlug,
      {
        dataSizeGB,
        growthMultiplier,
        indexOverheadPercent,
      }
    );
    res.json(report);
  } catch (err) {
    console.error(err);
    res
      .status(400)
      .json({ error: err.message || "Failed to generate sizing report" });
  }
});

// GET /api/customers/:customerSlug/apps/:appSlug/analysis/schema
router.get("/analysis/schema", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const report = await generateSchemaReport(
      req.sessionID,
      customerSlug,
      appSlug
    );
    res.json(report);
  } catch (err) {
    console.error(err);
    res
      .status(400)
      .json({ error: err.message || "Failed to generate schema report" });
  }
});

module.exports = router;
