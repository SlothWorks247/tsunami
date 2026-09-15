const path = require("path");
const express = require("express");
const session = require("express-session");

const { requireDb, requireAuth } = require("./middleware");
const authRouter = require("./routes/auth");
const customersRouter = require("./routes/customers");
const configRouter = require("./routes/config");
const notesRouter = require("./routes/notes");
const llmRouter = require("./routes/llm");
const chatRouter = require("./routes/chat");
const { addListener, removeListener } = require("./services/logger");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "tsunami.sid",
    secret: process.env.SESSION_SECRET || "tsunami-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRouter);
app.use("/api/llm", requireAuth, llmRouter);

app.get("/api/log/stream", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");
  addListener(req.sessionID, res);
  req.on("close", () => removeListener(req.sessionID, res));
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
  app.listen(PORT, () => {
    console.log(`Notes to Sizing/POV running at http://localhost:${PORT}`);
  });
}

start();
