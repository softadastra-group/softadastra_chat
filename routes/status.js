const express = require("express");
const router = express.Router();

const { connectedUsers } = require("../ws/userState");

router.get("/online-status", (req, res) => {
  try {
    const onlineUserIds = Array.from(connectedUsers.keys());
    res.json(onlineUserIds);
  } catch (e) {
    res.status(500).json({ error: "Erreur interne" });
  }
});

module.exports = router;
