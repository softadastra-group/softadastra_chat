/**
 * @file routes/chat-upload.js
 * @description
 * Handles secure image uploads for **Softadastra Chat** messages.
 * Supports authenticated multipart form uploads via `multer` and stores images
 * under `/public/uploads`, enforcing file type, size, and count limits.
 *
 * ## Responsibilities
 * - Validate and store uploaded chat images.
 * - Limit uploads to 4 images per request (10 MB each).
 * - Return absolute or relative URLs of saved files.
 * - Provide safe fallback for invalid or oversized uploads.
 *
 * ## Security
 * - Protected by `authRequired` middleware.
 * - Restricts MIME types to safe image formats only.
 * - Uses random filenames to prevent collisions and path traversal.
 *
 * @module routes/chat-upload
 * @see utils/auth-phpjwt.js — JWT authentication middleware
 */

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authRequired } = require("../utils/auth-phpjwt");

const router = express.Router();

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/** Upload directory */
const uploadPath = path.join(__dirname, "../public/uploads");
fs.mkdirSync(uploadPath, { recursive: true });

/** Maximum limits and accepted file types */
const LIMIT_COUNT = 4; // max 4 images per request
const LIMIT_SIZE = 10 * 1024 * 1024; // 10 MB per image
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Custom file filter to restrict uploads to safe image formats only.
 * @param {Express.Request} req
 * @param {Express.Multer.File} file
 * @param {Function} cb
 */
function fileFilter(req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new Error("Invalid image type"));
  }
  cb(null, true);
}

/** Storage configuration (destination + unique filename generator) */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => {
    const ext =
      file.mimetype === "image/jpeg"
        ? ".jpg"
        : file.mimetype === "image/png"
        ? ".png"
        : file.mimetype === "image/webp"
        ? ".webp"
        : file.mimetype === "image/gif"
        ? ".gif"
        : path.extname(file.originalname || "");
    const base = Date.now() + "_" + Math.random().toString(16).slice(2);
    cb(null, base + ext);
  },
});

const upload = multer({
  storage,
  fileFilter,
  limits: { files: LIMIT_COUNT, fileSize: LIMIT_SIZE },
});

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

/**
 * @route POST /api/chat/upload
 * @middleware authRequired
 * @summary Uploads up to 4 chat images and returns their URLs.
 * @description
 * This endpoint handles multipart/form-data uploads using `images[]` as the field name.
 * Only authenticated users can upload. The endpoint enforces:
 * - Max 4 images
 * - Max 10 MB per image
 * - Allowed formats: JPEG, PNG, WEBP, GIF
 *
 * @returns {object} 200 - `{ success: true, image_urls: [ ... ] }`
 * @returns {object} 400 - `{ success: false, error: "No image received." }`
 * @returns {object} 413 - `{ success: false, error: "Image too large (max 10MB)" }`
 *
 * @example
 * // cURL example
 * curl -X POST https://api.softadastra.com/api/chat/upload \
 *      -H "Authorization: Bearer <token>" \
 *      -F "images[]=@/path/to/image1.jpg" \
 *      -F "images[]=@/path/to/image2.png"
 *
 * // Example response
 * {
 *   "success": true,
 *   "image_urls": [
 *     "https://api.softadastra.com/uploads/1731057229_a6c5f4e3a.webp",
 *     "https://api.softadastra.com/uploads/1731057230_aa13ffb1.jpg"
 *   ]
 * }
 */
router.post(
  "/api/chat/upload",
  authRequired,
  upload.array("images[]", LIMIT_COUNT),
  (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No image received." });
    }

    const base =
      process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    const image_urls = req.files.map((f) =>
      base ? `${base}/uploads/${f.filename}` : `/uploads/${f.filename}`
    );

    return res.json({ success: true, image_urls });
  }
);

// -----------------------------------------------------------------------------
// Error Handling Middleware
// -----------------------------------------------------------------------------

/**
 * Multer error handler.
 * Converts file limit or size errors into JSON responses.
 */
router.use((err, req, res, next) => {
  if (err && err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ success: false, error: "Image too large (max 10MB)" });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res
        .status(400)
        .json({ success: false, error: "Too many images (max 4)" });
    }
    return res.status(400).json({ success: false, error: err.message });
  }

  if (err) {
    return res
      .status(400)
      .json({ success: false, error: err.message || "Upload error" });
  }

  next();
});

module.exports = router;
