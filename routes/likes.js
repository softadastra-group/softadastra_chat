/**
 * @file routes/likes.js
 * @description
 * API routes for managing product likes within the **Softadastra Marketplace**.
 * Provides endpoints for liking/unliking products, retrieving like counts,
 * and broadcasting live updates to WebSocket clients subscribed to product channels.
 *
 * ## Responsibilities
 * - Toggle likes (insert/delete) for authenticated users.
 * - Retrieve like counts for single or multiple products.
 * - Return all liked product IDs for the current user.
 * - Broadcast **real-time like count updates** through WebSocket (wss).
 *
 * ## WebSocket Broadcast
 * Each like/unlike triggers a message broadcast to all connected clients:
 * ```json
 * {
 *   "type": "like:update",
 *   "product_id": 42,
 *   "likes_count": 17
 * }
 * ```
 *
 * ## Database Schema (simplified)
 * - **node_product_likes**
 *   - `id` INT AUTO_INCREMENT
 *   - `product_id` INT
 *   - `user_id` INT
 *   - `created_at` DATETIME
 *   - `UNIQUE (product_id, user_id)`
 *
 * ## Security
 * - Routes modifying likes are protected by `authRequired` (JWT).
 * - Public routes allow read-only access to like counts.
 *
 * @module routes/likes
 * @see db/mysql.js — MySQL connection pool
 * @see utils/auth-phpjwt.js — JWT authentication middleware
 * @see utils/ws-ticket.js — WebSocket ticket utilities
 */
const express = require("express");
const pool = require("../db/mysql");
const { authRequired } = require("../utils/auth-phpjwt");

const LIKE_TABLE = process.env.NODE_LIKES_TABLE || "node_product_likes";

module.exports = function createLikesRouter(wss) {
  const router = express.Router();

  function broadcastLikeUpdate(productId, likesCount) {
    if (!wss) return;
    const pid = Number(productId);

    const payload = JSON.stringify({
      type: "like:update",
      product_id: pid,
      likes_count: likesCount,
    });

    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      const subs = ws.subscribedProducts;
      if (subs?.has(pid) || subs?.has(String(pid))) {
        try {
          ws.send(payload);
        } catch (_) {}
      }
    }
  }

  async function getLikesCount(productId, connOrPool = pool) {
    const [rows] = await connOrPool.query(
      `SELECT COUNT(*) AS cnt FROM ${LIKE_TABLE} WHERE product_id=?`,
      [productId]
    );
    return Number(rows?.[0]?.cnt || 0);
  }

  /**
   * @route POST /api/products/:productId/like
   * @summary Toggles the like status for a product by the current authenticated user.
   * @security JWT (authRequired)
   * @param {number} req.params.productId - Product ID to like or unlike.
   * @returns {object} 200 - JSON `{ success, product_id, is_liked, likes_count }`
   * @returns {object} 400 - `{ error: "ID produit invalide" }` if productId is invalid.
   * @returns {object} 500 - `{ error: "Erreur serveur" }` on database or transaction error.
   * @example
   * // Like or unlike a product
   * fetch("/api/products/42/like", {
   *   method: "POST",
   *   headers: { Authorization: `Bearer ${token}` }
   * }).then(r => r.json());
   */
  router.post("/products/:productId/like", authRequired, async (req, res) => {
    const userId = Number(req?.user?.id);
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: "ID produit invalide" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(
        `SELECT 1 FROM ${LIKE_TABLE} WHERE product_id=? AND user_id=? LIMIT 1`,
        [productId, userId]
      );

      let isLiked;
      if (exists.length) {
        await conn.query(
          `DELETE FROM ${LIKE_TABLE} WHERE product_id=? AND user_id=?`,
          [productId, userId]
        );
        isLiked = false;
      } else {
        await conn.query(
          `INSERT INTO ${LIKE_TABLE} (product_id, user_id) VALUES (?, ?)`,
          [productId, userId]
        );
        isLiked = true;
      }

      const likesCount = await getLikesCount(productId, conn);
      await conn.commit();

      broadcastLikeUpdate(productId, likesCount);

      return res.json({
        success: true,
        product_id: productId,
        is_liked: isLiked,
        likes_count: likesCount,
      });
    } catch (err) {
      await conn.rollback();
      console.error("likes.toggle error:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    } finally {
      conn.release();
    }
  });

  /**
   * @route GET /api/products/:productId/likes
   * @summary Retrieves the current like count for a given product.
   * @param {number} req.params.productId - Product ID.
   * @returns {object} 200 - `{ product_id, likes_count }`
   * @returns {object} 400 - `{ error: "ID produit invalide" }` if invalid ID.
   * @returns {object} 500 - `{ error: "Erreur serveur" }` on failure.
   * @example
   * fetch("/api/products/42/likes").then(r => r.json());
   */
  router.get("/products/:productId/likes", async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ error: "ID produit invalide" });
    }
    try {
      const likesCount = await getLikesCount(productId);
      res.json({ product_id: productId, likes_count: likesCount });
    } catch (err) {
      console.error("likes.count error:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  /**
   * @route GET /api/products/likes?ids=1,2,3
   * @summary Retrieves like counts for multiple product IDs in one request.
   * @param {string} req.query.ids - Comma-separated list of product IDs.
   * @returns {object} 200 - `{ counts: { [product_id]: likes_count } }`
   * @example
   * fetch("/api/products/likes?ids=1,2,3").then(r => r.json());
   */
  router.get("/products/likes", async (req, res) => {
    const ids = (req.query.ids || "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n));

    if (!ids.length) return res.json({ counts: {} });

    try {
      const placeholders = ids.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT product_id, COUNT(*) AS cnt
         FROM ${LIKE_TABLE}
         WHERE product_id IN (${placeholders})
         GROUP BY product_id`,
        ids
      );

      const map = Object.fromEntries(ids.map((id) => [id, 0]));
      for (const r of rows) {
        map[r.product_id] = Number(r.cnt || 0);
      }

      res.json({ counts: map });
    } catch (err) {
      console.error("likes.batch error:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  /**
   * @route GET /api/me/likes
   * @summary Returns all product IDs liked by the current authenticated user.
   * @security JWT (authRequired)
   * @returns {object} 200 - `{ user_id, product_ids: number[] }`
   * @returns {object} 500 - `{ error: "Erreur serveur" }` on query failure.
   * @example
   * fetch("/api/me/likes", {
   *   headers: { Authorization: `Bearer ${token}` }
   * }).then(r => r.json());
   */
  router.get("/me/likes", authRequired, async (req, res) => {
    const userId = Number(req?.user?.id);
    try {
      const [rows] = await pool.query(
        `SELECT product_id FROM ${LIKE_TABLE} WHERE user_id=? ORDER BY created_at DESC`,
        [userId]
      );
      res.json({ user_id: userId, product_ids: rows.map((r) => r.product_id) });
    } catch (err) {
      console.error("likes.mine error:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  return router;
};
