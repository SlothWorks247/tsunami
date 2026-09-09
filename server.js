require("dotenv").config();
const path = require("path");
const express = require("express");

const { connect } = require("./db");
const customersRouter = require("./routes/customers");
const configRouter = require("./routes/config");
const notesRouter = require("./routes/notes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/customers", customersRouter);
app.use("/api/config", configRouter);
app.use("/api/customers/:customerSlug/apps/:appSlug", notesRouter);

async function start() {
  try {
    await connect();
    app.listen(PORT, () => {
      console.log(`Notes to Sizing/POV running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
