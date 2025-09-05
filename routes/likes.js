const express = require("express");
const pool = require("../db/mysql");
const { authRequired } = require("../utils/auth-phpjwt");

const LIKE_TABLE = process.env.NODE_LIKES_TABLE || "node_product_likes";

module.exports = function createLikesRouter(wss) {
  const router = express.Router();

  // --- Broadcast temps réel (normalise l'ID) ---
  function broadcastLikeUpdate(productId, likesCount) {
    if (!wss) return;
    const pid = Number(productId);

    const payload = JSON.stringify({
      type: "like:update",
      product_id: pid, // ✅ toujours un Number côté payload
      likes_count: likesCount,
    });

    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      const subs = ws.subscribedProducts;
      // ✅ compat Number / String (au cas où un ancien client ait stocké "123")
      if (subs?.has(pid) || subs?.has(String(pid))) {
        try {
          ws.send(payload);
        } catch (_) {}
      }
    }
  }

  // --- Helper compteur ---
  async function getLikesCount(productId, connOrPool = pool) {
    const [rows] = await connOrPool.query(
      `SELECT COUNT(*) AS cnt FROM ${LIKE_TABLE} WHERE product_id=?`,
      [productId]
    );
    return Number(rows?.[0]?.cnt || 0);
  }

  /** Toggle like */
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

      // 🔴 push temps réel
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

  /** Compteur d’un produit */
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

  /** Compteurs en batch: GET /api/products/likes?ids=1,2,3 */
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

      // ✅ base: tous à 0
      const map = Object.fromEntries(ids.map((id) => [id, 0]));
      // ✅ écrase avec les résultats réels
      for (const r of rows) {
        map[r.product_id] = Number(r.cnt || 0);
      }

      res.json({ counts: map });
    } catch (err) {
      console.error("likes.batch error:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  /** Mes likes (IDs) */
  router.get("/me/likes", authRequired, async (req, res) => {
    const userId = Number(req?.user?.id);
    // console.log("[me/likes] userId:", userId);
    try {
      const [rows] = await pool.query(
        `SELECT product_id FROM ${LIKE_TABLE} WHERE user_id=? ORDER BY created_at DESC`,
        [userId]
      );
      // console.log("[me/likes] rows:", rows);
      res.json({ user_id: userId, product_ids: rows.map((r) => r.product_id) });
    } catch (err) {
      console.error("likes.mine error:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  return router;
};
