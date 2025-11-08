/**
 * @file routes/db-health.js
 * @description
 * Provides lightweight **database health and statistics endpoints** for
 * monitoring the MySQL connection used by **Softadastra Chat**.
 *
 * These routes are primarily used by infrastructure monitoring tools,
 * uptime checks, or internal dashboards to verify database connectivity
 * and general health metrics.
 *
 * ## Responsibilities
 * - `/db/ping` → checks connection and returns current database/time.
 * - `/db/stats` → returns basic message/thread counts.
 *
 * ## Security
 * These endpoints are **read-only** and designed to be safe for internal or
 * authenticated access. They should not expose sensitive data.
 *
 * @module routes/db-health
 * @see db/mysql.js — MySQL connection pool instance
 */

const express = require("express");
const router = express.Router();
const { pool } = require("../db/mysql");

// -----------------------------------------------------------------------------
// ROUTE: /db/ping
// -----------------------------------------------------------------------------

/**
 * @route GET /api/db/ping
 * @summary Pings the MySQL database and returns the current timestamp.
 * @description
 * Simple connection check. Executes `SELECT NOW(), DATABASE()` to verify
 * that the connection pool is active and the database is reachable.
 *
 * @returns {object} 200 - `{ ok: true, db: string, now: string }`
 * @returns {object} 500 - `{ ok: false, error: string }`
 *
 * @example
 * // Response example
 * {
 *   "ok": true,
 *   "db": "softadastra_chat",
 *   "now": "2025-11-08T07:20:34.000Z"
 * }
 */
router.get("/db/ping", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT NOW() AS now, DATABASE() AS db");
    res.json({ ok: true, db: rows[0]?.db, now: rows[0]?.now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------------------------------------------------------
// ROUTE: /db/stats
// -----------------------------------------------------------------------------

/**
 * @route GET /api/db/stats
 * @summary Returns basic statistics about chat messages and threads.
 * @description
 * Useful for admin dashboards or system monitoring tools.
 * Queries `chat_messages` and `chat_threads` tables and returns record counts.
 *
 * @returns {object} 200 - `{ ok: true, messages: number, threads: number }`
 * @returns {object} 500 - `{ ok: false, error: string }`
 *
 * @example
 * // Example response
 * {
 *   "ok": true,
 *   "messages": 1245,
 *   "threads": 96
 * }
 */
router.get("/db/stats", async (_req, res) => {
  try {
    const [[m]] = await pool.query(
      "SELECT COUNT(*) AS messages FROM chat_messages"
    );
    const [[t]] = await pool.query(
      "SELECT COUNT(*) AS threads FROM chat_threads"
    );
    res.json({ ok: true, messages: m.messages, threads: t.threads });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
