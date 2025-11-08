/**
 * @file routes/online-status.js
 * @description
 * Provides a lightweight API route to check which users are currently online
 * in **Softadastra Chat**.
 *
 * This endpoint reads from the in-memory `connectedUsers` map populated by
 * the WebSocket server (see `ws/userState.js`) and returns all connected
 * user IDs as an array.
 *
 * ## Responsibilities
 * - Return a list of connected user IDs.
 * - Serve as a simple health/status endpoint for real-time presence tracking.
 *
 * ## Usage
 * This route is used by the frontend to show "🟢 online" indicators or
 * refresh online status periodically without opening a WebSocket connection.
 *
 * @module routes/online-status
 * @see ws/userState.js — Maintains connected users (Map<userId, WebSocket>)
 */

const express = require("express");
const router = express.Router();

const { connectedUsers } = require("../ws/userState");

/**
 * @route GET /api/online-status
 * @summary Returns a list of currently online user IDs.
 * @description
 * Fetches the keys from the `connectedUsers` Map to determine
 * which users have an active WebSocket connection.
 *
 * @returns {object} 200 - Array of user IDs.
 * @returns {object} 500 - `{ error: "Erreur interne" }`
 *
 * @example
 * // Example response:
 * [42, 107, 215]
 *
 * @example
 * // Fetch from frontend:
 * const res = await fetch("/api/online-status");
 * const onlineUsers = await res.json();
 * console.log("Online:", onlineUsers);
 */
router.get("/online-status", (req, res) => {
  try {
    const onlineUserIds = Array.from(connectedUsers.keys());
    res.json(onlineUserIds);
  } catch (e) {
    res.status(500).json({ error: "Erreur interne" });
  }
});

module.exports = router;
