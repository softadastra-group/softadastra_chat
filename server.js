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

// ——— Durcir les timeouts HTTP pour accélérer l’extinction ———
server.keepAliveTimeout = 1_000; // 1s
server.headersTimeout = 5_000; // 5s (doit > keepAliveTimeout)

// ====== Middlewares globaux ======
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

// ====== Fichiers statiques ======
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// ====== Routes API ======
const messagesRoute = require("./routes/messages");
app.use("/api/messages", messagesRoute);

const notificationsRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationsRoutes);

const statusRoutes = require("./routes/status");
app.use("/api/status", statusRoutes);

const shopLocationsRoutes = require("./routes/shopLocations");
app.use("/api", shopLocationsRoutes);

const feedRoutes = require("./routes/feed");
app.use("/api/feed", feedRoutes);

const debugJwtRoutes = require("./routes/debugJwt");
app.use("/api", debugJwtRoutes);

const meRoute = require("./routes/me");
app.use(meRoute);

// ====== WS (mode noServer) + upgrade manuel ======
const wssLikes = new WebSocket.Server({
  noServer: true,
  clientTracking: true,
  perMessageDeflate: false,
});
const wssChat = new WebSocket.Server({
  noServer: true,
  clientTracking: true,
  perMessageDeflate: false,
});

// ⚠️ cleanup WS
const initLikes = require("./ws/index");
const initChat = require("./ws/chat");
const cleanupLikes = initLikes(wssLikes) || (() => {});
const cleanupChat = initChat(wssChat) || (() => {});

wssLikes.on("connection", () => console.log("🤝 WS likes connection OK"));
wssChat.on("connection", () => console.log("🤝 WS chat connection OK"));

// ——— TRACKER des sockets HTTP (keep-alive) ———
const httpSockets = new Set();
server.on("connection", (socket) => {
  httpSockets.add(socket);
  socket.on("close", () => httpSockets.delete(socket));
});

// Router les upgrades selon l’URL
server.on("upgrade", (req, socket, head) => {
  console.log(
    "🔁 HTTP upgrade =>",
    req.url,
    "Origin:",
    req.headers.origin || "-"
  );
  const u = req.url || "";
  if (u === "/ws/likes" || u.startsWith("/ws/likes?")) {
    wssLikes.handleUpgrade(req, socket, head, (ws) =>
      wssLikes.emit("connection", ws, req)
    );
  } else if (u === "/ws/chat" || u.startsWith("/ws/chat?")) {
    wssChat.handleUpgrade(req, socket, head, (ws) =>
      wssChat.emit("connection", ws, req)
    );
  } else {
    try {
      socket.destroy();
    } catch {}
  }
});

// Upload images (réutilisé par /api/feed/photo si besoin)
const multer = require("multer");
const upload = multer({ dest: path.join(__dirname, "public/uploads") });
app.post("/api/chat/upload", upload.array("images[]", 10), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ image_urls: urls });
});

// ✅ Likes (en temps réel via WS)
const likesRoutes = require("./routes/likes");
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
let shuttingDown = false;
function closeWSS(wss, label) {
  try {
    wss.clients.forEach((ws) => {
      try {
        ws.close(1001, "server-shutdown");
      } catch {}
    });
    setTimeout(() => {
      wss.clients.forEach((ws) => {
        try {
          ws.terminate();
        } catch {}
      });
      try {
        wss.close(() => console.log(`${label} fermé.`));
      } catch {}
    }, 300).unref();
  } catch {}
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} reçu, arrêt…`);
  try {
    cleanupLikes();
  } catch {}
  try {
    cleanupChat();
  } catch {}
  closeWSS(wssLikes, "WS Likes");
  closeWSS(wssChat, "WS Chat");
  server.close(() => {
    console.log("HTTP fermé.");
    httpSockets.forEach((s) => {
      try {
        s.destroy();
      } catch {}
    });
    httpSockets.clear();
    setTimeout(() => process.exit(0), 800).unref();
  });
  setTimeout(() => {
    httpSockets.forEach((s) => {
      try {
        s.destroy();
      } catch {}
    });
  }, 300).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ✅ Export APRÈS définition
module.exports = { app, server };
