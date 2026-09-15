const express = require("express");
const {
  getCustomersCollection,
} = require("../db");
const { getRelevantNotes } = require("../services/retrieval");
const { chatCompletion } = require("../services/llm");
const { DEFAULT_SYSTEM_PROMPT, DEFAULT_RULES } = require("./llm");
const { logStep } = require("../services/logger");

const router = express.Router({ mergeParams: true });

async function findCustomer(sessionId, customerSlug) {
  return await getCustomersCollection(sessionId).findOne({
    dbSlug: customerSlug,
  });
}

router.post("/chat", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const { message, history, retrievalMode } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    if (!req.session.llmEndpoint || !req.session.llmModel) {
      return res.status(400).json({
        error: "LLM not configured. Open Settings to configure a provider.",
      });
    }

    const customer = await findCustomer(req.sessionID, customerSlug);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    const app = (customer.apps || []).find((a) => a.appSlug === appSlug);
    if (!app) {
      return res.status(404).json({ error: "App not found." });
    }

    const customerName = customer.name;
    const appName = app.name;

    const {
      context: notesContext,
      count: notesUsed,
      total: notesTotal,
      method: retrievalMethod,
    } = await getRelevantNotes(
      req.sessionID,
      customerSlug,
      appSlug,
      message,
      {
        apiKey: req.session.voyageApiKey || null,
        model: req.session.voyageModel || "voyage-4-lite",
        mode: retrievalMode || "smart",
      }
    );

    const systemPromptTemplate =
      req.session.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const rules = req.session.rules || DEFAULT_RULES;

    let systemPrompt = systemPromptTemplate
      .replace(/\{customerName\}/g, customerName)
      .replace(/\{appName\}/g, appName);

    if (notesContext) {
      systemPrompt += `\n\nThe following engagement notes are available for this customer and app:\n\n${notesContext}\n\n`;
    } else {
      systemPrompt += `\n\nNo notes are currently available for this customer and app.\n\n`;
    }

    systemPrompt += `Rules:\n${rules}`;

    const messages = [{ role: "system", content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history) {
        if (h.role && h.content) {
          messages.push({ role: h.role, content: h.content });
        }
      }
    }
    messages.push({ role: "user", content: message });

    logStep(
      req.sessionID,
      `Sending request to LLM (${req.session.llmModel}) with ${messages.length} messages...`,
      "info"
    );
    const { reply, usage } = await chatCompletion({
      endpoint: req.session.llmEndpoint,
      model: req.session.llmModel,
      messages,
      apiKey: req.session.llmApiKey,
    });

    const tokenStr = usage
      ? `${usage.total_tokens || 0} tokens`
      : "N/A tokens";
    logStep(
      req.sessionID,
      `LLM response received (${tokenStr})`,
      "success"
    );

    return res.json({
      reply,
      usage,
      notesUsed,
      notesTotal,
      retrievalMethod,
    });
  } catch (err) {
    console.error("Chat error:", err.message);
    return res
      .status(500)
      .json({ error: err.message || "Chat request failed." });
  }
});

const SUMMARY_SYSTEM_PROMPT = `You are an AI assistant for Solutions Architects working with MongoDB Atlas.

Your task is to generate a comprehensive executive summary of engagement notes for {customerName} / {appName}.

The notes contain discovery findings, meeting recaps, architecture discussions, and sizing requirements gathered during customer engagements. Synthesize the key information into a clear, structured executive summary.

Organize the summary with the following sections (omit any that lack supporting information in the notes):
- Overview: A brief paragraph summarizing the engagement and customer context.
- Data & Workload: Key data characteristics, volume estimates, access patterns, and growth expectations.
- Architecture & Design: Schema considerations, data model findings, indexing needs, or architectural decisions mentioned.
- Sizing Considerations: Any sizing-relevant details (data size, throughput, latency requirements, growth projections).
- Open Questions & Risks: Unresolved questions, risks, or areas needing further discovery.

Keep the summary factual and grounded in the notes. Reference specific notes where appropriate.`;

router.post("/summary", async (req, res) => {
  try {
    const { customerSlug, appSlug } = req.params;
    const { retrievalMode } = req.body || {};

    if (!req.session.llmEndpoint || !req.session.llmModel) {
      return res.status(400).json({
        error: "LLM not configured. Open Settings to configure a provider.",
      });
    }

    const customer = await findCustomer(req.sessionID, customerSlug);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    const app = (customer.apps || []).find((a) => a.appSlug === appSlug);
    if (!app) {
      return res.status(404).json({ error: "App not found." });
    }

    const customerName = customer.name;
    const appName = app.name;

    const summaryQuery =
      "summarize all key findings, data requirements, architecture notes, and sizing-relevant information from the engagement notes";

    logStep(req.sessionID, "Generating executive summary...", "info");

    const {
      context: notesContext,
      count: notesUsed,
      total: notesTotal,
      method: retrievalMethod,
    } = await getRelevantNotes(
      req.sessionID,
      customerSlug,
      appSlug,
      summaryQuery,
      {
        apiKey: req.session.voyageApiKey || null,
        model: req.session.voyageModel || "voyage-4-lite",
        mode: retrievalMode || "smart",
      }
    );

    if (!notesContext) {
      return res.json({
        summary:
          "No notes are available for this customer and app. Add notes first, then click Update Summary.",
        notesUsed: 0,
        notesTotal: 0,
        retrievalMethod: "none",
      });
    }

    let systemPrompt = SUMMARY_SYSTEM_PROMPT.replace(
      /\{customerName\}/g,
      customerName
    ).replace(/\{appName\}/g, appName);

    systemPrompt += `\n\nThe following engagement notes are available for this customer and app:\n\n${notesContext}\n\n`;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Please generate a comprehensive executive summary based on the notes above.",
      },
    ];

    const tokenStr0 = `Retrieval: ${retrievalMethod === "vector" ? "Vector Search" : "All Notes"} — ${notesUsed} note${notesUsed !== 1 ? "s" : ""} used (${notesTotal} total)`;
    logStep(req.sessionID, tokenStr0, "info");

    logStep(
      req.sessionID,
      `Sending summary request to LLM (${req.session.llmModel})...`,
      "info"
    );
    const { reply, usage } = await chatCompletion({
      endpoint: req.session.llmEndpoint,
      model: req.session.llmModel,
      messages,
      apiKey: req.session.llmApiKey,
    });

    const tokenStr = usage
      ? `${usage.total_tokens || 0} tokens`
      : "N/A tokens";
    logStep(req.sessionID, `Summary generated (${tokenStr})`, "success");

    return res.json({
      summary: reply,
      usage,
      notesUsed,
      notesTotal,
      retrievalMethod,
    });
  } catch (err) {
    console.error("Summary error:", err.message);
    return res
      .status(500)
      .json({ error: err.message || "Summary request failed." });
  }
});

module.exports = router;
