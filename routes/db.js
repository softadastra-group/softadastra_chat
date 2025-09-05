// /srv/node-app/routes/db.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db/mysql');

router.get('/db/ping', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS now, DATABASE() AS db');
    res.json({ ok: true, db: rows[0]?.db, now: rows[0]?.now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/db/stats', async (_req, res) => {
  try {
    const [[m]] = await pool.query('SELECT COUNT(*) AS messages FROM chat_messages');
    const [[t]] = await pool.query('SELECT COUNT(*) AS threads  FROM chat_threads');
    res.json({ ok: true, messages: m.messages, threads: t.threads });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
