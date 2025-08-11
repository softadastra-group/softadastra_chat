const express = require("express");
const pool = require("../db/mysql"); // ← ton pool MySQL2/promise existant
const { authRequired } = require("../utils/auth-phpjwt"); // middleware JWT

module.exports = function createLikesRouter(wss) {
  const router = express.Router();

  // Broadcast à tous les clients abonnés au produit
  function broadcastLikeUpdate(productId, likesCount) {
    if (!wss) return;
    const payload = JSON.stringify({
      type: "like:update",
      product_id: productId,
      likes_count: likesCount,
    });

    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      if (ws.subscribedProducts?.has(productId)) {
        try {
          ws.send(payload);
        } catch (_) {}
      }
    }
  }

  /** Toggle like */
  router.post("/products/:productId/like", authRequired, async (req, res) => {
    const userId = parseInt(req.user.id, 10);
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId))
      return res.status(400).json({ error: "ID produit invalide" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [exists] = await conn.query(
        "SELECT 1 FROM product_likes WHERE product_id=? AND user_id=? LIMIT 1",
        [productId, userId]
      );

      let isLiked;
      if (exists.length) {
        await conn.query(
          "DELETE FROM product_likes WHERE product_id=? AND user_id=?",
          [productId, userId]
        );
        isLiked = false;
      } else {
        await conn.query(
          "INSERT INTO product_likes (product_id, user_id) VALUES (?, ?)",
          [productId, userId]
        );
        isLiked = true;
      }

      const [cntRows] = await conn.query(
        "SELECT COUNT(*) AS cnt FROM product_likes WHERE product_id=?",
        [productId]
      );
      const likesCount = Number(cntRows?.[0]?.cnt || 0);

      await conn.commit();

      // 🔔 Temps réel
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

  /** Compteur de likes d’un produit */
  router.get("/products/:productId/likes", async (req, res) => {
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId))
      return res.status(400).json({ error: "ID produit invalide" });

    try {
      const [rows] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM product_likes WHERE product_id=?",
        [productId]
      );
      res.json({
        product_id: productId,
        likes_count: Number(rows?.[0]?.cnt || 0),
      });
    } catch (err) {
      console.error("likes.count error:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  /** Mes likes (IDs) */
  router.get("/me/likes", authRequired, async (req, res) => {
    const userId = parseInt(req.user.id, 10);
    try {
      const [rows] = await pool.query(
        "SELECT product_id FROM product_likes WHERE user_id=? ORDER BY created_at DESC",
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
