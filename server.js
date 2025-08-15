require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const compression = require("compression");

const app = express();
const server = http.createServer(app);

// ====== Middlewares globaux ======
app.use(
  cors({
    origin: ["http://localhost:8000", "http://127.0.0.1:8000"], // + tes domaines prod
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(compression());

// ====== Fichiers statiques ======
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// ====== Routes API ======
const messagesRoute = require("./routes/messages");
app.use("/api/messages", messagesRoute);

const notificationsRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationsRoutes);

const statusRoutes = require("./routes/status");
app.use("/api/status", statusRoutes);

// ====== WS (mode noServer) + upgrade manuel ======
const wssLikes = new WebSocket.Server({ noServer: true });
require("./ws/index")(wssLikes);

const wssChat = new WebSocket.Server({ noServer: true });
require("./ws/chat")(wssChat);

// Logs utiles
wssLikes.on("connection", () => console.log("🤝 WS likes connection OK"));
wssChat.on("connection", () => console.log("🤝 WS chat connection OK"));

// Router les upgrades selon l’URL
server.on("upgrade", (req, socket, head) => {
  console.log(
    "🔁 HTTP upgrade =>",
    req.url,
    "Origin:",
    req.headers.origin || "-"
  );

  // Sécurise la connexion upgrade uniquement
  const u = req.url || "";
  if (u === "/ws/likes" || u.startsWith("/ws/likes?")) {
    wssLikes.handleUpgrade(req, socket, head, (ws) => {
      wssLikes.emit("connection", ws, req);
    });
  } else if (u === "/ws/chat" || u.startsWith("/ws/chat?")) {
    wssChat.handleUpgrade(req, socket, head, (ws) => {
      wssChat.emit("connection", ws, req);
    });
  } else {
    // Chemin inconnu → on refuse
    try {
      socket.destroy();
    } catch {}
  }
});

// server.js (ou routes/chatUpload.js)
const multer = require("multer");
const upload = multer({ dest: path.join(__dirname, "public/uploads") });

app.post("/api/chat/upload", upload.array("images[]", 10), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ image_urls: urls });
});

// ✅ Likes (en temps réel via WS)
const likesRoutes = require("./routes/likes");
// ⬇️ on injecte le bon WS (likes)
app.use("/api", likesRoutes(wssLikes));

// ====== Healthcheck ======
app.get("/", (req, res) => {
  res.json({
    message: "Hello from Softadastra Node.js API!",
    time: new Date().toISOString(),
  });
});

// ====== Démarrage HTTP + WS ======
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ HTTP OK  : http://localhost:${PORT}`);
  console.log(`✅ WS Likes : ws://localhost:${PORT}/ws/likes`);
  console.log(`✅ WS Chat  : ws://localhost:${PORT}/ws/chat`);
});

// ====== Arrêt propre ======
function closeWSS(wss, label) {
  try {
    wss.clients.forEach((ws) => {
      try {
        ws.terminate();
      } catch {}
    });
    wss.close(() => console.log(`${label} fermé.`));
  } catch {}
}

function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt…`);

  server.close(() => {
    console.log("HTTP fermé.");
    closeWSS(wssLikes, "WS Likes");
    closeWSS(wssChat, "WS Chat");
    // garde-fou si un callback traîne
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
