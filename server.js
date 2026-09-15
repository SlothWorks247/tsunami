const path = require("path");
const express = require("express");
const session = require("express-session");

const { requireDb, requireAuth } = require("./middleware");
const { closeAllClients, startSessionSweep } = require("./db");
const authRouter = require("./routes/auth");
const customersRouter = require("./routes/customers");
const configRouter = require("./routes/config");
const notesRouter = require("./routes/notes");
const llmRouter = require("./routes/llm");
const chatRouter = require("./routes/chat");
const skillsRouter = require("./routes/skills");
const { addListener, removeListener } = require("./services/logger");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Created explicitly (instead of letting express-session default to one
// internally) so we can hand the same store to db.js's session sweep,
// which closes MongoClients whose session has expired or been destroyed.
const sessionStore = new session.MemoryStore();

app.use(
  session({
    name: "tsunami.sid",
    secret: process.env.SESSION_SECRET || "tsunami-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

startSessionSweep(sessionStore);

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRouter);
app.use("/api/llm", requireAuth, llmRouter);
app.use("/api/skills", requireAuth, skillsRouter);

app.get("/api/log/stream", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("\n");
  addListener(req.sessionID, res);
  const cleanup = () => removeListener(req.sessionID, res);
  req.on("close", cleanup);
  req.on("error", cleanup);
});

app.use("/api/customers", requireDb, customersRouter);
app.use("/api/config", requireDb, configRouter);
app.use(
  "/api/customers/:customerSlug/apps/:appSlug",
  requireDb,
  notesRouter
);
app.use(
  "/api/customers/:customerSlug/apps/:appSlug",
  requireDb,
  chatRouter
);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error." });
});

function start() {
  const server = app.listen(PORT, () => {
    console.log(`Notes to Sizing/POV running at http://localhost:${PORT}`);
  });

  // Ensure every open MongoClient is closed cleanly on shutdown, instead of
  // relying on the OS to tear down sockets when the process is killed.
  const shutdown = (signal) => {
    console.log(`\n${signal} received, closing connections...`);
    server.close(() => {
      closeAllClients()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    // Force-exit if something hangs during cleanup.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
