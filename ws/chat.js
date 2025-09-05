const pool = require("../db/mysql");
const { createNotification } = require("../utils/notifications");
const { connectedUsers } = require("./userState");

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

// ⭐ NEW: util pour compter les non-lus (notif + messages)
async function getNavCounts(userId) {
  const uid = parseInt(userId, 10);
  if (!uid) return { notifications: 0, messages: 0 };

  // notifications non lues
  const [notifs] = await pool.query(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = FALSE`,
    [uid]
  );
  const notifCount = notifs?.[0]?.c || 0;

  // messages non lus (même logique que ta route /api/messages/unread/:userId)
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

module.exports = function (wss) {
  // Heartbeat
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

  wss.on("connection", function (ws) {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", async function (message) {
      try {
        const data = JSON.parse(message);

        // --- auth ---
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

          // broadcast présence
          wss.clients.forEach((client) => {
            if (client.readyState === 1 && client !== ws) {
              safeSend(client, { type: "user_online", user_id: ws.user_id });
            }
          });
          return;
        }

        // ⭐ NEW: echo (debug)
        if (data.type === "echo") {
          safeSend(ws, {
            type: "echo",
            data: data.data || null,
            ts: Date.now(),
          });
          return;
        }

        // ⭐ NEW: snapshot via requête
        if (data.type === "nav_counts") {
          if (!ws.user_id) return;
          try {
            const counts = await getNavCounts(ws.user_id);
            safeSend(ws, { type: "nav_counts", payload: counts });
          } catch {}
          return;
        }

        // ⭐ NEW: who_is_online
        if (data.type === "who_is_online") {
          const online = Array.from(connectedUsers.keys());
          safeSend(ws, { type: "online_users", users: online });
          return;
        }

        // ⭐ NEW: subscribe (si tu souhaites gérer des canaux plus tard)
        if (data.type === "subscribe") {
          ws.subscriptions = Array.isArray(data.channels) ? data.channels : [];
          safeSend(ws, { type: "subscribed", channels: ws.subscriptions });
          return;
        }

        // --- typing ---
        if (data.type === "typing") {
          const { from, to } = data;
          const target = connectedUsers.get(String(to));
          safeSend(target, { type: "typing", from });
          return;
        }

        // --- seen ---
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

        // --- send message ---
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

          if (
            !sender_id ||
            (!content && (!image_urls || image_urls.length === 0))
          )
            return;

          if (!thread_id && receiver_id) {
            thread_id = await ensureThreadId(sender_id, receiver_id);
            safeSend(ws, { type: "new_thread", thread_id });
          }
          if (!thread_id) return;

          const productId = extra_data?.product_id ?? null;

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

          // ACK côté émetteur si temp_id fourni
          if (temp_id) {
            safeSend(ws, {
              type: "message_ack",
              temp_id,
              message_id: insertedId,
              thread_id,
            });
          }

          // renvoie au sender (normaliser l’affichage)
          safeSend(ws, payload);

          // diffuser au destinataire + notifs
          const [[row]] = await pool.query(
            `SELECT user1_id, user2_id FROM chat_threads WHERE id = ? LIMIT 1`,
            [thread_id]
          );
          if (row) {
            const other =
              sender_id === row.user1_id ? row.user2_id : row.user1_id;
            const receiverWS = connectedUsers.get(String(other));

            await createNotification({
              user_id: other,
              title: "New message",
              body: "You have received a message.",
              type: "chat",
              related_id: thread_id,
            });

            // message pour le destinataire
            safeSend(receiverWS, payload);

            // typing stop
            safeSend(receiverWS, { type: "stop_typing", from: sender_id });

            // ⭐ NEW: notification avec recipient_id (utile pour filtrer côté client)
            safeSend(receiverWS, {
              type: "notification",
              payload: {
                recipient_id: other, // <— AJOUT
                title: "New Message",
                body: "You’ve got a new message.",
                type: "chat",
                related_id: thread_id,
                created_at: new Date().toISOString(),
              },
            });

            // ⭐ NEW: on peut pousser un snapshot frais des compteurs
            try {
              const counts = await getNavCounts(other);
              safeSend(receiverWS, { type: "nav_counts", payload: counts });
            } catch {}
          }
          return;
        }
      } catch (err) {
        console.error("❌ Erreur WebSocket :", err.message);
      }
    });

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
