// routes/push-public.js
const express = require("express");
const router = express.Router();

router.get("/public-key", (_, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC || "" });
});

module.exports = router;
