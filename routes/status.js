const express = require("express");
const router = express.Router();
const redis = require("../db/redis");

router.get("/online-status", async (req, res) => {
  try {
    const keys = await redis.keys("user:*:online"); // user:123:online
    const onlineUserIds = keys.map((key) => key.split(":")[1]);
    res.json(onlineUserIds);
  } catch (e) {
    res.status(500).json({ error: "Erreur Redis" });
  }
});

module.exports = router;
