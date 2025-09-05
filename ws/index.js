const pool = require("../db/mysql");
const LIKE_TABLE = process.env.NODE_LIKES_TABLE || "node_product_likes";

async function getLikesCount(productId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM ${LIKE_TABLE} WHERE product_id=?`,
    [productId]
  );
  return Number(rows?.[0]?.cnt || 0);
}

module.exports = (wss) => {
  // Heartbeat (keep-alive + cleanup)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_) {}
    }
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.subscribedProducts = new Set();

    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore non-JSON
      }

      const type = msg?.type;
      const id = Number(msg?.product_id); // ✅ normalise toujours en Number

      // Optionnel: répondre aux pings "app-level" du client
      if (type === "ping") {
        safeSend(ws, { type: "pong", t: msg?.t || Date.now() });
        return;
      }

      // Subscribe
      if (type === "like:subscribe" && Number.isInteger(id)) {
        ws.subscribedProducts.add(id);
        safeSend(ws, { type: "like:subscribed", product_id: id });

        // push immédiat du compteur actuel
        try {
          const count = await getLikesCount(id);
          safeSend(ws, {
            type: "like:update",
            product_id: id,
            likes_count: count,
          });
        } catch {
          // silencieux
        }
        return;
      }

      // Unsubscribe
      if (type === "like:unsubscribe" && Number.isInteger(id)) {
        ws.subscribedProducts.delete(id);
        safeSend(ws, { type: "like:unsubscribed", product_id: id });
        return;
      }
    });

    ws.on("error", () => {});
  });
};

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {}
}
