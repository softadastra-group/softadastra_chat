// routes/debugJwt.js
const express = require("express");
const router = express.Router();

router.get("/debug/jwt", (req, res) => {
  try {
    let token = null;
    const h = req.headers.authorization || req.headers.Authorization;
    if (h && /^Bearer\s+/i.test(h)) token = h.replace(/^Bearer\s+/i, "").trim();
    if (!token && req.query.token) token = String(req.query.token);

    if (!token) return res.status(400).json({ error: "No token" });

    const [headB64u, payB64u] = token.split(".");
    const header = JSON.parse(
      Buffer.from(
        headB64u.replace(/-/g, "+").replace(/_/g, "/") + "==",
        "base64"
      ).toString("utf8")
    );
    const payload = JSON.parse(
      Buffer.from(
        payB64u.replace(/-/g, "+").replace(/_/g, "/") + "==",
        "base64"
      ).toString("utf8")
    );

    res.json({ header, payload });
  } catch (e) {
    res.status(400).json({ error: "Bad token", message: e.message });
  }
});

module.exports = router;
