/**
 * @file ws/userState.js
 * @description
 * In-memory connection state manager for the Softadastra WebSocket ecosystem.
 *
 * This module provides a shared `Map` instance (`connectedUsers`) that
 * maintains an index of currently active WebSocket clients, keyed by
 * their unique user IDs.
 *
 * It acts as a **lightweight presence registry**, allowing any part of
 * the WebSocket system (e.g., chat, notifications, analytics) to:
 * - Broadcast presence updates (`user_online`, `user_offline`).
 * - Send direct messages or events to specific connected users.
 * - Track total online user count in real time.
 *
 * ⚠️ **Note:** This store is in-memory and local to the current Node.js process.
 * In distributed or clustered deployments, use a shared state backend
 * (e.g., Redis Pub/Sub or Socket.io adapter) for proper synchronization.
 *
 * ## Example
 * ```js
 * const { connectedUsers } = require("./userState");
 *
 * // Register a connected user
 * connectedUsers.set("123", ws);
 *
 * // Send a message to a specific user
 * const userSocket = connectedUsers.get("123");
 * if (userSocket && userSocket.readyState === 1) {
 *   userSocket.send(JSON.stringify({ type: "ping" }));
 * }
 *
 * // Remove user on disconnect
 * connectedUsers.delete("123");
 * ```
 *
 * @version 1.0.0
 * @license MIT
 */

/**
 * A Map that associates connected user IDs with their WebSocket instances.
 *
 * @type {Map<string, import("ws").WebSocket>}
 */
const connectedUsers = new Map();

module.exports = {
  connectedUsers,
};
