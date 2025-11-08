/**
 * @file utils/notifications.js
 * @description
 * Repository module responsible for managing user notifications within the
 * Softadastra platform. Provides CRUD-style helpers to create, fetch, and update
 * notification states (read/unread) using MySQL.
 *
 * ## Responsibilities
 * - Insert new notifications for specific users (chat, system, order, etc.).
 * - Retrieve unread notifications ordered by creation date.
 * - Mark individual or all notifications as read.
 *
 * ## Database Schema (simplified)
 * - `notifications`
 *   - `id` INT AUTO_INCREMENT PRIMARY KEY
 *   - `user_id` INT
 *   - `title` VARCHAR(255)
 *   - `body` TEXT
 *   - `type` ENUM('chat','system','order','custom',...)
 *   - `related_id` INT NULL
 *   - `is_read` BOOLEAN DEFAULT FALSE
 *   - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
 *
 * ## Example
 * ```js
 * const {
 *   createNotification,
 *   getUnreadNotifications,
 *   markAsRead,
 *   markAllAsRead
 * } = require("./repositories/notificationRepository");
 *
 * // Create a new notification
 * await createNotification({
 *   user_id: 5,
 *   title: "New message received",
 *   body: "You have a new chat message from John.",
 *   type: "chat",
 *   related_id: 123
 * });
 *
 * // Fetch unread notifications
 * const unread = await getUnreadNotifications(5);
 *
 * // Mark one as read
 * await markAsRead(unread[0].id);
 * ```
 *
 * @version 1.0.0
 * @license MIT
 */

const pool = require("../db/mysql");

/**
 * Creates a new notification for a specific user.
 *
 * @async
 * @param {Object} params - Notification creation payload.
 * @param {number} params.user_id - The user ID who will receive the notification.
 * @param {string} params.title - Short title summarizing the notification.
 * @param {string} params.body - Detailed message or description.
 * @param {string} [params.type="chat"] - Notification category (e.g., `"chat"`, `"system"`, `"order"`).
 * @param {?number} [params.related_id=null] - Optional related entity ID (e.g., order or chat thread).
 * @returns {Promise<void>} Resolves when the notification is inserted.
 */
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

/**
 * Retrieves all unread notifications for a specific user.
 *
 * @async
 * @param {number} userId - The ID of the user whose unread notifications are requested.
 * @returns {Promise<Object[]>} Array of unread notifications ordered by `created_at DESC`.
 * Each object includes: `{ id, title, body, type, related_id, created_at }`.
 */
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

/**
 * Marks a single notification as read by its ID.
 *
 * @async
 * @param {number} notifId - The ID of the notification to mark as read.
 * @returns {Promise<void>} Resolves when the update is complete.
 */
async function markAsRead(notifId) {
  await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = ?`, [
    notifId,
  ]);
}

/**
 * Marks all notifications for a user as read.
 *
 * @async
 * @param {number} userId - The ID of the user whose notifications should be marked as read.
 * @returns {Promise<void>} Resolves when all notifications are updated.
 */
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
