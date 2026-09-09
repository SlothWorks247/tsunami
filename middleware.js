const { isConnected } = require("./db");

/**
 * Blocks access to data routes until a database connection has been
 * established via the connect screen (or auto-reconnected from a
 * previously saved local connection).
 */
function requireConnection(req, res, next) {
  if (!isConnected()) {
    return res
      .status(503)
      .json({ error: "Not connected to a database. Please connect first." });
  }
  next();
}

module.exports = { requireConnection };
