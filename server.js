const path = require("path");
const express = require("express");

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

function start() {
  app.listen(PORT, () => {
    console.log(`Notes to Sizing/POV running at http://localhost:${PORT}`);
  });
}

start();
