/**
 * @file routes/messages.js
 * @description
 * Chat message read APIs for the **Softadastra Chat** service.
 * Provides endpoints to fetch unread counters, latest messages per thread,
 * per-sender unread counts, full thread history, and a soft-delete operation.
 *
 * ## Responsibilities
 * - Compute unread message counts per user and per sender.
 * - Return the last message per thread for a given user.
 * - Resolve a (sender, receiver) pair to a canonical thread and list messages.
 * - Soft-delete a message authored by the requesting user.
 *
 * ## Database (simplified)
 * - `chat_threads(id, user1_id, user2_id, created_at, ...)`
 * - `chat_messages(id, thread_id, sender_id, content, image_urls, seen, deleted, product_id, created_at, ...)`
 *
 * ## Security
 * - These routes currently do **not** enforce auth middleware in this file.
 *   In production, protect them with JWT (`authRequired`) and derive `userId`
 *   from the token instead of trusting URL parameters.
 *
 * @module routes/messages
 * @see db/mysql.js — MySQL pool (mysql2/promise)
 */
const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");

/**
 * @route GET /unread/:userId
 * @summary Returns total unread messages for the given user.
 * @param {number} req.params.userId - Target user ID.
 * @returns {object} 200 - `{ unread: number }`
 * @returns {object} 400 - `{ error: "Invalid user ID" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * // => { "unread": 5 }
 */
router.get("/unread/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS unread
       FROM chat_messages m
       JOIN chat_threads t ON m.thread_id = t.id
       WHERE
         ((t.user1_id = ? AND m.sender_id = t.user2_id)
         OR (t.user2_id = ? AND m.sender_id = t.user1_id))
         AND m.seen = FALSE`,
      [userId, userId]
    );

    res.json({ unread: rows[0].unread || 0 });
  } catch (err) {
    console.error("Erreur lors du comptage des messages non lus :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route GET /last-message/:userId
 * @summary Returns, for each thread of the user, the latest message and counterpart.
 * @param {number} req.params.userId - Target user ID.
 * @returns {object} 200 - `{ messages: Array<{thread_id, other_user_id, body, last_date}> }`
 * @returns {object} 400 - `{ error: "ID invalide" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * // => { "messages": [{ "thread_id": 12, "other_user_id": 7, "body": "Hi", "last_date": "2025-11-08T10:00:00Z" }] }
 */
router.get("/last-message/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({ error: "ID invalide" });

  try {
    const [rows] = await pool.query(
      `
      SELECT 
        t.id AS thread_id,
        CASE 
          WHEN t.user1_id = ? THEN t.user2_id
          ELSE t.user1_id
        END AS other_user_id,
        m.content AS body,
        m.created_at AS last_date
      FROM chat_threads t
      JOIN chat_messages m ON m.thread_id = t.id
      WHERE (t.user1_id = ? OR t.user2_id = ?)
        AND m.created_at = (
          SELECT MAX(created_at)
          FROM chat_messages
          WHERE thread_id = t.id
        )
      ORDER BY m.created_at DESC
      `,
      [userId, userId, userId]
    );

    res.json({ messages: rows });
  } catch (err) {
    console.error("Erreur récupération derniers messages:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route GET /unread-count/:userId
 * @summary Returns unread counts grouped by sender for the given user.
 * @param {number} req.params.userId - Target user ID.
 * @returns {object} 200 - `{ unreadByUser: { [sender_id: number]: number } }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * // => { "unreadByUser": { "17": 2, "21": 1 } }
 */
router.get("/unread-count/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);

  try {
    const [rows] = await pool.query(
      `SELECT 
          CASE 
            WHEN t.user1_id = ? THEN t.user2_id
            ELSE t.user1_id
          END AS sender_id,
          COUNT(*) AS unread_count
       FROM chat_messages m
       JOIN chat_threads t ON m.thread_id = t.id
       WHERE 
         (
           (t.user1_id = ? AND m.sender_id = t.user2_id)
           OR 
           (t.user2_id = ? AND m.sender_id = t.user1_id)
         )
         AND m.seen = FALSE
       GROUP BY sender_id`,
      [userId, userId, userId]
    );

    const map = {};
    rows.forEach((row) => {
      map[row.sender_id] = row.unread_count;
    });

    res.json({ unreadByUser: map });
  } catch (err) {
    console.error("Erreur unread-count:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route GET /:senderId/:receiverId
 * @summary Returns the full ordered message list for the canonical thread (sender, receiver).
 * @param {number} req.params.senderId - Sender user ID.
 * @param {number} req.params.receiverId - Receiver user ID.
 * @returns {object} 200 - `{ thread_id: number, messages: Array<Message> }`
 * @returns {object} 400 - `{ error: "IDs invalides" }`
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * // => { "thread_id": 9, "messages": [{ "id":1, "sender_id":7, "content":"Hello", "image_urls":[], "seen":0, "deleted":0, "product_id":null, "created_at":"..." }] }
 *
 * @typedef {object} Message
 * @property {number} id
 * @property {number} sender_id
 * @property {string|null} content
 * @property {string[]} image_urls
 * @property {0|1|boolean} seen
 * @property {0|1|boolean} deleted
 * @property {number|null} product_id
 * @property {string} created_at
 */
router.get("/:senderId/:receiverId", async (req, res) => {
  const senderId = parseInt(req.params.senderId);
  const receiverId = parseInt(req.params.receiverId);

  if (!senderId || !receiverId) {
    return res.status(400).json({ error: "IDs invalides" });
  }

  const a = Math.min(senderId, receiverId);
  const b = Math.max(senderId, receiverId);

  try {
    const [[thread]] = await pool.query(
      `SELECT id FROM chat_threads WHERE user1_id = ? AND user2_id = ? LIMIT 1`,
      [a, b]
    );

    if (!thread) {
      return res.json({ messages: [] });
    }

    const [messages] = await pool.query(
      `SELECT id, sender_id, content, image_urls, seen, created_at,deleted, product_id 
       FROM chat_messages 
       WHERE thread_id = ? 
       ORDER BY created_at ASC`,
      [thread.id]
    );

    const formatted = messages.map((msg) => ({
      ...msg,
      image_urls: msg.image_urls ? JSON.parse(msg.image_urls) : [],
      extra_data: msg.product_id ? { product_id: msg.product_id } : undefined,
    }));

    return res.json({ thread_id: thread.id, messages: formatted });
  } catch (err) {
    console.error("Erreur chargement messages :", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * @route DELETE /delete/:messageId
 * @summary Soft-deletes a message authored by the requesting user (mask content, set deleted=1).
 * @param {number} req.params.messageId - Message ID to delete.
 * @param {number} req.query.user_id - Requesting user ID (⚠️ prefer JWT in production).
 * @returns {object} 200 - `{ success: true }` if deletion succeeded.
 * @returns {object} 403 - `{ error: "Unauthorized" }` if not the author.
 * @returns {object} 500 - `{ error: "Erreur serveur" }`
 * @example
 * // => { "success": true }
 */
router.delete("/delete/:messageId", async (req, res) => {
  const messageId = req.params.messageId;
  const userId = req.query.user_id;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM chat_messages WHERE id = ? AND sender_id = ?",
      [messageId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await pool.query(
      "UPDATE chat_messages SET content = NULL, deleted = 1 WHERE id = ?",
      [messageId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur suppression message:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
