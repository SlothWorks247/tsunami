/**
 * Per-session activity logger using Server-Sent Events (SSE).
 *
 * Each browser tab connects to GET /api/log/stream and receives log
 * entries in real-time as the app processes requests. Entries are
 * scoped by sessionId so tabs don't see each other's logs.
 *
 * Usage from routes and services:
 *   const { logStep } = require('../services/logger');
 *   logStep(sessionId, 'Generating embeddings for 8 chunks...', 'info');
 */

const listeners = new Map();

function addListener(sessionId, res) {
  if (!listeners.has(sessionId)) {
    listeners.set(sessionId, new Set());
  }
  listeners.get(sessionId).add(res);
}

function removeListener(sessionId, res) {
  const set = listeners.get(sessionId);
  if (set) {
    set.delete(res);
    if (set.size === 0) {
      listeners.delete(sessionId);
    }
  }
}

// Heartbeat interval to detect and prune dead connections
setInterval(() => {
  for (const [sessionId, set] of listeners) {
    for (const res of set) {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // Socket write failed — connection is dead, remove it
        set.delete(res);
      }
    }
    // Clean up empty sets
    if (set.size === 0) {
      listeners.delete(sessionId);
    }
  }
}, 30000);

function logStep(sessionId, message, type = 'info') {
  const entry = { message, type, timestamp: new Date().toISOString() };
  const set = listeners.get(sessionId);
  if (!set || set.size === 0) return;

  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
    }
  }
}

module.exports = { addListener, removeListener, logStep };
