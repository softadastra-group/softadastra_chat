/**
 * @file routes/feed.js
 * @description
 * Defines all **feed-related endpoints** for **Softadastra Chat**.
 * This includes creating posts, replies, fetching feeds, and managing likes or deletions.
 *
 * ## Responsibilities
 * - Handle text and photo posts (`/post`, `/text`, `/photo`).
 * - Manage replies, likes, deletions, and visibility.
 * - Provide public and authenticated feed access.
 *
 * ## Features
 * - Unified `/api/feed/post` endpoint (text and/or images).
 * - Optional reply threading via `reply_to_id`.
 * - Public `/api/feed` browsing with pagination.
 * - Secure actions (`like`, `reply`, `delete`) protected by JWT (`authRequired`).
 *
 * ## Security
 * - Write operations require authentication.
 * - Public endpoints (GET) filter by `visibility='public'`.
 *
 * @module routes/feed
 * @see repositories/feedRepository.js — Data layer for feed operations.
 */

const express = require("express");
const router = express.Router();

const db = require("../db/mysql");
const FeedRepoClassFactory = require("../repositories/feedRepository");
const FeedRepository = FeedRepoClassFactory(db);
const repo = new FeedRepository();

const { authRequired } = require("../utils/auth-phpjwt");

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
/**
 * Sends a standardized success response.
 */
function ok(res, data = {}, status = 200) {
  res.status(status).json({ success: true, ...data });
}

/**
 * Sends a standardized error response.
 */
function fail(res, message = "Bad Request", status = 400, extra = {}) {
  res.status(status).json({ success: false, message, ...extra });
}

// Health check
router.get("/__ping", (req, res) =>
  res.json({ ok: true, where: "routes/feed.js" })
);

// -----------------------------------------------------------------------------
// POST /api/feed/post — Unified post creation (text + images)
// -----------------------------------------------------------------------------
/**
 * @route POST /api/feed/post
 * @middleware authRequired
 * @summary Creates a new feed post (text, images, or both).
 * @description
 * Handles all combinations of feed posts. Accepts:
 * - `body`: optional text
 * - `image_urls[]`: optional array of image URLs
 * - `visibility`: "public" | "private"
 * - `reply_to_id`: optional parent post ID
 *
 * @returns {object} 200 - `{ success: true, id: number }`
 * @returns {object} 400 - `{ success: false, message: string }`
 */
router.post("/post", authRequired, async (req, res) => {
  try {
    const {
      body = "",
      image_urls = [],
      visibility = "public",
      reply_to_id = null,
      sizes = [],
    } = req.body || {};

    const text = typeof body === "string" ? body.trim() : "";
    const urls = Array.isArray(image_urls) ? image_urls.filter(Boolean) : [];

    if (!text && urls.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Provide at least text or images" });
    }

    if (typeof repo.createPost === "function") {
      const out = await repo.createPost({
        userId: Number(req.user.id),
        body: text || null,
        imageUrls: urls,
        visibility,
        replyToId: reply_to_id || null,
        sizes: Array.isArray(sizes) ? sizes : [],
      });
      return ok(res, { id: out.id });
    }

    // Fallback (separate handlers)
    if (text && urls.length > 0) {
      const out = await repo.createPhotoPost({
        userId: Number(req.user.id),
        imageUrls: urls,
        visibility,
        replyToId: reply_to_id || null,
        sizes,
        body: text,
      });
      return ok(res, { id: out.id });
    }
    if (text) {
      const out = await repo.createTextPost({
        userId: Number(req.user.id),
        body: text,
        visibility,
        replyToId: reply_to_id || null,
      });
      return ok(res, { id: out.id });
    }
    const out = await repo.createPhotoPost({
      userId: Number(req.user.id),
      imageUrls: urls,
      visibility,
      replyToId: reply_to_id || null,
      sizes,
    });
    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create post", 500);
  }
});

// -----------------------------------------------------------------------------
// POST /api/feed/text
// -----------------------------------------------------------------------------
router.post("/text", authRequired, async (req, res) => {
  try {
    const { body, visibility = "public", reply_to_id = null } = req.body || {};
    if (!body || typeof body !== "string" || !body.trim()) {
      return fail(res, "Body is required for text posts");
    }
    const out = await repo.createTextPost({
      userId: Number(req.user.id),
      body: body.trim(),
      visibility,
      replyToId: reply_to_id || null,
    });
    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create text post", 500);
  }
});

// -----------------------------------------------------------------------------
// POST /api/feed/photo
// -----------------------------------------------------------------------------
router.post("/photo", authRequired, async (req, res) => {
  try {
    const {
      image_urls = [],
      visibility = "public",
      reply_to_id = null,
      sizes = [],
    } = req.body || {};
    const urls = Array.isArray(image_urls) ? image_urls.filter(Boolean) : [];
    if (urls.length === 0)
      return fail(res, "At least one image is required for photo posts");

    const out = await repo.createPhotoPost({
      userId: Number(req.user.id),
      imageUrls: urls,
      visibility,
      replyToId: reply_to_id || null,
      sizes,
    });
    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create photo post", 500);
  }
});

// -----------------------------------------------------------------------------
// GET /api/feed/:id/replies
// -----------------------------------------------------------------------------
router.get("/:id/replies", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return fail(res, "Invalid parent id");
    }
    const { max_id, since_id, limit } = req.query;
    const items = await repo.listReplies({
      parentId,
      maxId: +max_id || null,
      sinceId: +since_id || null,
      limit: Math.min(+limit || 20, 50),
    });
    return ok(res, { items });
  } catch (e) {
    return fail(res, e.message || "Failed to list replies", 500);
  }
});

// -----------------------------------------------------------------------------
// GET /api/feed
// -----------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { user_id, max_id, since_id, limit, simple } = req.query;
    const userId = Number.isFinite(+user_id) ? +user_id : null;
    const lim = Math.min(+limit || 20, 50);

    // Simple mode (direct SQL query)
    if (simple === "1") {
      const params = [];
      let where = `p.is_deleted=0 AND p.visibility='public' AND (p.reply_to_id IS NULL OR p.reply_to_id=0)`;
      if (userId) {
        where += ` AND p.user_id=?`;
        params.push(userId);
      }
      if (max_id) {
        where += ` AND p.id <= ?`;
        params.push(+max_id);
      }
      if (since_id) {
        where += ` AND p.id > ?`;
        params.push(+since_id);
      }

      const sql = `
        SELECT p.id, p.user_id, p.body, p.reply_to_id, p.visibility,
               p.likes_count, p.replies_count, p.reposts_count,
               p.is_deleted, p.created_at, p.updated_at
        FROM feed_posts p
        WHERE ${where}
        ORDER BY p.id DESC
        LIMIT ${lim}
      `;
      const [rows] = await db.query(sql, params);

      if (rows.length) {
        const ids = rows.map((r) => r.id);
        const [medias] = await db.query(
          `SELECT id, post_id, url, mime_type, position, width, height
           FROM feed_post_media
           WHERE post_id IN (${ids.map(() => "?").join(",")})
           ORDER BY post_id ASC, position ASC, id ASC`,
          ids
        );
        const map = new Map();
        for (const m of medias) {
          if (!map.has(m.post_id)) map.set(m.post_id, []);
          map.get(m.post_id).push(m);
        }
        rows.forEach((r) => (r.media = map.get(r.id) || []));
      }

      return ok(res, { items: rows });
    }

    const rows = await repo.listFeed({
      userId,
      maxId: +max_id || null,
      sinceId: +since_id || null,
      limit: lim,
    });
    return ok(res, { items: rows });
  } catch (e) {
    return fail(res, e.message || "Failed to list feed", 500);
  }
});

// -----------------------------------------------------------------------------
// GET /api/feed/:id
// -----------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return fail(res, "Invalid id");
    const post = await repo.getPostById(id);
    if (!post) return fail(res, "Not found", 404);
    return ok(res, { post });
  } catch (e) {
    return fail(res, e.message || "Failed to fetch post", 500);
  }
});

// -----------------------------------------------------------------------------
// LIKE / UNLIKE / DELETE / REPLY (protected)
// -----------------------------------------------------------------------------
router.post("/:id/like", authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const out = await repo.likePost({ postId, userId: Number(req.user.id) });
    return ok(res, { likes_count: out.likes_count });
  } catch (e) {
    return fail(res, e.message || "Failed to like", 500);
  }
});

router.delete("/:id/like", authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const out = await repo.unlikePost({ postId, userId: Number(req.user.id) });
    return ok(res, { likes_count: out.likes_count });
  } catch (e) {
    return fail(res, e.message || "Failed to unlike", 500);
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const out = await repo.softDelete({ postId, userId: Number(req.user.id) });
    if (!out.affected) return fail(res, "Not found or not owner", 404);
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, e.message || "Failed to delete", 500);
  }
});

// Replies
router.post("/:id/reply/text", authRequired, async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    const { body, visibility = "public" } = req.body || {};
    if (!body || typeof body !== "string" || !body.trim()) {
      return fail(res, "Body is required for text replies");
    }
    const parent = await repo.getPostById(parentId);
    if (!parent) return fail(res, "Parent not found", 404);

    const out = await repo.createTextReply({
      userId: Number(req.user.id),
      parentId,
      body: body.trim(),
      visibility,
    });
    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create text reply", 500);
  }
});

router.post("/:id/reply/photo", authRequired, async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    const {
      image_urls = [],
      sizes = [],
      visibility = "public",
    } = req.body || {};
    const urls = Array.isArray(image_urls) ? image_urls.filter(Boolean) : [];
    if (urls.length === 0)
      return fail(res, "At least one image is required for photo replies");
    const parent = await repo.getPostById(parentId);
    if (!parent) return fail(res, "Parent not found", 404);

    const out = await repo.createPhotoReply({
      userId: Number(req.user.id),
      parentId,
      imageUrls: urls,
      sizes: Array.isArray(sizes) ? sizes : [],
      visibility,
    });
    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create photo reply", 500);
  }
});

module.exports = router;
