const path = require("path");
const express = require("express");

const { tryAutoReconnect } = require("./db");
const { requireConnection } = require("./middleware");
const connectionRouter = require("./routes/connection");
const customersRouter = require("./routes/customers");
const configRouter = require("./routes/config");
const notesRouter = require("./routes/notes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/connection", connectionRouter);
app.use("/api/customers", requireConnection, customersRouter);
app.use("/api/config", requireConnection, configRouter);
app.use(
  "/api/customers/:customerSlug/apps/:appSlug",
  requireConnection,
  notesRouter
);

async function start() {
  app.listen(PORT, () => {
    console.log(`Notes to Sizing/POV running at http://localhost:${PORT}`);
  });

  // Attempt a silent reconnect using any previously saved credentials.
  // If this fails or nothing is saved, the app just stays disconnected
  // and the frontend will show the connect screen.
  await tryAutoReconnect();
}

start();
