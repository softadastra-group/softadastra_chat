/**
 * @file ws/chat.js
 * @description
 * Real-time chat WebSocket gateway for the Softadastra platform.
 *
 * This module manages authenticated chat sessions, presence, typing status,
 * message delivery/ack, read receipts, and navigation badge counts
 * (unread messages + unread notifications). It is designed to work with
 * a MySQL persistence layer and a simple in-memory connection registry.
 *
 * ## Responsibilities
 * - Maintain client liveness (ping/pong heartbeat) and presence events.
 * - Compute and push navigation counters: `{ notifications, messages }`.
 * - Ensure 1:1 thread creation/lookup for two participants.
 * - Insert messages (text + optional images + optional product context).
 * - Emit message acknowledgements, typing events, read receipts.
 * - Trigger in-app notifications for receivers.
 *
 * ## WebSocket Events (inbound)
 * - `{ type: "auth", user_id }`
 * - `{ type: "echo", data }`
 * - `{ type: "nav_counts" }`
 * - `{ type: "who_is_online" }`
 * - `{ type: "subscribe", channels: string[] }`
 * - `{ type: "typing", from, to }`
 * - `{ type: "message_seen", thread_id, user_id }`
 * - `{ type: "message_send" | "message", sender_id, receiver_id?, thread_id?, content?, image_urls?, temp_id?, extra_data? }`
 *
 * ## WebSocket Events (outbound)
 * - `{ type: "auth_ok", user_id, ts }`
 * - `{ type: "nav_counts", payload: { notifications, messages } }`
 * - `{ type: "user_online" | "user_offline", user_id }`
 * - `{ type: "subscribed", channels }`
 * - `{ type: "typing", from }`
 * - `{ type: "stop_typing", from }`
 * - `{ type: "echo", data, ts }`
 * - `{ type: "new_thread", thread_id }`
 * - `{ type: "message_ack", temp_id, message_id, thread_id }`
 * - `{ type: "new_message", id, thread_id, sender_id, content, image_urls, created_at, extra_data? }`
 * - `{ type: "messages_seen", thread_id, seen_by }`
 * - `{ type: "notification", payload: {...} }`
 *
 * @version 1.0.0
 * @license MIT
 */

const pool = require("../db/mysql");
const { createNotification } = require("../utils/notifications");
const { connectedUsers } = require("./userState");

/**
 * Safely send a JSON-serializable object to a WebSocket client.
 * Silently no-ops on closed sockets; catches serialization/send errors.
 *
 * @param {import("ws").WebSocket} ws - Target WebSocket.
 * @param {any} obj - JSON-serializable payload.
 * @returns {void}
 */
function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

/**
 * Returns navigation counters for a user:
 * - unread notifications count
 * - unread direct messages count
 *
 * @param {number|string} userId - User ID (coerced to integer).
 * @returns {Promise<{notifications:number, messages:number}>}
 */
async function getNavCounts(userId) {
  const uid = parseInt(userId, 10);
  if (!uid) return { notifications: 0, messages: 0 };

  const [notifs] = await pool.query(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = FALSE`,
    [uid]
  );
  const notifCount = notifs?.[0]?.c || 0;

  const [msgs] = await pool.query(
    `SELECT COUNT(*) AS unread
       FROM chat_messages m
       JOIN chat_threads t ON m.thread_id = t.id
       WHERE
         ((t.user1_id = ? AND m.sender_id = t.user2_id)
          OR (t.user2_id = ? AND m.sender_id = t.user1_id))
         AND m.seen = FALSE`,
    [uid, uid]
  );
  const msgCount = msgs?.[0]?.unread || 0;

  return { notifications: notifCount, messages: msgCount };
}

/**
 * Ensures a stable 1:1 chat thread for a sender/receiver pair.
 * Returns the existing thread id or creates one deterministically (min/max ordering).
 *
 * @param {number} sender_id
 * @param {number} receiver_id
 * @returns {Promise<number>} thread_id
 */
async function ensureThreadId(sender_id, receiver_id) {
  const a = Math.min(sender_id, receiver_id);
  const b = Math.max(sender_id, receiver_id);
  const [rows] = await pool.query(
    `SELECT id FROM chat_threads WHERE user1_id = ? AND user2_id = ? LIMIT 1`,
    [a, b]
  );
  if (rows.length) return rows[0].id;
  const [ins] = await pool.query(
    `INSERT INTO chat_threads (user1_id, user2_id) VALUES (?, ?)`,
    [a, b]
  );
  return ins.insertId;
}

/**
 * WebSocket gateway factory. Attaches connection handlers to a `ws` server instance.
 *
 * @param {import("ws").Server} wss - WebSocket server.
 * @returns {void}
 */
module.exports = function (wss) {
  // --- Heartbeat / liveness ---
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, 30_000);
  wss.on("close", () => clearInterval(heartbeat));

  // --- Connection lifecycle ---
  wss.on("connection", function (ws) {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", async function (message) {
      try {
        const data = JSON.parse(message);

        // ---- Auth handshake ----
        if (data.type === "auth") {
          ws.user_id = String(data.user_id);
          connectedUsers.set(ws.user_id, ws);

          safeSend(ws, {
            type: "auth_ok",
            user_id: ws.user_id,
            ts: Date.now(),
          });

          const counts = await getNavCounts(ws.user_id);
          safeSend(ws, { type: "nav_counts", payload: counts });

          // Presence broadcast (others see user online)
          wss.clients.forEach((client) => {
            if (client.readyState === 1 && client !== ws) {
              safeSend(client, { type: "user_online", user_id: ws.user_id });
            }
          });
          return;
        }

        // ---- Echo (diagnostic) ----
        if (data.type === "echo") {
          safeSend(ws, {
            type: "echo",
            data: data.data || null,
            ts: Date.now(),
          });
          return;
        }

        // ---- Ask fresh nav counts ----
        if (data.type === "nav_counts") {
          if (!ws.user_id) return;
          try {
            const counts = await getNavCounts(ws.user_id);
            safeSend(ws, { type: "nav_counts", payload: counts });
          } catch {}
          return;
        }

        // ---- Who is online ----
        if (data.type === "who_is_online") {
          const online = Array.from(connectedUsers.keys());
          safeSend(ws, { type: "online_users", users: online });
          return;
        }

        // ---- Channel subscriptions (reserved) ----
        if (data.type === "subscribe") {
          ws.subscriptions = Array.isArray(data.channels) ? data.channels : [];
          safeSend(ws, { type: "subscribed", channels: ws.subscriptions });
          return;
        }

        // ---- Typing indicator ----
        if (data.type === "typing") {
          const { from, to } = data;
          const target = connectedUsers.get(String(to));
          safeSend(target, { type: "typing", from });
          return;
        }

        // ---- Mark messages as seen in a thread ----
        if (data.type === "message_seen") {
          const { thread_id, user_id } = data;
          if (!thread_id || !user_id) return;

          await pool.query(
            `UPDATE chat_messages SET seen = 1 WHERE thread_id = ? AND sender_id != ? AND seen = 0`,
            [thread_id, user_id]
          );

          const [[row]] = await pool.query(
            `SELECT user1_id, user2_id FROM chat_threads WHERE id = ? LIMIT 1`,
            [thread_id]
          );
          if (row) {
            const other =
              user_id === row.user1_id ? row.user2_id : row.user1_id;
            const target = connectedUsers.get(String(other));
            safeSend(target, {
              type: "messages_seen",
              thread_id,
              seen_by: user_id,
            });
          }
          return;
        }

        // ---- Send message (text/images/optional product) ----
        if (data.type === "message_send" || data.type === "message") {
          const {
            sender_id,
            receiver_id,
            content = "",
            image_urls = [],
            temp_id = null,
            extra_data = null,
          } = data;

          let { thread_id } = data;

          // Minimal payload validation
          if (
            !sender_id ||
            (!content && (!image_urls || image_urls.length === 0))
          )
            return;

          // Create/find thread if not specified
          if (!thread_id && receiver_id) {
            thread_id = await ensureThreadId(sender_id, receiver_id);
            safeSend(ws, { type: "new_thread", thread_id });
          }
          if (!thread_id) return;

          // Optional product context
          const productId = extra_data?.product_id ?? null;

          // Persist message
          const [result] = await pool.query(
            `INSERT INTO chat_messages (thread_id, sender_id, content, image_urls, product_id)
             VALUES (?, ?, ?, ?, ?)`,
            [
              thread_id,
              sender_id,
              content,
              JSON.stringify(image_urls || []),
              productId,
            ]
          );

          const insertedId = result.insertId;
          const payload = {
            type: "new_message",
            id: insertedId,
            thread_id,
            sender_id,
            content,
            image_urls,
            created_at: new Date().toISOString(),
            ...(productId ? { extra_data: { product_id: productId } } : {}),
          };

          // Client-side optimistic ACK
          if (temp_id) {
            safeSend(ws, {
              type: "message_ack",
              temp_id,
              message_id: insertedId,
              thread_id,
            });
          }

          // Echo back to sender
          safeSend(ws, payload);

          // Deliver to receiver if online + side effects
          const [[row]] = await pool.query(
            `SELECT user1_id, user2_id FROM chat_threads WHERE id = ? LIMIT 1`,
            [thread_id]
          );
          if (row) {
            const other =
              sender_id === row.user1_id ? row.user2_id : row.user1_id;
            const receiverWS = connectedUsers.get(String(other));

            // Persist notification (fallback to pull channels)
            await createNotification({
              user_id: other,
              title: "New message",
              body: "You have received a message.",
              type: "chat",
              related_id: thread_id,
            });

            // Push live message to receiver
            safeSend(receiverWS, payload);

            // Stop typing hint
            safeSend(receiverWS, { type: "stop_typing", from: sender_id });

            // In-app notification event for receiver UI
            safeSend(receiverWS, {
              type: "notification",
              payload: {
                recipient_id: other,
                title: "New Message",
                body: "You’ve got a new message.",
                type: "chat",
                related_id: thread_id,
                created_at: new Date().toISOString(),
              },
            });

            // Refresh receiver counters
            try {
              const counts = await getNavCounts(other);
              safeSend(receiverWS, { type: "nav_counts", payload: counts });
            } catch {}
          }
          return;
        }
      } catch (err) {
        console.error("❌ WebSocket error:", err.message);
      }
    });

    // ---- Disconnect / presence ----
    ws.on("close", function () {
      if (ws.user_id) {
        connectedUsers.delete(ws.user_id);
        wss.clients.forEach((client) => {
          if (client.readyState === 1 && client !== ws) {
            safeSend(client, { type: "user_offline", user_id: ws.user_id });
          }
        });
      }
    });
  });
};
