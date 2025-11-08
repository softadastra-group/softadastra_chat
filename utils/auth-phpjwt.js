/**
 * @file utils/auth-phpjwt.js
 * @description
 * Authentication middleware and JWT verification utilities for the
 * Softadastra backend services.
 *
 * This module validates incoming requests using either:
 * - A standard **PHP-compatible JWT** (HMAC-SHA256, base64url encoding).
 * - A trusted proxy header (`x-user-id`) from whitelisted admin origins.
 *
 * ## Responsibilities
 * - Verify JWT tokens issued by the PHP backend (or similar systems).
 * - Enforce expiration checks (`exp` claim).
 * - Support **cross-service authentication** between PHP, Node.js, and C++ backends.
 * - Provide a secure fallback for trusted admin origins (bridge mode).
 *
 * ## Trust Model
 * - `Authorization: Bearer <JWT>` header is preferred.
 * - If no token is provided, trusted origins may authenticate via the `x-user-id` header.
 * - Trusted origins are configured through `ADMIN_TRUSTED_ORIGINS`
 *   (comma-separated list of base URLs).
 *
 * ## Environment Variables
 * - `JWT_SECRET` or `SECRET` — Secret key for HMAC-SHA256 JWT verification.
 * - `ADMIN_TRUSTED_ORIGINS` — Comma-separated list of trusted origins
 *   (default: `http://localhost:8000,http://127.0.0.1:8000`).
 *
 * @example
 * const express = require("express");
 * const { authRequired } = require("./middleware/authRequired");
 *
 * const app = express();
 * app.use(authRequired);
 *
 * app.get("/api/me", (req, res) => {
 *   res.json({ user: req.user });
 * });
 *
 * @version 1.0.0
 * @license MIT
 */

const crypto = require("crypto");

/**
 * List of trusted admin origins for header-based authentication fallback.
 * Derived from `ADMIN_TRUSTED_ORIGINS` env variable.
 * @type {string[]}
 */
const TRUSTED_ORIGINS = (
  process.env.ADMIN_TRUSTED_ORIGINS ||
  "http://localhost:8000,http://127.0.0.1:8000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Encodes a string or buffer into **Base64URL** (RFC 4648 §5).
 *
 * @param {string|Buffer} input - Data to encode.
 * @returns {string} Base64URL-encoded string.
 */
function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Encodes a binary buffer as Base64URL.
 *
 * @param {Buffer} buf - Buffer to encode.
 * @returns {string} Base64URL string.
 */
function b64urlFromBuffer(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Decodes a Base64URL-encoded string into a Node.js Buffer.
 *
 * @param {string} b64u - Base64URL-encoded string.
 * @returns {Buffer} Decoded binary buffer.
 */
function b64urlToBuffer(b64u) {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64");
}

/**
 * Verifies a PHP-compatible JWT token (HMAC-SHA256, base64url).
 *
 * This function does **not** depend on external JWT libraries,
 * ensuring cross-compatibility between Node.js and PHP-generated tokens.
 *
 * @param {string} token - JWT string (`<header>.<payload>.<signature>`).
 * @param {string} secret - Secret key used for HMAC validation.
 * @returns {Object} Decoded JWT payload object.
 * @throws {Error} If the token format is invalid, expired, or signature mismatch.
 */
function verifyPhpJwt(token, secret) {
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Invalid token format");
  }

  const [headB64u, payB64u, sigB64u] = token.split(".");
  const signingInput = `${headB64u}.${payB64u}`;
  const hmac = crypto.createHmac("sha256", String(secret));
  hmac.update(signingInput);
  const expectedSigB64u = b64urlFromBuffer(hmac.digest());

  // Constant-time comparison
  const a = Buffer.from(expectedSigB64u);
  const b = Buffer.from(sigB64u);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Signature mismatch");
  }

  let payload;
  try {
    payload = JSON.parse(b64urlToBuffer(payB64u).toString("utf8"));
  } catch {
    throw new Error("Payload decode error");
  }

  // Expiration validation
  if (payload && typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error("Token expired");
  }

  return payload;
}

/**
 * Express middleware enforcing authentication for API routes.
 *
 * ## Behavior
 * - Checks `Authorization: Bearer <JWT>` or `cookies.token`.
 * - If JWT is valid, attaches `req.user = { id, payload }`.
 * - Otherwise, if the origin is trusted, allows `x-user-id` header (bridge mode).
 * - Responds with HTTP `401 Unauthorized` for invalid or missing credentials.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @param {Function} next - Express next middleware callback.
 * @returns {void}
 */
function authRequired(req, res, next) {
  try {
    let token = null;
    const h = req.headers.authorization || req.headers.Authorization;

    // --- Bearer JWT ---
    if (h && /^Bearer\s+/i.test(h)) token = h.replace(/^Bearer\s+/i, "").trim();
    if (!token && req.cookies && req.cookies.token) token = req.cookies.token;

    if (token) {
      const secret =
        process.env.JWT_SECRET || process.env.SECRET || "change_me";
      const payload = verifyPhpJwt(token, secret);
      const userId = payload.id || payload.user_id || payload.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      req.user = { id: Number(userId), payload };
      return next();
    }

    // --- Bridge mode for trusted admin origins ---
    const origin = String(req.headers.origin || req.headers.referer || "");
    const trusted = TRUSTED_ORIGINS.some((base) => origin.startsWith(base));
    const xuid = req.headers["x-user-id"];
    if (trusted && xuid && /^\d+$/.test(String(xuid))) {
      req.user = { id: Number(xuid), payload: { bridge: "x-user-id" } };
      return next();
    }

    return res.status(401).json({ error: "Unauthorized" });
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { authRequired, verifyPhpJwt };
