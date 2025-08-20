// routes/upload.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authRequired } = require("../utils/auth-phpjwt"); // ✅ protège l'upload

const router = express.Router();

const uploadPath = path.join(__dirname, "../public/uploads");
fs.mkdirSync(uploadPath, { recursive: true });

// Limites & filtrage
const LIMIT_COUNT = 4; // max 4 images
const LIMIT_SIZE = 10 * 1024 * 1024; // 10MB par fichier
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function fileFilter(req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) return cb(new Error("Invalid image type"));
  cb(null, true);
}

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

// ✅ Nouvelle route: upload multi images (même endpoint que le chat)
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
    // URL publique absolue si possible, sinon relative
    const base =
      process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    const image_urls = req.files.map((f) =>
      base ? `${base}/uploads/${f.filename}` : `/uploads/${f.filename}`
    );

    return res.json({ success: true, image_urls });
  }
);

// Gestion d'erreurs Multer (messages propres)
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
