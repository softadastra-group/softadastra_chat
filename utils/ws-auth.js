/**
 * @file utils/ws-auth.js
 * @description
 * WebSocket authentication utility for the Softadastra platform.
 *
 * This module provides helper functions to authenticate WebSocket
 * connections initiated by admins or trusted services.
 * It supports both:
 * - **JWT-based authentication** (compatible with PHP-issued tokens).
 * - **Header/Query-based fallback** for trusted admin origins.
 *
 * ## Responsibilities
 * - Parse and validate JWT tokens passed via WebSocket connection URLs.
 * - Allow admin/user access based on verified token roles.
 * - Support trusted origins for bridge mode (e.g., admin dashboards).
 *
 * ## Authentication Methods
 * 1. **JWT Token (preferred)**
 *    URL parameter: `?token=<JWT>`
 *    Token is verified via `verifyPhpJwt()` using `JWT_SECRET` or `SECRET`.
 *    The decoded payload must contain a valid role (`admin` or `user`).
 *
 * 2. **Trusted Origin with User ID (bridge mode)**
 *    URL parameters: `?x-user-id=<ID>`
 *    Works only if the connection originates from a trusted base URL
 *    listed in `ADMIN_ORIGINS` (comma-separated list).
 *
 * ## Environment Variables
 * - `JWT_SECRET` or `SECRET` — Secret key used for verifying PHP-compatible JWT tokens.
 * - `ADMIN_ORIGINS` — Comma-separated list of trusted admin origins.
 *
 * ## Example
 * ```js
 * const WebSocket = require("ws");
 * const { wsIsAdmin } = require("./utils/ws-auth");
 *
 * const wss = new WebSocket.Server({ port: 8080 });
 *
 * wss.on("connection", (ws, req) => {
 *   if (!wsIsAdmin(req)) {
 *     ws.close(4001, "Unauthorized");
 *     return;
 *   }
 *   ws.send("Welcome, admin!");
 * });
 * ```
 *
 * @version 1.0.0
 * @license MIT
 */

const { verifyPhpJwt } = require("./auth-phpjwt");

/**
 * Parses the query string portion of a URL and returns an object of key-value pairs.
 *
 * @param {string} [u=""] - Full URL or path with query parameters.
 * @returns {Record<string, string>} Parsed query parameters.
 */
function parseQS(u = "") {
  const i = u.indexOf("?");
  if (i < 0) return {};
  return Object.fromEntries(new URLSearchParams(u.slice(i + 1)));
}

/**
 * Determines whether a WebSocket connection request belongs to an authenticated
 * admin or trusted user. This function performs both JWT verification and
 * trusted-origin checks.
 *
 * ## Behavior
 * - If a `token` query parameter is present, verify it as a PHP-style JWT.
 *   - Valid roles: `"admin"` or `"user"`.
 * - If an `x-user-id` query parameter is present, allow it only if the origin
 *   is part of a trusted admin origin list (`ADMIN_ORIGINS`).
 *
 * @param {import("http").IncomingMessage} req - WebSocket connection request object.
 * @returns {boolean} `true` if the connection is authorized; otherwise `false`.
 */
function wsIsAdmin(req) {
  try {
    const q = parseQS(req.url || "");

    // --- JWT-based authentication ---
    if (q.token) {
      const payload = verifyPhpJwt(
        q.token,
        process.env.JWT_SECRET || process.env.SECRET || "change_me"
      );

      const role = String(payload?.role || payload?.r || "").toLowerCase();

      // Allow if token belongs to an admin or user role
      if (role === "admin" || role === "user") return true;
      return false;
    }

    // --- Bridge mode (trusted admin origin + x-user-id) ---
    if (q["x-user-id"] && /^\d+$/.test(String(q["x-user-id"]))) {
      const origin = String(req.headers.origin || req.headers.referer || "");
      const trusted = (
        process.env.ADMIN_ORIGINS ||
        "http://localhost:8000,http://127.0.0.1:8000"
      )
        .split(",")
        .map((s) => s.trim());

      // Optionally validate that the connection originates from a trusted base URL
      if (trusted.some((base) => origin.startsWith(base))) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

module.exports = { wsIsAdmin };
