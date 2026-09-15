const express = require("express");
const crypto = require("crypto");

const { loadDefaultSkill } = require("../services/skills");

const router = express.Router();

// GET /api/skills - default skill metadata (not full content - it can be
// large) + the list of this session's custom skills.
router.get("/", (req, res) => {
  const defaultSkill = loadDefaultSkill();
  const defaultEnabled =
    !req.session || req.session.defaultSkillEnabled !== false;

  const custom = (req.session.customSkills || []).map((s) => ({
    id: s.id,
    name: s.name,
    enabled: s.enabled !== false,
    contentPreview:
      s.content.length > 200 ? `${s.content.slice(0, 200)}...` : s.content,
    sizeKB: Math.round(Buffer.byteLength(s.content, "utf8") / 1024),
  }));

  res.json({
    default: {
      name: defaultSkill.name,
      description: defaultSkill.description,
      available: defaultSkill.available,
      enabled: defaultEnabled,
      sizeKB: defaultSkill.sizeKB,
    },
    custom,
  });
});

// PATCH /api/skills/default - toggle the built-in skill on/off for this
// session. Must be registered before /:id so "default" isn't captured as
// an id param.
router.patch("/default", (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }
  req.session.defaultSkillEnabled = enabled;
  res.json({ ok: true, enabled });
});

// POST /api/skills - add a custom skill for this session (ephemeral, not
// persisted to MongoDB - lost on logout/session expiry/server restart).
router.post("/", (req, res) => {
  const { name, content } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Skill name is required." });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Skill content is required." });
  }

  if (!req.session.customSkills) {
    req.session.customSkills = [];
  }

  const skill = {
    id: crypto.randomUUID(),
    name: name.trim(),
    content: content,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  req.session.customSkills.push(skill);

  res.status(201).json({
    id: skill.id,
    name: skill.name,
    enabled: skill.enabled,
    contentPreview:
      skill.content.length > 200
        ? `${skill.content.slice(0, 200)}...`
        : skill.content,
    sizeKB: Math.round(Buffer.byteLength(skill.content, "utf8") / 1024),
  });
});

// PATCH /api/skills/:id - update a custom skill's enabled state, name, or
// content.
router.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { enabled, name, content } = req.body || {};

  const skills = req.session.customSkills || [];
  const skill = skills.find((s) => s.id === id);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found." });
  }

  if (typeof enabled === "boolean") skill.enabled = enabled;
  if (typeof name === "string" && name.trim()) skill.name = name.trim();
  if (typeof content === "string" && content.trim()) skill.content = content;

  res.json({
    id: skill.id,
    name: skill.name,
    enabled: skill.enabled,
    contentPreview:
      skill.content.length > 200
        ? `${skill.content.slice(0, 200)}...`
        : skill.content,
    sizeKB: Math.round(Buffer.byteLength(skill.content, "utf8") / 1024),
  });
});

// DELETE /api/skills/:id - remove a custom skill.
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const skills = req.session.customSkills || [];
  const idx = skills.findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Skill not found." });
  }
  skills.splice(idx, 1);
  res.json({ ok: true });
});

module.exports = router;
