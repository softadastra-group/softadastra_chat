require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const dbRouter = require("./routes/db");

// ✅ imports auth/ticket
const { verifyPhpJwt } = require("./utils/auth-phpjwt");
const { verifyWsTicket } = require("./utils/ws-ticket");

const app = express();
const server = http.createServer(app);

// ——— Durcir les timeouts HTTP pour accélérer l’extinction ———
server.keepAliveTimeout = 1_000; // 1s
server.headersTimeout = 5_000; // 5s (doit > keepAliveTimeout)

// ====== Middlewares globaux ======

const allowlist = new Set(
  (process.env.ADMIN_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// wildcard *.softadastra.com en HTTPS
function isSoftadastraWildcard(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    const h = url.hostname;
    return h === "softadastra.com" || h.endsWith(".softadastra.com");
  } catch {
    return false;
  }
}

function corsOrigin(origin, cb) {
  // Requêtes server-to-server (pas d'Origin) -> OK
  if (!origin) return cb(null, true);

  if (isSoftadastraWildcard(origin)) return cb(null, true);

  try {
    const u = new URL(origin);
    const key = `${u.protocol}//${u.host}`;
    if (allowlist.has(key)) return cb(null, true);
  } catch {}

  return cb(new Error("CORS: Origin not allowed"), false);
}

const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-user-id",
    "X-CSRF-Token",
  ],
};

// ✅ IMPORTANT: déclarer le Vary + CORS AVANT TOUTES LES ROUTES
// ---- CORS hardening: renvoie TOUJOURS les bons headers + gère OPTIONS ----
app.use((req, res, next) => {
  // Autorise uniquement tes origines
  const origin = req.headers.origin || "";
  const allow =
    /^https:\/\/([a-z0-9-]+\.)?softadastra\.com$/i.test(origin) ||
    (process.env.ADMIN_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(origin);

  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  // pour que les caches différencient selon Origin
  res.setHeader("Vary", "Origin");

  // méthodes et headers utilisés par ton front
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-user-id, X-CSRF-Token, Sec-WebSocket-Protocol"
  );

  // Répondre immédiatement aux pré-vols
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(cors(corsOptions));
// ✅ Prévols
app.options(/.*/, cors(corsOptions));

// (tes autres middlewares après)
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(compression());

// ====== Fichiers statiques ======
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));
app.use("/api", dbRouter);

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

const analyticsRoutes = require("./routes/analytics");
app.use("/api/analytics", analyticsRoutes);

const analyticsInsightsRoutes = require("./routes/analytics-insights");
app.use("/api/analytics", analyticsInsightsRoutes);

const debugJwtRoutes = require("./routes/debugJwt");
app.use("/api", debugJwtRoutes);

// ✅ AJOUTE ICI
const uploadRoutes = require("./routes/upload");
app.use("/api", uploadRoutes);

// (garde le reste)
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
const wssAnalytics = new WebSocket.Server({
  noServer: true,
  clientTracking: true,
  perMessageDeflate: false,
});

const makeAnalyticsHub = require("./live/analyticsHub");
const hub = makeAnalyticsHub(wssAnalytics);

// Pour que les routes puissent pousser les events live
app.set("analyticsLiveHub", hub);

// Pont générique: une seule méthode que les routes appellent
app.set("analyticsBroadcast", (evt) => {
  // evt attendu: { type, name?, path?, anon_id?, ts? }
  hub.onTrackEvent(evt);
});

// Snapshot minimal au connect (remonte l'active_now tout de suite)
const pool = require("./db/mysql");

// ... après makeAnalyticsHub et avant server.listen
wssAnalytics.on("connection", async (ws) => {
  try {
    ws.send(JSON.stringify({ type: "hello", now: Date.now() }));

    // --- TOP PAGES (24h) : pageview ou product_view ---
    const [topRows] = await pool.query(`
      SELECT path, SUM(views) AS views, SUM(visitors) AS visitors FROM (
        SELECT path, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS visitors
        FROM sa_pageviews
        WHERE event_time_utc >= (NOW() - INTERVAL 1 DAY)
        GROUP BY path
        UNION ALL
        SELECT path, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS visitors
        FROM sa_events
        WHERE name='product_view' AND event_time_utc >= (NOW() - INTERVAL 1 DAY)
        GROUP BY path
      ) t
      GROUP BY path
      ORDER BY views DESC
      LIMIT 50
    `);
    ws.send(
      JSON.stringify({ type: "top_pages_snapshot", rows: topRows || [] })
    );

    // --- FUNNEL (7j) : product_view, add_to_cart, checkout_start (depuis sa_events)
    const [funnelRows] = await pool.query(`
      SELECT name, COUNT(*) AS cnt
      FROM sa_events
      WHERE name IN ('product_view','add_to_cart','checkout_start')
        AND event_time_utc >= (NOW() - INTERVAL 7 DAY)
      GROUP BY name
    `);
    const base = { product_view: 0, add_to_cart: 0, checkout_start: 0 };
    for (const r of funnelRows || []) base[r.name] = Number(r.cnt) || 0;
    ws.send(JSON.stringify({ type: "funnel_snapshot", ...base }));

    // Optionnel : snapshot "active_now"
    ws.send(JSON.stringify({ type: "active_now", count: hub.getActiveNow() }));
  } catch {}
});

// utilitaire: broadcast JSON à tous les clients analytics connectés
function broadcastAnalytics(wss, msg) {
  try {
    const s = JSON.stringify(msg);
    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(s);
    });
  } catch {}
}

const initLikes = require("./ws/index");
const initChat = require("./ws/chat");
const cleanupLikes = initLikes(wssLikes) || (() => {});
const cleanupChat = initChat(wssChat) || (() => {});

wssLikes.on("connection", () => {});
wssChat.on("connection", () => {});

wssAnalytics.on("connection", (ws) => {
  ws.send(JSON.stringify({ t: "hello", now: Date.now() }));
});

// ——— TRACKER des sockets HTTP (keep-alive) ———
const httpSockets = new Set();
server.on("connection", (socket) => {
  httpSockets.add(socket);
  socket.on("close", () => httpSockets.delete(socket));
});

function isAllowedOrigin(origin) {
  if (!origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const o = `${url.protocol}//${url.host}`;

  // 1) Wildcard *.softadastra.com en https
  const host = url.hostname;
  if (
    url.protocol === "https:" &&
    (host === "softadastra.com" || host.endsWith(".softadastra.com"))
  ) {
    return true;
  }

  // 2) .env explicit allowlist
  const list = (
    process.env.ADMIN_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return list.includes(o);
}

server.on("upgrade", (req, socket, head) => {
  try {
    const origin = String(req.headers.origin || req.headers.referer || "");
    if (!isAllowedOrigin(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }

    const u = new URL(req.url, "http://localhost");
    const pathname = u.pathname;
    const token = u.searchParams.get("token");
    const ticket = u.searchParams.get("ticket"); // si côté client tu mets ?ticket=…
    const xuid = u.searchParams.get("x-user-id"); // ⚠️ tirets, pas underscore

    function ok(wss) {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req)
      );
    }

    if (pathname === "/ws/analytics") {
      const secret =
        process.env.JWT_SECRET || process.env.SECRET || "change_me";

      let authed = false;

      // 1) Si ?token=… est présent, essaie d'abord comme JWT PHP, sinon comme TICKET
      if (token && !authed) {
        try {
          const payload = verifyPhpJwt(token, secret);
          const role = String(payload?.role || payload?.r || "").toLowerCase();
          if (role === "admin" || role === "user") authed = true;
        } catch (_) {
          // pas un JWT -> essaie comme ticket court
          try {
            const v = verifyWsTicket(token, secret);
            if (v && v.userId) authed = true;
          } catch {}
        }
      }

      // 2) Si ?ticket=… est présent, vérifie-le
      if (!authed && ticket) {
        const v = verifyWsTicket(ticket, secret);
        if (v && v.userId) authed = true;
      }

      // 3) DEV fallback via ?x-user-id= (localhost uniquement)
      if (
        !authed &&
        process.env.NODE_ENV !== "production" &&
        xuid &&
        /^\d+$/.test(String(xuid))
      ) {
        authed = true;
      }

      if (authed) return ok(wssAnalytics);

      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }

    // autres WS publics
    if (pathname === "/ws/likes") return ok(wssLikes);
    if (pathname === "/ws/chat") return ok(wssChat);

    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  } catch (e) {
    try {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    } finally {
      socket.destroy();
    }
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
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) => {
  res.json({
    message: "Hello from Softadastra Node.js API!",
    time: new Date().toISOString(),
  });
});

// ====== Démarrage HTTP + WS ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ HTTP OK       : http://localhost:${PORT}`);
  console.log(`✅ WS Likes     : ws://localhost:${PORT}/ws/likes`);
  console.log(`✅ WS Chat      : ws://localhost:${PORT}/ws/chat`);
  console.log(`✅ WS Analytics : ws://localhost:${PORT}/ws/analytics`);
});

// 🔁 Pont: route /v1/track → hub live
app.set("analyticsBroadcast", (evt) => {
  // evt attendu: { type, path, anon_id, ts, name? } (ou ancien format { event: {...} })
  let norm;
  if (evt?.event && !evt.type) {
    // ancien format: { t:'event', event:{...} } ou similaire
    const e = evt.event || {};
    norm = {
      type: e.type || (e.name === "product_view" ? "product_view" : "event"),
      name: e.name || null,
      path: e.path || "/",
      anon_id: e.anon_id || null,
      ts: e.ts || Date.now(),
      // tu peux inclure d'autres champs ici si tu veux les logger
    };
  } else {
    norm = {
      type: String(evt?.type || "event"),
      name: evt?.name || null,
      path: evt?.path || "/",
      anon_id: evt?.anon_id || null,
      ts: evt?.ts || Date.now(),
    };
  }

  // 1) On nourrit le hub (pour active_now + diffs)
  hub.onTrackEvent(norm);

  // 2) On push le "raw event" au flux live des clients (t: 'event')
  broadcastAnalytics(wssAnalytics, { t: "event", event: norm });
});

const analyticsV1 = express.Router();

// pré-vol explicite (pas obligatoire grâce au middleware, mais propre)
analyticsV1.options("/v1/track", (req, res) => res.sendStatus(204));

// acceptation silencieuse (204) des événements
analyticsV1.post("/v1/track", (req, res) => {
  // TODO: persister si besoin
  res.sendStatus(204);
});

app.use("/api/analytics", analyticsV1);

// ----- Error handler global (CORS & autres) -----
app.use((err, req, res, next) => {
  if (String(err && err.message).startsWith("CORS:")) {
    try {
      res.setHeader("Vary", "Origin");
    } catch {}
    return res.status(403).json({ error: "CORS origin not allowed" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
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
