require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const compression = require("compression");
// const morgan = require("morgan");

const app = express();
const server = http.createServer(app);

// ====== WebSocket ======
const wss = new WebSocket.Server({ server }); // ws://HOST:PORT
require("./ws/index")(wss); // gestion WS (subscribe/unsubscribe + heartbeat)

// ====== Middlewares globaux (ordre important) ======
// ====== Middlewares globaux (ordre important) ======
app.use(
  cors({
    origin: [
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      // ajoute tes domaines prod ici
    ],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"], // ⬅ important pour mode 'header'
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // ⬅ pour être sûr
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(compression());

// ====== Fichiers statiques (uploads, etc.) ======
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// ====== Routes API ======
// Exemple: messages/notifications/status si tu les as déjà
const messagesRoute = require("./routes/messages");
app.use("/api/messages", messagesRoute);

const notificationsRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationsRoutes);

const statusRoutes = require("./routes/status");
app.use("/api/status", statusRoutes);

// ✅ Likes (en temps réel via WS)
const likesRoutes = require("./routes/likes");
app.use("/api", likesRoutes(wss)); // ⬅ injection du wss

// ====== Healthcheck & test ======
app.get("/", (req, res) => {
  res.json({
    message: "Hello from Softadastra Node.js API!",
    time: new Date().toISOString(),
  });
});

app.get("/test", (req, res) => {
  res.send(`<html><head><title>Test Node</title></head><body>
    <h1>✅ Serveur Node.js opérationnel</h1>
    <p>Date actuelle : ${new Date().toLocaleString()}</p>
  </body></html>`);
});

// ====== Démarrage HTTP + WS ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ HTTP OK sur http://localhost:${PORT}`);
  console.log(`✅ WebSocket OK sur ws://localhost:${PORT}`);
});

// ====== Arrêt propre ======
function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt…`);
  // Stopper les nouvelles connexions HTTP
  server.close(() => {
    console.log("HTTP fermé.");
    // Fermer WS
    try {
      wss.clients.forEach((ws) => ws.terminate());
      wss.close(() => {
        console.log("WS fermé.");
        process.exit(0);
      });
    } catch (e) {
      process.exit(0);
    }
  });

  // garde-fou si ça traîne
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
