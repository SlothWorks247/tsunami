const express = require("express");
const { connect, removeClient, getClient } = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  const {
    host,
    username,
    password,
    llmProvider,
    llmEndpoint,
    llmModel,
    llmApiKey,
    voyageApiKey,
  } = req.body || {};

  if (!host || !username || !password) {
    return res
      .status(400)
      .json({ error: "Cluster host, username, and password are required." });
  }

  if (!llmProvider || !llmEndpoint || !llmModel) {
    return res.status(400).json({
      error: "AI provider, endpoint, and model are required.",
    });
  }
  if (llmProvider === "openai" && (!llmApiKey || !llmApiKey.trim())) {
    return res.status(400).json({
      error: "An API key is required for an OpenAI-compatible endpoint.",
    });
  }

  try {
    const result = await connect(req.sessionID, host, username, password);
    req.session.isAuthenticated = true;
    req.session.host = result.host;

    req.session.llmProvider = llmProvider;
    req.session.llmEndpoint = llmEndpoint.trim();
    req.session.llmModel = llmModel.trim();
    if (llmApiKey && llmApiKey.trim()) {
      req.session.llmApiKey = llmApiKey.trim();
    } else {
      delete req.session.llmApiKey;
    }

    if (voyageApiKey && voyageApiKey.trim()) {
      req.session.voyageApiKey = voyageApiKey.trim();
    }

    return res.json({ ok: true, host: result.host });
  } catch (err) {
    return res.status(401).json({ error: err.message || "Unable to connect to MongoDB Atlas." });
  }
});

router.post("/logout", async (req, res) => {
  await removeClient(req.sessionID);
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed." });
    }
    res.clearCookie("tsunami.sid");
    return res.json({ ok: true });
  });
});

router.get("/session", (req, res) => {
  if (req.session && req.session.isAuthenticated) {
    const client = getClient(req.sessionID);
    if (!client) {
      return res.json({ authenticated: false });
    }
    return res.json({ authenticated: true, host: req.session.host });
  }
  return res.json({ authenticated: false });
});

module.exports = router;
