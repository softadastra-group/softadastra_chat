const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");

// ✅ DOIT ÊTRE EN PREMIER
router.get("/unread/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: "ID utilisateur invalide" });
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
      `SELECT id, sender_id, content, image_urls, seen, created_at, product_id 
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

module.exports = router;
