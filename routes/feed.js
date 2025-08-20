// routes/feed.js
// Routes REST pour le feed (posts texte seul / photo seule façon x.com)

const express = require("express");
const router = express.Router();

// ===== Repo =====
const db = require("../db/mysql");
const FeedRepoClassFactory = require("../repositories/feedRepository");
const FeedRepository = FeedRepoClassFactory(db);
const repo = new FeedRepository();

// ===== (Optionnel) JWT auth si SA_JWT_SECRET est défini =====
let jwt = null;
try {
  jwt = require("jsonwebtoken");
} catch {}
const JWT_SECRET = process.env.SA_JWT_SECRET || null;

function getUserIdFromReq(req) {
  // 1) Si un middleware amont a déjà mis req.user
  if (req.user && req.user.id) return Number(req.user.id);

  // 2) En-tête "x-user-id" (utile en dev / tests)
  const xuid = req.header("x-user-id");
  if (xuid && Number(xuid)) return Number(xuid);

  // 3) Authorization: Bearer <token> (JWT signé)
  const auth = req.header("authorization") || req.header("Authorization");
  if (auth && JWT_SECRET && jwt) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) {
      try {
        const payload = jwt.verify(m[1], JWT_SECRET);
        if (payload && payload.id) return Number(payload.id);
      } catch {
        /* no-op */
      }
    }
  }
  return null;
}

function requireUser(req, res, next) {
  const uid = getUserIdFromReq(req);
  if (!uid)
    return res.status(401).json({ success: false, message: "Unauthorized" });
  req.authUserId = uid;
  next();
}

// ===== Helpers =====
function ok(res, data = {}, status = 200) {
  res.status(status).json({ success: true, ...data });
}
function fail(res, message = "Bad Request", status = 400, extra = {}) {
  res.status(status).json({ success: false, message, ...extra });
}

// ================================
// POST /api/feed/text
// body: { body, visibility?, reply_to_id? }
// ================================
router.post("/text", requireUser, async (req, res) => {
  try {
    const { body, visibility = "public", reply_to_id = null } = req.body || {};

    // Règle: texte SEUL => body obligatoire et non vide
    if (!body || typeof body !== "string" || !body.trim()) {
      return fail(res, "Body is required for text posts");
    }

    const out = await repo.createTextPost({
      userId: req.authUserId,
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
// body: { image_urls: string[], visibility?, reply_to_id?, sizes? }
// (image_urls provient p.ex. de /api/chat/upload existant)
// ================================
router.post("/photo", requireUser, async (req, res) => {
  try {
    const {
      image_urls = [],
      visibility = "public",
      reply_to_id = null,
      sizes = [],
    } = req.body || {};

    // Règle: photo SEULE => au moins 1 image, pas de body
    const urls = Array.isArray(image_urls) ? image_urls.filter((u) => !!u) : [];
    if (urls.length === 0) {
      return fail(res, "At least one image is required for photo posts");
    }

    const out = await repo.createPhotoPost({
      userId: req.authUserId,
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
// GET /api/feed/:id
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
// GET /api/feed
// query: user_id?, max_id?, since_id?, limit?
// ================================
router.get("/", async (req, res) => {
  try {
    const userId = req.query.user_id ? Number(req.query.user_id) : null;
    const maxId = req.query.max_id ? Number(req.query.max_id) : null;
    const sinceId = req.query.since_id ? Number(req.query.since_id) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const rows = await repo.listFeed({ userId, maxId, sinceId, limit });
    return ok(res, { items: rows });
  } catch (e) {
    return fail(res, e.message || "Failed to list feed", 500);
  }
});

// ================================
// POST /api/feed/:id/like
// ================================
router.post("/:id/like", requireUser, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0)
      return fail(res, "Invalid id", 400);

    const out = await repo.likePost({ postId, userId: req.authUserId });
    return ok(res, { likes_count: out.likes_count });
  } catch (e) {
    return fail(res, e.message || "Failed to like", 500);
  }
});

// ================================
// DELETE /api/feed/:id/like
// ================================
router.delete("/:id/like", requireUser, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0)
      return fail(res, "Invalid id", 400);

    const out = await repo.unlikePost({ postId, userId: req.authUserId });
    return ok(res, { likes_count: out.likes_count });
  } catch (e) {
    return fail(res, e.message || "Failed to unlike", 500);
  }
});

// ================================
// DELETE /api/feed/:id  (soft delete)
// ================================
router.delete("/:id", requireUser, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId) || postId <= 0)
      return fail(res, "Invalid id", 400);

    const out = await repo.softDelete({ postId, userId: req.authUserId });
    if (!out.affected) return fail(res, "Not found or not owner", 404);

    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, e.message || "Failed to delete", 500);
  }
});

// ================================
// POST /api/feed/:id/reply/text
// body: { body, visibility? }
// ================================
router.post("/:id/reply/text", requireUser, async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    if (!Number.isInteger(parentId) || parentId <= 0)
      return fail(res, "Invalid parent id", 400);

    const { body, visibility = "public" } = req.body || {};
    if (!body || typeof body !== "string" || !body.trim()) {
      return fail(res, "Body is required for text replies");
    }

    // Vérifie que le parent existe et n'est pas deleted (optionnel mais conseillé)
    const parent = await repo.getPostById(parentId);
    if (!parent) return fail(res, "Parent not found", 404);

    const out = await repo.createTextReply({
      userId: req.authUserId,
      parentId,
      body: body.trim(),
      visibility,
    });

    return ok(res, { id: out.id });
  } catch (e) {
    return fail(res, e.message || "Failed to create text reply", 500);
  }
});

// ================================
// POST /api/feed/:id/reply/photo
// body: { image_urls: string[], sizes?, visibility? }
// ================================
router.post("/:id/reply/photo", requireUser, async (req, res) => {
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
      userId: req.authUserId,
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

// ================================
// GET /api/feed/:id/replies
// query: max_id?, since_id?, limit?
// ================================
router.get("/:id/replies", async (req, res) => {
  try {
    const parentId = Number(req.params.id);
    if (!Number.isInteger(parentId) || parentId <= 0)
      return fail(res, "Invalid parent id", 400);

    const maxId = req.query.max_id ? Number(req.query.max_id) : null;
    const sinceId = req.query.since_id ? Number(req.query.since_id) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const replies = await repo.listReplies({ parentId, maxId, sinceId, limit });
    return ok(res, { items: replies });
  } catch (e) {
    return fail(res, e.message || "Failed to list replies", 500);
  }
});

module.exports = router;
