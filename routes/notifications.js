const express = require("express");
const pool = require("../db/mysql");

const router = express.Router();
const {
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
} = require("../utils/notifications");

// 🔹 GET : Notifications non lues d'un utilisateur
router.get("/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "ID invalide" });

    const notifications = await getUnreadNotifications(userId);
    res.json({ notifications });
  } catch (error) {
    console.error("❌ Erreur get notifications :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 🔹 POST : Marquer une seule notification comme lue
router.post("/read/:notifId", async (req, res) => {
  try {
    const notifId = parseInt(req.params.notifId);
    if (isNaN(notifId)) return res.status(400).json({ error: "ID invalide" });

    await markAsRead(notifId);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur markAsRead :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 🔹 POST : Marquer toutes les notifications comme lues
router.post("/read-all/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "ID invalide" });

    await markAllAsRead(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur markAllAsRead :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 📜 Récupérer l’historique des notifications (plus complet)
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

// 🔴 Suppression d'une notification
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
