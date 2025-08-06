const pool = require("../db/mysql");

// Créer une nouvelle notification
async function createNotification({
  user_id,
  title,
  body,
  type = "chat",
  related_id = null,
}) {
  await pool.query(
    `INSERT INTO notifications (user_id, title, body, type, related_id)
     VALUES (?, ?, ?, ?, ?)`,
    [user_id, title, body, type, related_id]
  );
}

// Récupérer les notifications non lues d'un utilisateur
async function getUnreadNotifications(userId) {
  const [rows] = await pool.query(
    `SELECT id, title, body, type, related_id, created_at
     FROM notifications
     WHERE user_id = ? AND is_read = FALSE
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

// Marquer une notification comme lue
async function markAsRead(notifId) {
  await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = ?`, [
    notifId,
  ]);
}

// Marquer toutes les notifications comme lues pour un utilisateur
async function markAllAsRead(userId) {
  await pool.query(
    `UPDATE notifications SET is_read = TRUE WHERE user_id = ?`,
    [userId]
  );
}

module.exports = {
  createNotification,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
};
