const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");

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

// Route API à ajouter dans routes/messages.js
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

// GET /api/messages/:senderId/:receiverId
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

// Supprime le contenu du message (soft delete)
router.delete("/delete/:messageId", async (req, res) => {
  const messageId = req.params.messageId;
  const userId = req.query.user_id;

  try {
    // Vérifie que le message appartient bien à l'utilisateur
    const [rows] = await pool.query(
      "SELECT * FROM chat_messages WHERE id = ? AND sender_id = ?",
      [messageId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Met à jour le message comme supprimé
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
