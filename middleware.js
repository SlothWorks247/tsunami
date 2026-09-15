const { getClient } = require("./db");

function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    return next();
  }
  return res.status(401).json({ error: "Not authenticated. Please log in." });
}

function requireDb(req, res, next) {
  if (!req.session || !req.session.isAuthenticated) {
    return res.status(401).json({ error: "Not authenticated. Please log in." });
  }
  const client = getClient(req.sessionID);
  if (!client) {
    return res
      .status(503)
      .json({ error: "Database connection lost. Please log in again." });
  }
  next();
}

module.exports = { requireAuth, requireDb };
