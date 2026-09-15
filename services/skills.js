/**
 * Skills system for the AI Assistant.
 *
 * "Skills" are blocks of specialized instructions/reference material that
 * get appended to the system prompt sent to the LLM. There are two kinds:
 *
 *   1. The default skill - bundled with the app at
 *      mongodb-schema-design/SKILL.md (+ its references/ folder). Loaded
 *      once from disk and cached in memory for the life of the process.
 *      Users can toggle it on/off per session but cannot edit its content.
 *
 *   2. Custom skills - pasted or uploaded by a user via Settings. These are
 *      stored ephemerally in req.session.customSkills (no MongoDB), so they
 *      disappear on logout/session expiry/server restart, matching how the
 *      System Prompt/Rules settings already behave.
 *
 * Both kinds are combined by getSkillsBlock(req) and appended to the system
 * prompt in routes/chat.js for both /chat and /summary requests.
 */

const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.join(__dirname, "..", "mongodb-schema-design");
const SKILL_MD_PATH = path.join(SKILL_DIR, "SKILL.md");
const REFERENCES_DIR = path.join(SKILL_DIR, "references");

let cachedDefaultSkill = null;

/**
 * Strips a leading YAML frontmatter block (--- ... ---) from raw markdown.
 */
function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? content.slice(match[0].length) : content;
}

/**
 * Extracts a single top-level "key: value" field from a YAML frontmatter
 * block, without pulling in a full YAML parser. Only used for display
 * metadata (name/description), never for anything security-sensitive.
 */
function extractFrontmatterField(raw, field) {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatterMatch) return null;
  const block = frontmatterMatch[1];
  const fieldMatch = block.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return fieldMatch ? fieldMatch[1].trim() : null;
}

/**
 * The bundled SKILL.md includes a "MongoDB MCP Integration" section that
 * assumes a live MongoDB MCP Server connection and a write/destructive
 * operation approval workflow - neither of which exist in tsunami's chat
 * (services/llm.js has no tool-calling capability at all). We cut
 * everything from that section onward so the LLM isn't told about
 * capabilities it doesn't actually have.
 */
function stripMcpSection(content) {
  const marker = "## How These Rules Work";
  const idx = content.indexOf(marker);
  if (idx === -1) return content.trim();
  const before = content.slice(0, idx);
  return before.replace(/\r?\n---\r?\n\s*$/, "\n").trimEnd();
}

/**
 * Loads and caches the bundled default skill: SKILL.md (frontmatter and
 * MCP section stripped) plus every reference file concatenated in. This
 * can be a large amount of text (tens of thousands of tokens) - see
 * getSkillsBlock's doc comment for the tradeoff this implies.
 */
function loadDefaultSkill() {
  if (cachedDefaultSkill) return cachedDefaultSkill;

  let raw;
  try {
    raw = fs.readFileSync(SKILL_MD_PATH, "utf8");
  } catch {
    cachedDefaultSkill = {
      name: "mongodb-schema-design",
      description: null,
      content: "",
      available: false,
      sizeKB: 0,
    };
    return cachedDefaultSkill;
  }

  const name = extractFrontmatterField(raw, "name") || "mongodb-schema-design";
  const description = extractFrontmatterField(raw, "description");
  const skillBody = stripMcpSection(stripFrontmatter(raw));

  let referencesContent = "";
  try {
    const files = fs
      .readdirSync(REFERENCES_DIR)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .sort();
    const parts = files.map((f) => {
      const body = fs.readFileSync(path.join(REFERENCES_DIR, f), "utf8");
      return `### Reference: ${f}\n\n${body.trim()}`;
    });
    referencesContent = parts.join("\n\n---\n\n");
  } catch {
    referencesContent = "";
  }

  const fullContent = referencesContent
    ? `${skillBody}\n\n---\n\n## Reference Material\n\n${referencesContent}`
    : skillBody;

  cachedDefaultSkill = {
    name,
    description,
    content: fullContent,
    available: true,
    sizeKB: Math.round(Buffer.byteLength(fullContent, "utf8") / 1024),
  };
  return cachedDefaultSkill;
}

/**
 * Builds the full "skills" block to append to a system prompt: the default
 * skill (if enabled for this session, which is the default) followed by
 * any enabled custom skills the user has added this session. Returns ""
 * if nothing is enabled/available so callers can append it unconditionally.
 *
 * Note: the default skill's full content (SKILL.md + all references) is
 * included verbatim whenever enabled - this can be tens of thousands of
 * tokens. Make sure the configured LLM's context window can handle it.
 */
function getSkillsBlock(req) {
  const parts = [];

  const defaultEnabled =
    !req.session || req.session.defaultSkillEnabled !== false;
  if (defaultEnabled) {
    const skill = loadDefaultSkill();
    if (skill.available && skill.content) {
      parts.push(`## Skill: ${skill.name}\n\n${skill.content}`);
    }
  }

  const customSkills =
    (req.session && req.session.customSkills) || [];
  for (const s of customSkills) {
    if (s.enabled === false) continue;
    if (!s.content) continue;
    parts.push(`## Skill: ${s.name}\n\n${s.content}`);
  }

  if (parts.length === 0) return "";
  return `\n\nThe following specialized skills are available to you:\n\n${parts.join(
    "\n\n---\n\n"
  )}`;
}

module.exports = { loadDefaultSkill, getSkillsBlock };
