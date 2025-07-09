const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");

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
      `SELECT id, sender_id, content, image_urls, seen, created_at 
       FROM chat_messages 
       WHERE thread_id = ? 
       ORDER BY created_at ASC`,
      [thread.id]
    );

    // 🔄 Parser les champs JSON (image_urls)
    const formatted = messages.map((msg) => ({
      ...msg,
      image_urls: msg.image_urls ? JSON.parse(msg.image_urls) : [],
    }));

    return res.json({ thread_id: thread.id, messages: formatted });
  } catch (err) {
    console.error("Erreur chargement messages :", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
