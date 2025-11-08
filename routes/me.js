/**
 * @file routes/me.js
 * @description
 * Endpoint for retrieving the currently authenticated user's information.
 *
 * Part of the **Softadastra Authentication System**.
 * This route verifies the PHP-compatible JWT via `authRequired` middleware
 * and returns the decoded user payload.
 *
 * ## Responsibilities
 * - Validate JWT token.
 * - Return authenticated user payload (as provided by PHP JWT validator).
 *
 * ## Security
 * - Requires Authorization header: `Bearer <token>`
 * - Returns `401 Unauthorized` if the token is missing or invalid.
 *
 * @module routes/me
 * @see utils/auth-phpjwt.js — JWT middleware shared between PHP and Node.js
 */
const express = require("express");
const { authRequired } = require("../utils/auth-phpjwt");

const router = express.Router();

/**
 * @route GET /api/me
 * @summary Returns information about the currently authenticated user.
 * @security JWT (authRequired)
 * @returns {object} 200 - `{ user: { id, email, name, ... } }`
 * @returns {object} 401 - `{ error: "Unauthorized" }` if the token is invalid or missing.
 * @example
 * // Example: get current user info
 * fetch("/api/me", {
 *   headers: { Authorization: `Bearer ${token}` }
 * }).then(res => res.json());
 */
router.get("/api/me", authRequired, (req, res) => {
  return res.json({ user: req.user.payload });
});

module.exports = router;
