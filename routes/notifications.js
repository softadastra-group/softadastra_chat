/**
 * @file routes/notifications.js
 * @description
 * REST API routes for managing user notifications in **Softadastra**.
 * Provides endpoints to list, mark, delete, and paginate notifications.
 *
 * ## Responsibilities
 * - Fetch unread notifications for a specific user.
 * - Mark one or all notifications as read.
 * - Retrieve full notification history (with pagination).
 * - Delete notifications by ID.
 *
 * ## Database (simplified)
 * - `notifications(id, user_id, title, body, type, related_id, seen, created_at)`
 *
 * ## Security
 * - Currently public for simplicity; in production, protect with JWT middleware.
 * - Prefer deriving `user_id` from the JWT instead of URL params.
 *
 * @module routes/notifications
 * @see utils/notifications.js — Helper functions for querying and updating notifications.
 */
const express = require("express");
const pool = require("../db/mysql");

const router = express.Router();
const {
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
} = require("../utils/notifications");

/**
 * @route GET /api/notifications/:userId
 * @summary Returns all unread notifications for the given user.
 * @param {number} req.params.userId - Target user ID.
 * @returns {object} 200 - `{ notifications: Notification[] }`
 * @returns {object} 400 - `{ error: "ID invalide" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 *
 * @typedef {object} Notification
 * @property {number} id
 * @property {string} title
 * @property {string} body
 * @property {string} type
 * @property {number|null} related_id
 * @property {boolean} seen
 * @property {string} created_at
 *
 * @example
 * // Example response:
 * {
 *   "notifications": [
 *     { "id": 1, "title": "New message", "body": "You have a new message.", "seen": false }
 *   ]
 * }
 */
router.get("/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "ID invalide" });

    const notifications = await getUnreadNotifications(userId);
    res.json({ notifications });
  } catch (error) {
    console.error("Erreur get notifications :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route POST /api/notifications/read/:notifId
 * @summary Marks a single notification as read.
 * @param {number} req.params.notifId - Notification ID.
 * @returns {object} 200 - `{ success: true }`
 * @returns {object} 400 - `{ error: "ID invalide" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * fetch("/api/notifications/read/5", { method: "POST" });
 */
router.post("/read/:notifId", async (req, res) => {
  try {
    const notifId = parseInt(req.params.notifId);
    if (isNaN(notifId)) return res.status(400).json({ error: "ID invalide" });

    await markAsRead(notifId);
    res.json({ success: true });
  } catch (error) {
    console.error("Erreur markAsRead :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route POST /api/notifications/read-all/:userId
 * @summary Marks all notifications for the user as read.
 * @param {number} req.params.userId - User ID.
 * @returns {object} 200 - `{ success: true }`
 * @returns {object} 400 - `{ error: "ID invalide" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * fetch("/api/notifications/read-all/42", { method: "POST" });
 */
router.post("/read-all/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "ID invalide" });

    await markAllAsRead(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("Erreur markAllAsRead :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route GET /api/notifications/history/:userId
 * @summary Returns paginated notification history (read and unread).
 * @param {number} req.params.userId - User ID.
 * @param {number} [req.query.page=1] - Page number (optional).
 * @param {number} [req.query.limit=20] - Results per page (optional).
 * @returns {object} 200 - `{ notifications: Notification[] }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * fetch("/api/notifications/history/42?page=2&limit=10").then(r => r.json());
 */
router.get("/history/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  try {
    const [rows] = await pool.query(
      `SELECT id, title, body, type, related_id, seen, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
    res.json({ notifications: rows });
  } catch (err) {
    console.error("Erreur chargement notifications :", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route DELETE /api/notifications/delete/:notifId
 * @summary Permanently deletes a notification by ID.
 * @param {number} req.params.notifId - Notification ID.
 * @returns {object} 200 - `{ success: true }`
 * @returns {object} 400 - `{ error: "ID invalide" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * fetch("/api/notifications/delete/12", { method: "DELETE" });
 */
router.delete("/delete/:notifId", async (req, res) => {
  const notifId = parseInt(req.params.notifId);
  if (isNaN(notifId)) return res.status(400).json({ error: "ID invalide" });

  try {
    await pool.query(`DELETE FROM notifications WHERE id = ?`, [notifId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur suppression notification :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
