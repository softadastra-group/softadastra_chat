/**
 * @file utils/auth.js
 * @description
 * Express authentication middleware for verifying JSON Web Tokens (JWT).
 *
 * This middleware ensures that API routes are accessed only by authenticated users.
 * It expects a valid **Bearer token** in the `Authorization` header and verifies it
 * using the secret key defined in `process.env.JWT_SECRET`.
 *
 * ## Responsibilities
 * - Extract and verify JWT tokens from incoming HTTP requests.
 * - Decode and attach the verified user payload to `req.user`.
 * - Return HTTP 401 (`Unauthorized`) for missing or invalid tokens.
 *
 * ## Environment Variables
 * - `JWT_SECRET` — Secret key used to sign and verify JWT tokens.
 *
 * ## Example
 * ```js
 * const express = require("express");
 * const { authRequired } = require("./middleware/authRequired");
 *
 * const app = express();
 *
 * // Protect all /api routes
 * app.use("/api", authRequired);
 *
 * app.get("/api/profile", (req, res) => {
 *   res.json({ message: "Hello, authenticated user!", user: req.user });
 * });
 * ```
 *
 * @version 1.0.0
 * @license MIT
 */

const jwt = require("jsonwebtoken");

/**
 * Express middleware that enforces JWT-based authentication.
 *
 * ## Behavior
 * - Expects an `Authorization: Bearer <token>` header.
 * - Validates and decodes the JWT using the secret from `process.env.JWT_SECRET`.
 * - On success, attaches `{ id }` from the payload to `req.user`.
 * - Responds with `401 Unauthorized` if the token is invalid, missing, or expired.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @param {Function} next - Next middleware callback.
 * @returns {void}
 */
function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || req.headers.Authorization;

    // Ensure Bearer token presence
    if (!h || !/^Bearer\s+/i.test(h)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Extract token value
    const token = h.replace(/^Bearer\s+/i, "").trim();

    // Verify and decode JWT
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user information to request object
    req.user = { id: payload.id };

    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { authRequired };
