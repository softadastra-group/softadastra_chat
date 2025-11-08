/**
 * @file routes/analyticsTrack.js
 * @description
 * REST API routes for the **Softadastra Analytics Tracking System**.
 *
 * This module ingests client-side tracking events (page views, product interactions,
 * and custom events) and stores them in structured MySQL tables for further analysis.
 * It also integrates live WebSocket broadcasting for real-time dashboards.
 *
 * ## Responsibilities
 * - Track and persist analytics data from the frontend.
 * - Maintain user sessions (via anon_id / user_id).
 * - Compute device and browser metadata.
 * - Emit real-time updates for analytics dashboards.
 *
 * ## Database Tables
 * - **sa_sessions** → session metadata (first_seen_utc, last_seen_utc, user_id)
 * - **sa_pageviews** → page-level metrics
 * - **sa_events** → custom and funnel events
 * - **sa_product_views** → product interactions
 *
 * ## Security
 * - `/v1/track` — Public endpoint (no auth required, validates UUIDs)
 * - `/ws-ticket` — Protected route (`authRequired`, PHP-JWT compatible)
 *
 * @module routes/analyticsTrack
 * @see db/mysql.js - MySQL connection pool
 * @see utils/ws-ticket.js - WebSocket ticket generator
 * @see utils/auth-phpjwt.js - Authentication middleware
 */

/**
 * @typedef {Object} TrackEventPayload
 * @property {string} event_id - Unique event UUID (v4).
 * @property {string} anon_id - Anonymous visitor UUID (v4).
 * @property {number} [user_id] - Optional user ID if authenticated.
 * @property {string} type - Event type: `"pageview"`, `"product_view"`, or `"event"`.
 * @property {string} [name] - Event name if type = `"event"`.
 * @property {string} [path] - Page or route path.
 * @property {string} [referrer] - Referring URL.
 * @property {Object} [payload] - Custom event data.
 * @property {Object} [utm] - UTM parameters (source, medium, campaign).
 * @property {Object} [viewport] - Browser viewport size.
 * @property {number} [scroll_max_pct] - Max scroll depth percentage (0–100).
 * @property {number} [time_in_view_ms] - Time spent on view in milliseconds.
 * @property {number} [tz_offset_min] - Timezone offset in minutes.
 * @property {number|string|Date} [ts] - Event timestamp.
 */

/**
 * @typedef {Object} WsTicketResponse
 * @property {string} ticket - Signed WebSocket token.
 * @property {number} ttl_sec - Token lifetime in seconds.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");
const { createWsTicket } = require("../utils/ws-ticket");
const { authRequired } = require("../utils/auth-phpjwt");

/** Utils */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}
function devBrowser(ua = "") {
  ua = String(ua).toLowerCase();
  return {
    device: /mobile|iphone|android/.test(ua)
      ? "mobile"
      : /ipad|tablet/.test(ua)
      ? "tablet"
      : "desktop",
    browser: /chrome\//.test(ua)
      ? "chrome"
      : /firefox\//.test(ua)
      ? "firefox"
      : /safari\//.test(ua)
      ? "safari"
      : "other",
    os: /windows/.test(ua)
      ? "windows"
      : /mac os x/.test(ua)
      ? "mac"
      : /android/.test(ua)
      ? "android"
      : /linux/.test(ua)
      ? "linux"
      : "other",
  };
}
const TRUNC = (s, n) => (s == null ? null : String(s).slice(0, n));

/**
 * @route POST /api/analytics/v1/track
 * @summary Ingests analytics events from clients.
 * @param {TrackEventPayload} req.body - Event payload (pageview, product_view, event)
 * @returns {object} 200 - `{ ok: true }` if stored successfully
 * @returns {object} 400 - `{ error: "anon_id invalid" | "event_id invalid" | "type invalid" }`
 * @returns {object} 500 - `{ error: "server" }` on internal failure
 * @example
 * // Example: tracking a product view
 * fetch("/api/analytics/v1/track", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({
 *     event_id: crypto.randomUUID(),
 *     anon_id: "b1234d77-452e-4f5a-85d0-c92ed92b72de",
 *     type: "product_view",
 *     path: "/products/42",
 *     payload: { product_id: 42, price: 49.99, currency: "USD" }
 *   })
 * });
 */
router.post("/v1/track", async (req, res) => {
  try {
    const h = req.headers || {};
    const ip = TRUNC(
      (h["x-forwarded-for"] || req.socket?.remoteAddress || "")
        .split(",")[0]
        .trim(),
      45
    );
    const ua = String(h["user-agent"] || "");
    const {
      event_id,
      anon_id,
      user_id,
      ts,
      type,
      path,
      query,
      referrer,
      utm = {},
      viewport = {},
      scroll_max_pct,
      time_in_view_ms,
      name,
      payload,
      tz_offset_min,
    } = req.body || {};

    // Validate ids
    if (!isUUID(anon_id))
      return res.status(400).json({ error: "anon_id invalid" });
    if (!isUUID(event_id))
      return res.status(400).json({ error: "event_id invalid" });

    const eventTime = new Date(typeof ts === "number" ? ts : Date.now());
    const { device, browser, os } = devBrowser(ua);

    // Upsert session (requires UNIQUE(anon_id))
    await pool.query(
      `INSERT INTO sa_sessions
        (anon_id, user_id, first_seen_utc, last_seen_utc, first_ip, last_ip, first_ua, last_ua, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_seen_utc=VALUES(last_seen_utc),
         last_ip=VALUES(last_ip),
         last_ua=VALUES(last_ua),
         user_id=IFNULL(VALUES(user_id), user_id)`,
      [
        anon_id,
        user_id || null,
        eventTime,
        eventTime,
        ip,
        ip,
        TRUNC(ua, 255),
        TRUNC(ua, 255),
        TRUNC((h["accept-language"] || "").split(",")[0], 16) || null,
      ]
    );

    // Get session id (pas critique si null)
    const [[sessRow]] = await pool.query(
      `SELECT id FROM sa_sessions WHERE anon_id=? ORDER BY id ASC LIMIT 1`,
      [anon_id]
    );
    const session_id = sessRow?.id || null;

    // Route by type
    if (type === "pageview") {
      await pool.query(
        `INSERT INTO sa_pageviews
         (anon_id,user_id,session_id,event_time_utc,path,query,referrer,
          utm_source,utm_medium,utm_campaign,device,browser,os,viewport_w,viewport_h,scroll_max_pct,time_in_view_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          anon_id,
          user_id || null,
          session_id,
          eventTime,
          TRUNC(path || "/", 512),
          TRUNC(query || null, 512),
          TRUNC(referrer || null, 512),
          TRUNC(utm.source || null, 64),
          TRUNC(utm.medium || null, 64),
          TRUNC(utm.campaign || null, 64),
          device,
          browser,
          os,
          viewport?.w != null
            ? clamp(parseInt(viewport.w, 10), 0, 10000)
            : null,
          viewport?.h != null
            ? clamp(parseInt(viewport.h, 10), 0, 10000)
            : null,
          scroll_max_pct != null
            ? clamp(parseInt(scroll_max_pct, 10), 0, 100)
            : 0,
          time_in_view_ms != null
            ? clamp(parseInt(time_in_view_ms, 10), 0, 86400000)
            : 0,
        ]
      );
    } else if (type === "product_view") {
      const pid = payload?.product_id ? parseInt(payload.product_id, 10) : null;
      await pool.query(
        `INSERT INTO sa_product_views
         (anon_id,user_id,session_id,event_time_utc,product_id,price,currency)
         VALUES (?,?,?,?,?,?,?)`,
        [
          anon_id,
          user_id || null,
          session_id,
          eventTime,
          pid,
          payload?.price ?? null,
          TRUNC(payload?.currency || null, 3),
        ]
      );
      await pool.query(
        `INSERT IGNORE INTO sa_events
         (event_id,anon_id,user_id,session_id,event_time_utc,name,path,referrer,payload)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          event_id,
          anon_id,
          user_id || null,
          session_id,
          eventTime,
          "product_view",
          TRUNC(path || "/", 512),
          TRUNC(referrer || null, 512),
          JSON.stringify({ ...payload, tz_offset_min }),
        ]
      );
    } else if (type === "event") {
      await pool.query(
        `INSERT IGNORE INTO sa_events
         (event_id,anon_id,user_id,session_id,event_time_utc,name,path,referrer,payload)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          event_id,
          anon_id,
          user_id || null,
          session_id,
          eventTime,
          TRUNC(name || "custom", 64),
          TRUNC(path || "/", 512),
          TRUNC(referrer || null, 512),
          JSON.stringify({ ...payload, tz_offset_min, device, browser, os }),
        ]
      );
    } else {
      return res.status(400).json({ error: "type invalid" });
    }

    // Live (normalisé): pousse un event au hub
    req.app.get("analyticsBroadcast")?.({
      type, // 'pageview' | 'product_view' | 'event'
      name: name || null, // utile quand type === 'event' (ex: 'add_to_cart')
      path: path || "/", // IMPORTANT pour Top pages
      anon_id: anon_id, // pour uniques "visitors" live
      ts: eventTime.getTime(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("track error:", {
      message: e.message,
      code: e.code,
      errno: e.errno,
      sqlState: e.sqlState,
      sqlMessage: e.sqlMessage,
      sql: e.sql,
      stack: e.stack,
    });
    const isDev = process.env.NODE_ENV !== "production";
    return res.status(500).json({
      error: "server",
      detail: isDev ? e.sqlMessage || e.message : undefined,
    });
  }
});

/**
 * @route POST /api/analytics/ws-ticket
 * @summary Generates a short-lived WebSocket access token for analytics dashboards.
 * @security JWT (authRequired)
 * @returns {WsTicketResponse} 200 - JSON containing the ticket and TTL in seconds
 * @returns {object} 401 - `{ error: "Unauthorized" }` if JWT is missing or invalid
 * @returns {object} 500 - `{ error: "ticket_failed" }` if token creation fails
 * @example
 * // Example: requesting a live analytics ticket
 * fetch("/api/analytics/ws-ticket", {
 *   method: "POST",
 *   headers: { Authorization: `Bearer ${token}` }
 * }).then(res => res.json());
 */
router.post("/ws-ticket", authRequired, (req, res) => {
  try {
    const uid = req.user?.id;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const secret = process.env.JWT_SECRET || process.env.SECRET || "change_me";
    const ticket = createWsTicket(uid, secret);
    res.json({ ticket, ttl_sec: 60 });
  } catch (e) {
    res.status(500).json({ error: "ticket_failed" });
  }
});

module.exports = router;
