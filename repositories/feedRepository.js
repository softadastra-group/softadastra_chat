// repositories/feedRepository.js
// Usage: const FeedRepo = require('./repositories/feedRepository')(db);
//        const repo = new FeedRepo();

const path = require("path");
function guessMimeFromUrl(url) {
  const ext = (path.extname(String(url)).toLowerCase() || "").replace(".", "");
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/jpeg"; // fallback
}

module.exports = (db) => {
  class FeedRepository {
    /**
     * Crée un post TEXTE SEUL (body non vide, aucune image).
     */
    async createTextPost({
      userId,
      body,
      visibility = "public",
      replyToId = null,
    }) {
      if (!userId || !body || typeof body !== "string" || !body.trim()) {
        throw new Error("Invalid text post payload");
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        const [res] = await conn.execute(
          `INSERT INTO feed_posts (user_id, body, visibility, reply_to_id, media_count)
           VALUES (:user_id, :body, :visibility, :reply_to_id, 0)`,
          { user_id: userId, body, visibility, reply_to_id: replyToId }
        );

        // Si replyTo => incrément du compteur de réponses
        if (replyToId) {
          await conn.execute(
            `UPDATE feed_posts SET replies_count = replies_count + 1 WHERE id = :id`,
            { id: replyToId }
          );
        }

        await conn.commit();
        return { id: res.insertId };
      } catch (e) {
        try {
          await conn.rollback();
        } catch {}
        throw e;
      } finally {
        conn.release();
      }
    }

    /**
     * Crée un post PHOTO (1..N images) avec texte optionnel.
     */
    async createPhotoPost({
      userId,
      imageUrls = [],
      visibility = "public",
      replyToId = null,
      sizes = [],
      body = null, // ✅ nouveau: texte optionnel
    }) {
      // sizes optionnel: [{width, height, mime_type}] aligné sur imageUrls
      const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
      if (!userId || urls.length === 0) {
        throw new Error("Invalid photo post payload");
      }

      // Normalise le texte (conserve null si vide)
      const text = typeof body === "string" && body.trim() ? body.trim() : null;

      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        const [res] = await conn.execute(
          `INSERT INTO feed_posts (user_id, body, visibility, reply_to_id, media_count)
       VALUES (:user_id, :body, :visibility, :reply_to_id, :mc)`,
          {
            user_id: userId,
            body: text, // ✅ enregistre le texte si présent
            visibility,
            reply_to_id: replyToId,
            mc: urls.length,
          }
        );
        const postId = res.insertId;

        // Insert media en masse (position = index+1)
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          const meta = Array.isArray(sizes) && sizes[i] ? sizes[i] : {};
          await conn.execute(
            `INSERT INTO feed_post_media (post_id, url, mime_type, position, width, height)
         VALUES (:post_id, :url, :mime_type, :position, :width, :height)`,
            {
              post_id: postId,
              url,
              mime_type: meta.mime_type || guessMimeFromUrl(url),
              position: i + 1,
              width: meta.width || null,
              height: meta.height || null,
            }
          );
        }

        // Si replyTo => incrément du compteur de réponses
        if (replyToId) {
          await conn.execute(
            `UPDATE feed_posts SET replies_count = replies_count + 1 WHERE id = :id`,
            { id: replyToId }
          );
        }

        await conn.commit();
        return { id: postId };
      } catch (e) {
        try {
          await conn.rollback();
        } catch {}
        throw e;
      } finally {
        conn.release();
      }
    }

    /**
     * Récupère un post + médias.
     */
    async getPostById(id) {
      const [rows] = await db.execute(
        `SELECT p.*
         FROM feed_posts p
         WHERE p.id = :id AND p.is_deleted = 0`,
        { id }
      );
      if (!rows.length) return null;

      const post = rows[0];
      const [media] = await db.execute(
        `SELECT id, url, mime_type, position, width, height
         FROM feed_post_media
         WHERE post_id = :pid
         ORDER BY position ASC, id ASC`,
        { pid: id }
      );
      post.media = media;
      return post;
    }

    /**
     * Liste le feed (public) avec pagination simple.
     * Supports:
     *  - userId: filtre par auteur
     *  - maxId: pagination descendante (<= maxId)
     *  - sinceId: nouveautés (> sinceId)
     */
    async listFeed({
      userId = null,
      maxId = null,
      sinceId = null,
      limit = 20,
    }) {
      // borne & cast
      limit = Number.isFinite(+limit) ? Math.min(Math.max(+limit, 1), 50) : 20;

      const where = [`p.is_deleted = 0`, `p.visibility = 'public'`];
      const params = {};

      if (Number.isFinite(+userId)) {
        where.push(`p.user_id = :user_id`);
        params.user_id = +userId;
      }
      if (Number.isFinite(+maxId)) {
        where.push(`p.id <= :max_id`);
        params.max_id = +maxId;
      }
      if (Number.isFinite(+sinceId)) {
        where.push(`p.id > :since_id`);
        params.since_id = +sinceId;
      }

      // ⚠️ pas de placeholder pour LIMIT
      const sql = `
    SELECT p.*
    FROM feed_posts p
    WHERE ${where.join(" AND ")}
    ORDER BY p.id DESC
    LIMIT ${limit}
  `;

      const [rows] = await db.execute(sql, params);
      if (!rows.length) return [];

      const ids = rows.map((r) => r.id);
      const [medias] = await db.query(
        `SELECT m.*
     FROM feed_post_media m
     WHERE m.post_id IN (${ids.map(() => "?").join(",")})
     ORDER BY m.post_id ASC, m.position ASC, m.id ASC`,
        ids
      );

      const mediaMap = new Map();
      for (const m of medias) {
        if (!mediaMap.has(m.post_id)) mediaMap.set(m.post_id, []);
        mediaMap.get(m.post_id).push(m);
      }
      return rows.map((r) => ({ ...r, media: mediaMap.get(r.id) || [] }));
    }

    /**
     * Like/unlike (avec mise à jour du compteur).
     */
    async likePost({ postId, userId }) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        // INSERT IGNORE (idempotent)
        await conn.execute(
          `INSERT IGNORE INTO feed_post_likes (post_id, user_id)
           VALUES (:post_id, :user_id)`,
          { post_id: postId, user_id: userId }
        );

        // Recalcule léger (ou +1 si affectedRows===1)
        const [cntRows] = await conn.execute(
          `SELECT COUNT(*) AS c FROM feed_post_likes WHERE post_id = :id`,
          { id: postId }
        );
        const c = Number(cntRows[0]?.c || 0);
        await conn.execute(
          `UPDATE feed_posts SET likes_count = :c WHERE id = :id`,
          { c, id: postId }
        );

        await conn.commit();
        return { likes_count: c };
      } catch (e) {
        try {
          await conn.rollback();
        } catch {}
        throw e;
      } finally {
        conn.release();
      }
    }

    async unlikePost({ postId, userId }) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        await conn.execute(
          `DELETE FROM feed_post_likes
           WHERE post_id = :post_id AND user_id = :user_id`,
          { post_id: postId, user_id: userId }
        );

        const [cntRows] = await conn.execute(
          `SELECT COUNT(*) AS c FROM feed_post_likes WHERE post_id = :id`,
          { id: postId }
        );
        const c = Number(cntRows[0]?.c || 0);
        await conn.execute(
          `UPDATE feed_posts SET likes_count = :c WHERE id = :id`,
          { c, id: postId }
        );

        await conn.commit();
        return { likes_count: c };
      } catch (e) {
        try {
          await conn.rollback();
        } catch {}
        throw e;
      } finally {
        conn.release();
      }
    }

    /**
     * Suppression logique (soft delete). Les médias restent pour l’instant.
     * (Si tu veux purge totale: faire DELETE CASCADE + suppression du post)
     */
    // repositories/feedRepository.js
    async softDelete({ postId, userId }) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        // 1) Lock le post ciblé
        const [rows] = await conn.execute(
          `SELECT id, user_id, reply_to_id, is_deleted
       FROM feed_posts
       WHERE id = :id
       FOR UPDATE`,
          { id: postId }
        );
        if (!rows.length) {
          await conn.rollback();
          return { affected: 0 };
        }
        const row = rows[0];

        // 2) Autorisation + déjà supprimé ?
        if (row.user_id !== userId || row.is_deleted) {
          await conn.rollback();
          return { affected: 0 };
        }

        // 3) Soft delete
        const [res] = await conn.execute(
          `UPDATE feed_posts
       SET is_deleted = 1
       WHERE id = :id AND is_deleted = 0`,
          { id: postId }
        );

        // 4) Si c'était une reply → décrémente le parent (borné à 0)
        if (res.affectedRows && row.reply_to_id) {
          await conn.execute(
            `UPDATE feed_posts
         SET replies_count = IF(replies_count > 0, replies_count - 1, 0)
         WHERE id = :pid`,
            { pid: row.reply_to_id }
          );
        }

        await conn.commit();
        return {
          affected: res.affectedRows || 0,
          parent_id: row.reply_to_id || null, // bonus (optionnel)
        };
      } catch (e) {
        try {
          await conn.rollback();
        } catch {}
        throw e;
      } finally {
        conn.release();
      }
    }

    /**
     * Crée une reply TEXTE SEULE vers un parent (post ou reply).
     */
    async createTextReply({ userId, parentId, body, visibility = "public" }) {
      if (!parentId) throw new Error("parentId is required");
      // réutilise la logique text-only + incrément replies_count géré par replyToId
      return this.createTextPost({
        userId,
        body,
        visibility,
        replyToId: parentId,
      });
    }

    /**
     * Crée une reply PHOTO SEULE vers un parent (post ou reply).
     */
    async createPhotoReply({
      userId,
      parentId,
      imageUrls = [],
      visibility = "public",
      sizes = [],
    }) {
      if (!parentId) throw new Error("parentId is required");
      return this.createPhotoPost({
        userId,
        imageUrls,
        visibility,
        replyToId: parentId,
        sizes,
      });
    }

    /**
     * Liste les replies d'un parent (ordre décroissant par id).
     * Pagination: maxId (<=), sinceId (>), limit.
     */
    async listReplies({ parentId, maxId = null, sinceId = null, limit = 20 }) {
      if (!Number.isFinite(+parentId) || +parentId <= 0) return [];
      limit = Number.isFinite(+limit) ? Math.min(Math.max(+limit, 1), 50) : 20;

      const where = [`p.is_deleted = 0`, `p.reply_to_id = :pid`];
      const params = { pid: +parentId };

      if (Number.isFinite(+maxId)) {
        where.push(`p.id <= :max_id`);
        params.max_id = +maxId;
      }
      if (Number.isFinite(+sinceId)) {
        where.push(`p.id > :since_id`);
        params.since_id = +sinceId;
      }

      // ⚠️ pas de placeholder pour LIMIT
      const sql = `
    SELECT p.*
    FROM feed_posts p
    WHERE ${where.join(" AND ")}
    ORDER BY p.id DESC
    LIMIT ${limit}
  `;

      const [rows] = await db.execute(sql, params);
      if (!rows.length) return [];

      const ids = rows.map((r) => r.id);
      const [medias] = await db.query(
        `SELECT m.*
     FROM feed_post_media m
     WHERE m.post_id IN (${ids.map(() => "?").join(",")})
     ORDER BY m.post_id ASC, m.position ASC, m.id ASC`,
        ids
      );

      const mediaMap = new Map();
      for (const m of medias) {
        if (!mediaMap.has(m.post_id)) mediaMap.set(m.post_id, []);
        mediaMap.get(m.post_id).push(m);
      }
      return rows.map((r) => ({ ...r, media: mediaMap.get(r.id) || [] }));
    }
  }

  return FeedRepository;
};
