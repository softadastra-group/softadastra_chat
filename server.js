/**
 * @file server.js
 * @description
 * Main entry point for the **Softadastra Node.js API Server**.
 *
 * This file bootstraps the Express application, configures CORS and middleware,
 * mounts REST routes, and initializes multiple WebSocket hubs (Likes, Chat, Analytics)
 * used across Softadastra’s real-time ecosystem.
 *
 * ## Key Responsibilities
 * - Configure and secure the Express HTTP server with proper CORS and compression.
 * - Serve static assets (uploads) with long-term caching.
 * - Handle authentication for WebSocket upgrades via JWT or one-time tickets.
 * - Expose REST API routes for messages, notifications, analytics, uploads, and feeds.
 * - Manage three real-time WebSocket hubs:
 *   - `/ws/likes` → real-time product likes
 *   - `/ws/chat` → real-time messaging
 *   - `/ws/analytics` → live user activity and funnel tracking
 * - Gracefully handle shutdown signals (`SIGINT`, `SIGTERM`) to close sockets and HTTP.
 *
 * ## Environment Variables
 * - `PORT` — HTTP listening port (default: 3001)
 * - `HOST` — host interface (default: 127.0.0.1)
 * - `ADMIN_ORIGINS` — comma-separated list of allowed admin origins
 * - `JWT_SECRET` or `SECRET` — secret used for JWT and WS ticket validation
 * - `NODE_ENV` — environment mode (`development` or `production`)
 *
 * ## Notes
 * - The server uses manual WebSocket upgrade handling for fine-grained auth control.
 * - Long-lived CORS configuration allows both local development and production HTTPS.
 * - Static uploads are cached for 365 days with `immutable` headers for optimal performance.
 *
 * @author
 * Softadastra Backend Team — https://softadastra.com
 * @version 1.0.0
 */

require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const dbRouter = require("./routes/db");

const { verifyPhpJwt } = require("./utils/auth-phpjwt");
const { verifyWsTicket } = require("./utils/ws-ticket");

const app = express();
const server = http.createServer(app);

server.keepAliveTimeout = 1_000; // 1s
server.headersTimeout = 5_000; // 5s (must be > keepAliveTimeout)

// ====== Global Middlewares ======

const allowlist = new Set(
  (process.env.ADMIN_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// wildcard *.softadastra.com over HTTPS
function isSoftadastraWildcard(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false; // production only HTTPS
    const h = url.hostname;
    return h === "softadastra.com" || h.endsWith(".softadastra.com");
  } catch {
    return false;
  }
}

function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);

  // ✅ Production: *.softadastra.com over HTTPS
  if (isSoftadastraWildcard(origin)) return cb(null, true);

  try {
    const u = new URL(origin);

    // ✅ Developer friendly: allow localhost and 127.0.0.1 (any port)
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      return cb(null, true);
    }

    const key = `${u.protocol}//${u.host}`; // host includes port
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
    "Sec-WebSocket-Protocol",
  ],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// (other middlewares)
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(compression());

// ====== Static Files (uploaded images) ======
const uploadDir = path.join(__dirname, "public/uploads");

app.use(
  "/uploads",
  express.static(uploadDir, {
    immutable: true,
    maxAge: "365d", // long cache
  })
);

// ====== API Routes ======
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

// ✅ Added upload routes
const uploadRoutes = require("./routes/upload");
app.use("/api", uploadRoutes);

// (rest)
const meRoute = require("./routes/me");
app.use(meRoute);

const pushPublic = require("./routes/push-public");
app.use("/api/push", pushPublic);

// ====== WS (noServer mode) + manual upgrade ======
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

app.set("analyticsLiveHub", hub);

app.set("analyticsBroadcast", (evt) => {
  // expected event: { type, name?, path?, anon_id?, ts? }
  hub.onTrackEvent(evt);
});

const pool = require("./db/mysql");

wssAnalytics.on("connection", async (ws) => {
  try {
    ws.send(JSON.stringify({ type: "hello", now: Date.now() }));

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

    ws.send(JSON.stringify({ type: "active_now", count: hub.getActiveNow() }));
  } catch {}
});

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

// ——— HTTP socket tracker (keep-alive) ———
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

  const host = url.hostname;
  if (
    url.protocol === "https:" &&
    (host === "softadastra.com" || host.endsWith(".softadastra.com"))
  ) {
    return true;
  }

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
    const ticket = u.searchParams.get("ticket");
    const xuid = u.searchParams.get("x-user-id");

    function ok(wss) {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req)
      );
    }

    if (pathname === "/ws/analytics") {
      const secret =
        process.env.JWT_SECRET || process.env.SECRET || "change_me";

      let authed = false;

      if (token && !authed) {
        try {
          const payload = verifyPhpJwt(token, secret);
          const role = String(payload?.role || payload?.r || "").toLowerCase();
          if (role === "admin" || role === "user") authed = true;
        } catch (_) {
          try {
            const v = verifyWsTicket(token, secret);
            if (v && v.userId) authed = true;
          } catch {}
        }
      }

      if (!authed && ticket) {
        const v = verifyWsTicket(ticket, secret);
        if (v && v.userId) authed = true;
      }

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

// Image uploads
const multer = require("multer");
const upload = multer({ dest: path.join(__dirname, "public/uploads") });
app.post("/api/chat/upload", upload.array("images[]", 10), (req, res) => {
  const urls = (req.files || []).map((f) => `/uploads/${f.filename}`);
  res.json({ image_urls: urls });
});

// ✅ Likes (real-time via WS)
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

// ====== Start HTTP + WS ======
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";

server.listen(PORT, HOST, () => {
  console.log(`✅ HTTP OK       : http://${HOST}:${PORT}`);
  console.log(`✅ WS Likes     : ws://${HOST}:${PORT}/ws/likes`);
  console.log(`✅ WS Chat      : ws://${HOST}:${PORT}/ws/chat`);
  console.log(`✅ WS Analytics : ws://${HOST}:${PORT}/ws/analytics`);
});

// 🔁 Bridge: route /v1/track → live hub
app.set("analyticsBroadcast", (evt) => {
  let norm;
  if (evt?.event && !evt.type) {
    const e = evt.event || {};
    norm = {
      type: e.type || (e.name === "product_view" ? "product_view" : "event"),
      name: e.name || null,
      path: e.path || "/",
      anon_id: e.anon_id || null,
      ts: e.ts || Date.now(),
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

  hub.onTrackEvent(norm);
  broadcastAnalytics(wssAnalytics, { t: "event", event: norm });
});

// ====== Analytics V1 minimal ======
const analyticsV1 = express.Router();
analyticsV1.options("/v1/track", (req, res) => res.sendStatus(204));
analyticsV1.post("/v1/track", (req, res) => {
  try {
    const broadcast = req.app.get("analyticsBroadcast");
    if (typeof broadcast === "function") {
      broadcast(req.body || {});
    }
    res.set("X-Handler", "analyticsV1");
    return res.sendStatus(204);
  } catch (e) {
    console.error("analytics v1 error:", e);
    return res.sendStatus(204);
  }
});
analyticsV1.all("/v1/track", (req, res) => {
  res.set("Allow", "OPTIONS, POST");
  return res.sendStatus(405);
});
app.use("/api/analytics", analyticsV1);

// ----- Global Error Handler -----
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

// ====== Graceful Shutdown ======
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
        wss.close(() => console.log(`${label} closed.`));
      } catch {}
    }, 300).unref();
  } catch {}
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down…`);
  try {
    cleanupLikes();
  } catch {}
  try {
    cleanupChat();
  } catch {}
  closeWSS(wssLikes, "WS Likes");
  closeWSS(wssChat, "WS Chat");
  server.close(() => {
    console.log("HTTP closed.");
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

module.exports = { app, server };
