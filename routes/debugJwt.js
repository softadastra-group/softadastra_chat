/**
 * @file routes/debug-jwt.js
 * @description
 * Provides a **safe debugging endpoint** for decoding JSON Web Tokens (JWT)
 * without verifying the signature.
 *
 * This utility route is intended for **development and diagnostics only**,
 * allowing developers to inspect JWT headers and payloads quickly via HTTP.
 *
 * ## Responsibilities
 * - Extract JWT from `Authorization` header or `token` query parameter.
 * - Decode and return header + payload (base64url-decoded).
 * - Never validates or verifies token signatures.
 *
 * ## Security Warning ⚠️
 * This endpoint should **never be enabled in production** or exposed
 * publicly, as it can leak token metadata. Restrict it to development
 * environments, localhost, or admin-only access.
 *
 * @module routes/debug-jwt
 * @see utils/auth-phpjwt.js — for proper JWT verification
 */

const express = require("express");
const router = express.Router();

/**
 * @route GET /debug/jwt
 * @summary Decodes and displays a JWT’s header and payload (without verifying).
 * @description
 * Accepts a JWT either from:
 * - `Authorization: Bearer <token>` header
 * - or `?token=<jwt>` query parameter
 *
 * It splits the token by `"."`, base64url-decodes both the header and payload,
 * and returns them as JSON objects.
 *
 * @returns {object} 200 - `{ header, payload }`
 * @returns {object} 400 - `{ error: "Bad token", message: string }`
 *
 * @example
 * // Example request:
 * GET /debug/jwt?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *
 * // Example response:
 * {
 *   "header": { "alg": "HS256", "typ": "JWT" },
 *   "payload": {
 *     "sub": "42",
 *     "name": "Gaspard",
 *     "iat": 1731040400,
 *     "exp": 1731044000
 *   }
 * }
 */
router.get("/debug/jwt", (req, res) => {
  try {
    let token = null;
    const h = req.headers.authorization || req.headers.Authorization;

    // Extract Bearer token or ?token= param
    if (h && /^Bearer\s+/i.test(h)) token = h.replace(/^Bearer\s+/i, "").trim();
    if (!token && req.query.token) token = String(req.query.token);

    if (!token) return res.status(400).json({ error: "No token" });

    const [headB64u, payB64u] = token.split(".");
    if (!headB64u || !payB64u)
      return res.status(400).json({ error: "Malformed token" });

    const header = JSON.parse(
      Buffer.from(
        headB64u.replace(/-/g, "+").replace(/_/g, "/") + "==",
        "base64"
      ).toString("utf8")
    );

    const payload = JSON.parse(
      Buffer.from(
        payB64u.replace(/-/g, "+").replace(/_/g, "/") + "==",
        "base64"
      ).toString("utf8")
    );

    res.json({ header, payload });
  } catch (e) {
    res.status(400).json({ error: "Bad token", message: e.message });
  }
});

module.exports = router;
