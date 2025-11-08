/**
 * @file ws/index.js
 * @description
 * Lightweight WebSocket gateway for real-time product like counts on the
 * Softadastra platform. Clients can subscribe to product IDs and receive
 * live updates of their aggregate like counts.
 *
 * ## Responsibilities
 * - Maintain client liveness via ping/pong heartbeat.
 * - Allow clients to **subscribe/unsubscribe** to product like streams.
 * - Push the latest like counts on subscription and on demand.
 *
 * ## Environment Variables
 * - `NODE_LIKES_TABLE` — MySQL table name for product likes
 *   (default: `"node_product_likes"`).
 *
 * ## Inbound WS Messages
 * - `{ type: "ping", t?: number }`
 * - `{ type: "like:subscribe", product_id: number }`
 * - `{ type: "like:unsubscribe", product_id: number }`
 *
 * ## Outbound WS Messages
 * - `{ type: "pong", t: number }`
 * - `{ type: "like:subscribed", product_id }`
 * - `{ type: "like:unsubscribed", product_id }`
 * - `{ type: "like:update", product_id, likes_count }`
 *
 * @version 1.0.0
 * @license MIT
 */

const pool = require("../db/mysql");

/**
 * Table name to query for product likes.
 * @type {string}
 */
const LIKE_TABLE = process.env.NODE_LIKES_TABLE || "node_product_likes";

/**
 * Retrieves the aggregate number of likes for a given product.
 *
 * @async
 * @param {number} productId - The product ID to query.
 * @returns {Promise<number>} Total like count for the product.
 */
async function getLikesCount(productId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM ${LIKE_TABLE} WHERE product_id=?`,
    [productId]
  );
  return Number(rows?.[0]?.cnt || 0);
}

/**
 * WebSocket gateway factory. Attaches connection handlers to the provided
 * `ws` server instance and manages subscription-based like updates.
 *
 * @param {import("ws").Server} wss - WebSocket server instance.
 * @returns {void}
 */
module.exports = (wss) => {
  // ---- Heartbeat / liveness (30s) ----
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

  // ---- Connection lifecycle ----
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.subscribedProducts = new Set();

    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      const type = msg?.type;
      const id = Number(msg?.product_id);

      // Keep-alive
      if (type === "ping") {
        safeSend(ws, { type: "pong", t: msg?.t || Date.now() });
        return;
      }

      // Subscribe to a product like stream
      if (type === "like:subscribe" && Number.isInteger(id)) {
        ws.subscribedProducts.add(id);
        safeSend(ws, { type: "like:subscribed", product_id: id });

        // Send immediate snapshot
        try {
          const count = await getLikesCount(id);
          safeSend(ws, {
            type: "like:update",
            product_id: id,
            likes_count: count,
          });
        } catch {}
        return;
      }

      // Unsubscribe from a product like stream
      if (type === "like:unsubscribe" && Number.isInteger(id)) {
        ws.subscribedProducts.delete(id);
        safeSend(ws, { type: "like:unsubscribed", product_id: id });
        return;
      }
    });

    ws.on("error", () => {});
  });
};

/**
 * Safely sends a JSON-serializable payload to a WebSocket client.
 * Silently returns if the socket is not open or if serialization fails.
 *
 * @param {import("ws").WebSocket} ws - Target WebSocket.
 * @param {any} obj - JSON-serializable payload.
 * @returns {void}
 */
function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {}
}
