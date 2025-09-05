// db/mysql.js
const mysql = require("mysql2/promise");
require("dotenv").config();

const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? process.env.DB_PASS ?? "",
  database: process.env.DB_NAME || "softadastra_feed_test",
  waitForConnections: true,
  connectionLimit: 20,
  namedPlaceholders: true,
  timezone: "Z",
  // ⚠️ charset = 'utf8mb4' (PAS une collation)
  charset: "utf8mb4",
};

const pool = mysql.createPool(config);

// Optionnel : forcer le charset côté session
pool
  .getConnection()
  .then(async (conn) => {
    try {
      await conn.query("SET NAMES utf8mb4");
      console.log("✅ Connexion MySQL OK (utf8mb4)");
    } finally {
      conn.release();
    }
  })
  .catch((err) => {
    console.error("❌ MySQL connection error:", err.message);
  });

module.exports = {
  pool,
  getConnection: () => pool.getConnection(),
  query: (sql, params) => pool.query(sql, params),
  execute: (sql, params) => pool.execute(sql, params),
};
