// routes/feed.js
const express = require("express");
const router = express.Router();

const db = require("../db/mysql");
const FeedRepoClassFactory = require("../repositories/feedRepository");
const FeedRepository = FeedRepoClassFactory(db);
const repo = new FeedRepository();

// ✅ NOUVEAU: middleware JWT style PHP
const { authRequired } = require("../utils/auth-phpjwt");

// ===== Helpers =====
function ok(res, data = {}, status = 200) {
  res.status(status).json({ success: true, ...data });
}
function fail(res, message = "Bad Request", status = 400, extra = {}) {
  res.status(status).json({ success: false, message, ...extra });
}

// --- DEBUG rapide : ping du fichier pour être sûr que c’est le bon ---
router.get("/__ping", (req, res) =>
  res.json({ ok: true, where: "routes/feed.js" })
);

// ==== POST /api/feed/post (unifié: texte et/ou images) ====
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

    // Si tu as repo.createPost, utilise-le
    if (typeof repo.createPost === "function") {
      const out = await repo.createPost({
        userId: Number(req.user.id),
        body: text || null,
        imageUrls: urls,
        visibility,
        replyToId: reply_to_id || null,
        sizes: Array.isArray(sizes) ? sizes : [],
      });
      return res.json({ success: true, id: out.id });
    }

    // Fallback: routes existantes
    if (text && urls.length > 0) {
      const out = await repo.createPhotoPost({
        userId: Number(req.user.id),
        imageUrls: urls,
        visibility,
        replyToId: reply_to_id || null,
        sizes: Array.isArray(sizes) ? sizes : [],
        body: text, // si supporté par ton repo
      });
      return res.json({ success: true, id: out.id });
    }
    if (text) {
      const out = await repo.createTextPost({
        userId: Number(req.user.id),
        body: text,
        visibility,
        replyToId: reply_to_id || null,
      });
      return res.json({ success: true, id: out.id });
    }
    // seulement images
    const out = await repo.createPhotoPost({
      userId: Number(req.user.id),
      imageUrls: urls,
      visibility,
      replyToId: reply_to_id || null,
      sizes: Array.isArray(sizes) ? sizes : [],
    });
    return res.json({ success: true, id: out.id });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: e.message || "Failed to create post" });
  }
});

// ================================
// POST /api/feed/text
// ================================
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

// ================================
// POST /api/feed/photo
// ================================
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
      sizes: Array.isArray(sizes) ? sizes : [],
    });
    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create photo post", 500);
  }
});

// ================================
// GET /api/feed/:id/replies  (publique)
// query: max_id?, since_id?, limit?
// ================================
router.get("/:id/replies", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return fail(res, "Invalid parent id", 400);
    }

    const maxId = Number.isFinite(+req.query.max_id) ? +req.query.max_id : null;
    const sinceId = Number.isFinite(+req.query.since_id)
      ? +req.query.since_id
      : null;
    let limit = Number.isFinite(+req.query.limit) ? +req.query.limit : 20;
    if (limit <= 0) limit = 20;
    if (limit > 50) limit = 50;

    const items = await repo.listReplies({ parentId, maxId, sinceId, limit });
    return ok(res, { items });
  } catch (e) {
    return fail(res, e.message || "Failed to list replies", 500);
  }
});

// GET /api/feed
router.get("/", async (req, res) => {
  try {
    const userId = Number.isFinite(+req.query.user_id)
      ? +req.query.user_id
      : null;
    const maxId = Number.isFinite(+req.query.max_id) ? +req.query.max_id : null;
    const sinceId = Number.isFinite(+req.query.since_id)
      ? +req.query.since_id
      : null;

    let limit = Number.isFinite(+req.query.limit) ? +req.query.limit : 20;
    if (limit <= 0) limit = 20;
    if (limit > 50) limit = 50;

    // ✅ MODE SIMPLE (timeline publique + filtre user_id), activable avec ?simple=1
    if (req.query.simple === "1") {
      // NOTE: adapte "posts" au nom réel de ta table
      const params = [];
      let where =
        "p.is_deleted=0 AND (p.reply_to_id IS NULL OR p.reply_to_id=0) AND p.visibility='public'";

      if (userId) {
        where += " AND p.user_id = ?";
        params.push(userId);
      }
      if (maxId) {
        where += " AND p.id <= ?";
        params.push(maxId);
      }
      if (sinceId) {
        where += " AND p.id > ?";
        params.push(sinceId);
      }

      const sql = `
        SELECT
          p.id, p.user_id, p.body, p.reply_to_id, p.visibility,
          p.likes_count, p.replies_count, p.reposts_count,
          p.is_deleted, p.created_at, p.updated_at
        FROM posts p
        WHERE ${where}
        ORDER BY p.id DESC
        LIMIT ?
      `;
      params.push(limit);

      const [rows] = await db.query(sql, params);
      return ok(res, { items: rows });
    }

    // ✳️ COMPORTEMENT EXISTANT (repo)
    const rows = await repo.listFeed({ userId, maxId, sinceId, limit });
    return ok(res, { items: rows });
  } catch (e) {
    return fail(res, e.message || "Failed to list feed", 500);
  }
});

// ================================
// GET /api/feed/:id  (publique)  <-- LAISSER APRÈS /:id/replies
// ================================
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return fail(res, "Invalid id", 400);
    const post = await repo.getPostById(id);
    if (!post) return fail(res, "Not found", 404);
    return ok(res, { post });
  } catch (e) {
    return fail(res, e.message || "Failed to fetch post", 500);
  }
});

// ================================
// LIKE / UNLIKE / DELETE / REPLIES (protégées)
// ================================
router.post("/:id/like", authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0)
      return fail(res, "Invalid id", 400);
    const out = await repo.likePost({ postId, userId: Number(req.user.id) });
    return ok(res, { likes_count: out.likes_count });
  } catch (e) {
    return fail(res, e.message || "Failed to like", 500);
  }
});

router.delete("/:id/like", authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0)
      return fail(res, "Invalid id", 400);
    const out = await repo.unlikePost({ postId, userId: Number(req.user.id) });
    return ok(res, { likes_count: out.likes_count });
  } catch (e) {
    return fail(res, e.message || "Failed to unlike", 500);
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0)
      return fail(res, "Invalid id", 400);
    const out = await repo.softDelete({ postId, userId: Number(req.user.id) });
    if (!out.affected) return fail(res, "Not found or not owner", 404);
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, e.message || "Failed to delete", 500);
  }
});

router.post("/:id/reply/text", authRequired, async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    if (!Number.isInteger(parentId) || parentId <= 0)
      return fail(res, "Invalid parent id", 400);

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
    if (!Number.isInteger(parentId) || parentId <= 0)
      return fail(res, "Invalid parent id", 400);

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
