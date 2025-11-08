/**
 * @file repositories/feedRepository.js
 * @description
 * Repository layer for managing user-generated posts within the Softadastra
 * social feed system. Handles text and photo posts, replies, likes, and soft
 * deletions, using transactional MySQL operations.
 *
 * ## Responsibilities
 * - Create and manage **text-only** and **photo** posts.
 * - Support **replies**, **likes/unlikes**, and **soft deletes**.
 * - Provide **feed listing** and **reply pagination** with simple filters.
 * - Normalize media metadata (MIME type, dimensions, order).
 *
 * ## Database Schema (simplified)
 * - `feed_posts`
 *   - id, user_id, body, visibility, reply_to_id, media_count,
 *     replies_count, likes_count, is_deleted
 * - `feed_post_media`
 *   - id, post_id, url, mime_type, position, width, height
 * - `feed_post_likes`
 *   - post_id, user_id (unique)
 *
 * ## Methods
 * - `createTextPost({...})` → Insert a text-only post.
 * - `createPhotoPost({...})` → Insert a photo post with 1–N media files.
 * - `getPostById(id)` → Retrieve a post with its media.
 * - `listFeed({...})` → List public posts with pagination.
 * - `likePost({...})` / `unlikePost({...})` → Manage likes and update counters.
 * - `softDelete({...})` → Perform a logical (non-destructive) delete.
 * - `createTextReply({...})` / `createPhotoReply({...})` → Reply to a parent post.
 * - `listReplies({...})` → List replies for a specific post.
 *
 * ## Notes
 * - All methods are **async** and use connection pooling (`db.getConnection()`).
 * - Every write operation uses **explicit transactions** for safety.
 * - Rollbacks are performed automatically in case of errors.
 * - MIME types are inferred from file extensions via `guessMimeFromUrl()`.
 *
 * @example
 * const FeedRepository = require('./repositories/feedRepository')(db);
 * const repo = new FeedRepository();
 * const post = await repo.createTextPost({
 *   userId: 1,
 *   body: "Hello, Softadastra!",
 * });
 *
 * @see db/mysql.js — Database configuration
 * @see feed_post_media — Media metadata table
 */

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
     * Creates a new **text-only** post.
     * This method validates input, inserts the post, and updates the parent
     * post’s reply counter if applicable.
     *
     * @async
     * @param {Object} params - Post creation payload.
     * @param {number} params.userId - The ID of the user creating the post.
     * @param {string} params.body - The textual content of the post.
     * @param {string} [params.visibility="public"] - Post visibility (`public`, `private`, etc.).
     * @param {?number} [params.replyToId=null] - Optional parent post ID for replies.
     * @returns {Promise<{id: number}>} The newly created post ID.
     * @throws {Error} If validation fails or the transaction encounters an error.
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
     * Creates a **photo post** that may include one or more images with
     * optional text content. Automatically registers metadata for each media file.
     *
     * @async
     * @param {Object} params - Post creation payload.
     * @param {number} params.userId - The ID of the user creating the post.
     * @param {string[]} params.imageUrls - Array of image URLs to attach.
     * @param {string} [params.visibility="public"] - Post visibility.
     * @param {?number} [params.replyToId=null] - Optional parent post ID for replies.
     * @param {Array<Object>} [params.sizes=[]] - Optional image metadata (`{width, height, mime_type}`).
     * @param {?string} [params.body=null] - Optional text content for the post.
     * @returns {Promise<{id: number}>} The newly created post ID.
     * @throws {Error} If the payload is invalid or a database error occurs.
     */
    async createPhotoPost({
      userId,
      imageUrls = [],
      visibility = "public",
      replyToId = null,
      sizes = [],
      body = null,
    }) {
      const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
      if (!userId || urls.length === 0) {
        throw new Error("Invalid photo post payload");
      }

      const text = typeof body === "string" && body.trim() ? body.trim() : null;

      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        const [res] = await conn.execute(
          `INSERT INTO feed_posts (user_id, body, visibility, reply_to_id, media_count)
       VALUES (:user_id, :body, :visibility, :reply_to_id, :mc)`,
          {
            user_id: userId,
            body: text,
            visibility,
            reply_to_id: replyToId,
            mc: urls.length,
          }
        );
        const postId = res.insertId;

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
     * Retrieves a single post and its associated media attachments.
     *
     * @async
     * @param {number} id - The post ID to fetch.
     * @returns {Promise<Object|null>} The post with its media, or `null` if not found.
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
     * Retrieves a paginated list of public posts.
     * Supports optional filters for user ID, max/min ID, and pagination limit.
     *
     * @async
     * @param {Object} filters - Query filters.
     * @param {?number} [filters.userId=null] - Filter by author ID.
     * @param {?number} [filters.maxId=null] - Return posts with IDs ≤ this value.
     * @param {?number} [filters.sinceId=null] - Return posts with IDs > this value.
     * @param {number} [filters.limit=20] - Maximum number of posts to return.
     * @returns {Promise<Object[]>} List of posts with their attached media.
     */
    async listFeed({
      userId = null,
      maxId = null,
      sinceId = null,
      limit = 20,
    }) {
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
     * Adds a "like" to a post for the given user.
     * Automatically recalculates the total like count for that post.
     *
     * @async
     * @param {Object} params - Like operation payload.
     * @param {number} params.postId - ID of the post being liked.
     * @param {number} params.userId - ID of the user liking the post.
     * @returns {Promise<{likes_count: number}>} Updated like count.
     */
    async likePost({ postId, userId }) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        await conn.execute(
          `INSERT IGNORE INTO feed_post_likes (post_id, user_id)
           VALUES (:post_id, :user_id)`,
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
     * Removes a user's like from a post.
     * Automatically updates the total like count.
     *
     * @async
     * @param {Object} params - Unlike operation payload.
     * @param {number} params.postId - ID of the post to unlike.
     * @param {number} params.userId - ID of the user removing the like.
     * @returns {Promise<{likes_count: number}>} Updated like count.
     */
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
     * Performs a **soft delete** (logical deletion) of a post.
     * The post remains in the database but is excluded from listings.
     * Automatically decrements the parent’s reply counter if applicable.
     *
     * @async
     * @param {Object} params - Deletion payload.
     * @param {number} params.postId - ID of the post to delete.
     * @param {number} params.userId - ID of the user requesting deletion.
     * @returns {Promise<{affected: number, parent_id: ?number}>}
     *   Number of affected rows and parent ID (if it was a reply).
     */
    async softDelete({ postId, userId }) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

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

        if (row.user_id !== userId || row.is_deleted) {
          await conn.rollback();
          return { affected: 0 };
        }

        const [res] = await conn.execute(
          `UPDATE feed_posts
       SET is_deleted = 1
       WHERE id = :id AND is_deleted = 0`,
          { id: postId }
        );

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
          parent_id: row.reply_to_id || null,
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
     * Creates a **text-only reply** to a parent post or another reply.
     * Uses the same transactional logic as `createTextPost`.
     *
     * @async
     * @param {Object} params - Reply payload.
     * @param {number} params.userId - ID of the replying user.
     * @param {number} params.parentId - ID of the parent post being replied to.
     * @param {string} params.body - Text content of the reply.
     * @param {string} [params.visibility="public"] - Visibility of the reply.
     * @returns {Promise<{id: number}>} The newly created reply ID.
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
     * Creates a **photo reply** to a parent post or reply.
     * Registers image metadata and updates the parent's reply counter.
     *
     * @async
     * @param {Object} params - Reply payload.
     * @param {number} params.userId - ID of the replying user.
     * @param {number} params.parentId - ID of the parent post.
     * @param {string[]} params.imageUrls - List of image URLs.
     * @param {string} [params.visibility="public"] - Visibility of the reply.
     * @param {Array<Object>} [params.sizes=[]] - Optional image metadata.
     * @returns {Promise<{id: number}>} The newly created reply ID.
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
     * Retrieves a paginated list of replies for a specific parent post.
     *
     * @async
     * @param {Object} params - Query parameters.
     * @param {number} params.parentId - ID of the parent post.
     * @param {?number} [params.maxId=null] - Return replies with IDs ≤ this value.
     * @param {?number} [params.sinceId=null] - Return replies with IDs > this value.
     * @param {number} [params.limit=20] - Maximum number of replies to fetch.
     * @returns {Promise<Object[]>} Array of reply objects with media data.
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
