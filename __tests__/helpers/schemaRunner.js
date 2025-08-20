const db = require("../../db/mysql");

async function runSchema(sql) {
  const parts = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of parts) {
    await db.execute(stmt); // une requête à la fois
  }
}

module.exports = { runSchema };
