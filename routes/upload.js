const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const uploadPath = path.join(__dirname, "../public/uploads");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => {
    const unique = Date.now() + "_" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Nouvelle route : upload de plusieurs images
router.post("/api/chat/upload", upload.array("images[]"), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No image received." });
  }

  // Génère les URLs accessibles
  const imageUrls = req.files.map((file) => `/uploads/${file.filename}`);
  res.json({ image_urls: imageUrls });
});

module.exports = router;
