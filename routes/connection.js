const express = require("express");
const {
  isConnected,
  getConnectedHost,
  connectWithCredentials,
  disconnect,
} = require("../db");

const router = express.Router();

// GET /api/connection/status
router.get("/status", (req, res) => {
  res.json({
    connected: isConnected(),
    host: isConnected() ? getConnectedHost() : null,
  });
});

// POST /api/connection - { host, username, password }
router.post("/", async (req, res) => {
  try {
    const { host, username, password } = req.body;
    const result = await connectWithCredentials({ host, username, password });
    res.json({ connected: true, host: result.host });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to connect" });
  }
});

// POST /api/connection/disconnect
router.post("/disconnect", async (req, res) => {
  try {
    await disconnect();
    res.json({ connected: false });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to disconnect" });
  }
});

module.exports = router;
