const express = require("express");

const router = express.Router();

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant for Solutions Architects working with MongoDB Atlas.

Your purpose is to help SAs query and analyze engagement notes for a specific customer and application. The notes contain discovery findings, meeting recaps, architecture discussions, and sizing requirements gathered during customer engagements.

Use the provided notes as your primary source of information. Answer questions about the customer's data, workload, requirements, and architecture based on what the notes say. If the notes mention specific numbers, technologies, or constraints, reference them directly.`;

const DEFAULT_RULES = `- Answer based on the notes provided. If the notes contain the information, state it clearly.
- If you are making inferences or assumptions not directly supported by the notes, wrap them in {{unverified}}...{{/unverified}} markers.
- If you don't have notes about a topic, say "I don't have any notes about that."
- Do not present fabricated information as fact.
- When discussing sizing or architecture, reference specific notes that support your reasoning.`;

// ---------- LLM config ----------

router.post("/config", (req, res) => {
  const { provider, endpoint, model, apiKey, systemPrompt, rules } = req.body || {};

  if (!provider || !endpoint || !model) {
    return res
      .status(400)
      .json({ error: "Provider, endpoint, and model are required." });
  }

  req.session.llmProvider = provider;
  req.session.llmEndpoint = endpoint.trim();
  req.session.llmModel = model.trim();
  if (apiKey && apiKey.trim()) {
    req.session.llmApiKey = apiKey.trim();
  } else {
    delete req.session.llmApiKey;
  }
  if (systemPrompt !== undefined) {
    req.session.systemPrompt = systemPrompt;
  }
  if (rules !== undefined) {
    req.session.rules = rules;
  }

  return res.json({
    ok: true,
    provider,
    endpoint: req.session.llmEndpoint,
    model: req.session.llmModel,
  });
});

router.get("/config", (req, res) => {
  if (req.session && req.session.llmEndpoint) {
    return res.json({
      configured: true,
      provider: req.session.llmProvider || "custom",
      endpoint: req.session.llmEndpoint,
      model: req.session.llmModel,
      systemPrompt: req.session.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      rules: req.session.rules || DEFAULT_RULES,
    });
  }
  return res.json({
    configured: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    rules: DEFAULT_RULES,
  });
});

router.get("/models", async (req, res) => {
  const endpoint = (req.query.endpoint || "http://localhost:11434")
    .trim()
    .replace(/\/+$/, "");
  try {
    const r = await fetch(`${endpoint}/api/tags`);
    if (!r.ok) {
      return res.json({ models: [] });
    }
    const data = await r.json();
    const models = (data.models || []).map((m) => m.name);
    return res.json({ models });
  } catch (err) {
    return res.json({ models: [] });
  }
});

// ---------- Voyage AI Embeddings config ----------

router.post("/embeddings/config", (req, res) => {
  const { apiKey, model } = req.body || {};

  if (apiKey && apiKey.trim()) {
    req.session.voyageApiKey = apiKey.trim();
  } else {
    delete req.session.voyageApiKey;
  }

  if (model && model.trim()) {
    req.session.voyageModel = model.trim();
  } else {
    delete req.session.voyageModel;
  }

  return res.json({
    ok: true,
    configured: !!req.session.voyageApiKey,
    model: req.session.voyageModel || "voyage-4-lite",
  });
});

router.get("/embeddings/config", (req, res) => {
  const configured = !!(req.session && req.session.voyageApiKey);
  return res.json({
    configured,
    model: (req.session && req.session.voyageModel) || "voyage-4-lite",
  });
});

router.post("/embeddings/test", async (req, res) => {
  try {
    const { apiKey, model } = req.body || {};
    const key =
      (apiKey && apiKey.trim()) ||
      (req.session && req.session.voyageApiKey);
    const useModel =
      (model && model.trim()) ||
      (req.session && req.session.voyageModel) ||
      "voyage-4-lite";

    if (!key) {
      return res.json({
        ok: false,
        error: "No API key provided. Enter a key or save one in Settings first.",
      });
    }

    const { generateEmbedding } = require("../services/embeddings");
    const embedding = await generateEmbedding(
      "hello world",
      key,
      useModel,
      "query"
    );

    if (!embedding || embedding.length === 0) {
      return res.json({ ok: false, error: "API returned an empty embedding." });
    }

    return res.json({ ok: true, dimensions: embedding.length, model: useModel });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
module.exports.DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
module.exports.DEFAULT_RULES = DEFAULT_RULES;
