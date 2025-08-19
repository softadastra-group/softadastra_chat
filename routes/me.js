// routes/me.js
const express = require("express");
const { authRequired } = require("../utils/auth-phpjwt"); // ✅ ton vérifieur compatible PHP

const router = express.Router();

// Garde protégée: accepte Authorization: Bearer ... ou cookie "token"
router.get("/api/me", authRequired, (req, res) => {
  // req.user.payload = payload complet du JWT (issu de verifyPhpJwt)
  return res.json({ user: req.user.payload });
});

module.exports = router;
