/**
 * @file db/mysql.js
 * @description
 * MySQL connection manager for the Softadastra Chat system.
 *
 * This module provides:
 * - Secure, environment-based configuration loading
 * - Promise-based connection pooling (via mysql2/promise)
 * - Automatic session initialization (charset, timezone, SQL mode)
 * - SSL support for production environments
 *
 * Usage:
 * ```js
 * const { query, execute } = require('./db/mysql');
 * const [rows] = await query('SELECT * FROM chat_messages');
 * ```
 */

const mysql = require("mysql2/promise");
require("dotenv").config();

/**
 * Ensures required environment variables exist in production mode.
 * Throws an error immediately if a required variable is missing.
 */
function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v.trim();
}

const isProd = (process.env.NODE_ENV || "development") === "production";

// ---- Database connection configuration ----
const host = process.env.DB_HOST || "127.0.0.1";
const port = parseInt(process.env.DB_PORT || "3306", 10);
const user = isProd ? requireEnv("DB_USER") : process.env.DB_USER || "root";
const password = isProd
  ? requireEnv("DB_PASSWORD")
  : process.env.DB_PASSWORD ?? process.env.DB_PASS ?? "";
const database = isProd
  ? requireEnv("DB_NAME")
  : process.env.DB_NAME || "softadastra_chat";

const connLimit = parseInt(process.env.DB_CONN_LIMIT || "20", 10);
const tz = (process.env.DB_TIMEZONE || "Z").trim(); // "Z", "+03:00", etc.
const sqlMode = (
  process.env.DB_SQL_MODE ||
  "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"
).trim();

const useSSL = String(process.env.DB_SSL || "false").toLowerCase() === "true";

// ---- SSL handling ----
let ssl = undefined;
if (useSSL) {
  const fs = require("fs");
  const caPath = process.env.DB_CA_PATH;

  if (!caPath) {
    console.warn(
      "⚠️ DB_SSL=true but DB_CA_PATH is missing — falling back to rejectUnauthorized:false"
    );
    ssl = { rejectUnauthorized: false };
  } else {
    try {
      ssl = { ca: fs.readFileSync(caPath, "utf8") };
    } catch (e) {
      console.warn(
        `⚠️ Could not read DB_CA_PATH=${caPath}: ${e.message}. Falling back to rejectUnauthorized:false`
      );
      ssl = { rejectUnauthorized: false };
    }
  }
}

// ---- Create the connection pool ----
const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: connLimit,
  queueLimit: 0,
  namedPlaceholders: true,
  charset: "utf8mb4",
  timezone: "Z", // Driver-level timezone; session-level is set after connect
  ssl,
});

// ---- Session initialization on each new connection ----
pool.on("connection", (conn) => {
  conn
    .promise()
    .query("SET NAMES utf8mb4")
    .then(() => conn.promise().query("SET time_zone = ?", [tz]))
    .then(() => conn.promise().query("SET SESSION sql_mode = ?", [sqlMode]))
    .catch((e) =>
      console.warn("⚠️ Failed to initialize MySQL session:", e.message)
    );
});

// ---- Initial connection test ----
(async () => {
  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query("SELECT 1 AS ok");
      console.log("✅ MySQL pool ready. Ping =", rows[0]?.ok);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("❌ MySQL pool init error:", err.message);
  }
})();

// ---- Exports ----
module.exports = {
  pool,
  getConnection: () => pool.getConnection(),
  query: (sql, params) => pool.query(sql, params),
  execute: (sql, params) => pool.execute(sql, params),
};
