const express = require("express");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const path = require("path");

// Monte UNIQUEMENT la route du feed pour des tests isolés
function buildTestApp() {
  const app = express();
  app.use(
    cors({
      origin: ["http://localhost:8000", "http://127.0.0.1:8000"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(compression());
  app.use(
    "/uploads",
    express.static(path.join(__dirname, "../../public/uploads"))
  );

  const feedRoutes = require("../../routes/feed"); // <- ta route fournie
  app.use("/api/feed", feedRoutes);

  // health pour debug
  app.get("/__health", (_req, res) => res.json({ ok: true }));

  return app;
}

module.exports = { buildTestApp };
