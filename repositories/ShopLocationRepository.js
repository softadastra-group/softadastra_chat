// repositories/ShopLocationRepository.js
const pool = require("../db/mysql");

class ShopLocationRepository {
  constructor() {
    this.table = "shop_locations";
  }

  async getByUserId(userId) {
    const sql = `SELECT * FROM ${this.table} WHERE user_id = ? LIMIT 1`;
    const [rows] = await pool.query(sql, [Number(userId)]);
    return rows[0] || null;
  }

  // UPSERT via ON DUPLICATE KEY (UNIQUE user_id)
  async upsert({ user_id, address, latitude, longitude, is_public }) {
    const sql = `
      INSERT INTO ${this.table}
        (user_id, address, latitude, longitude, is_public, created_at, updated_at, geo)
      VALUES
        (?, ?, ?, ?, ?, NOW(), NOW(), POINT(?, ?))
      ON DUPLICATE KEY UPDATE
        address   = VALUES(address),
        latitude  = VALUES(latitude),
        longitude = VALUES(longitude),
        is_public = VALUES(is_public),
        updated_at= NOW(),
        geo       = VALUES(geo)
    `;
    const params = [
      Number(user_id),
      String(address || "").trim(),
      Number(latitude),
      Number(longitude),
      is_public ? 1 : 0,
      Number(longitude),
      Number(latitude),
    ];
    const [res] = await pool.query(sql, params);
    return res.affectedRows > 0;
  }

  async removeByUserId(userId) {
    const sql = `DELETE FROM ${this.table} WHERE user_id = ?`;
    const [res] = await pool.query(sql, [Number(userId)]);
    return res.affectedRows > 0;
  }

  // Liste publique (simple)
  async listPublic({ limit = 100, offset = 0 } = {}) {
    const sql = `
      SELECT id, user_id, address, latitude, longitude, is_public, created_at, updated_at
      FROM ${this.table}
      WHERE is_public = 1
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(sql, [
      Math.max(1, Math.min(500, Number(limit) || 100)),
      Math.max(0, Number(offset) || 0),
    ]);
    return rows;
  }

  // Filtre par bounding box (utilise index (lat,lng))
  async listPublicInBBox({
    minLat,
    maxLat,
    minLng,
    maxLng,
    limit = 200,
    offset = 0,
  }) {
    const sql = `
      SELECT id, user_id, address, latitude, longitude, is_public, created_at, updated_at
      FROM ${this.table}
      WHERE is_public = 1
        AND latitude  BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(sql, [
      Number(minLat),
      Number(maxLat),
      Number(minLng),
      Number(maxLng),
      Math.max(1, Math.min(500, Number(limit) || 200)),
      Math.max(0, Number(offset) || 0),
    ]);
    return rows;
  }

  // Recherche par rayon (Haversine, compatible MySQL/MariaDB 5.7+)
  // Pré-filtrage BBOX pour perf, puis HAVING distance <= rayon
  async listPublicNear({ lat, lng, radiusKm = 10, limit = 200, offset = 0 }) {
    const R = Math.max(0.1, Number(radiusKm) || 10); // km
    const latNum = Number(lat);
    const lngNum = Number(lng);

    // BBOX approximative
    const degLat = R / 111.0;
    const cosLat = Math.cos((latNum * Math.PI) / 180);
    const degLng = R / (111.32 * (cosLat === 0 ? 1e-9 : cosLat));

    const sql = `
      SELECT
        id, user_id, address, latitude, longitude, is_public, created_at, updated_at,
        (
          6371 * 2 * ASIN(
            SQRT(
              POWER(SIN(RADIANS(? - latitude) / 2), 2) +
              COS(RADIANS(latitude)) * COS(RADIANS(?)) *
              POWER(SIN(RADIANS(? - longitude) / 2), 2)
            )
          )
        ) AS distance_km
      FROM ${this.table}
      WHERE is_public = 1
        AND latitude  BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      HAVING distance_km <= ?
      ORDER BY distance_km ASC
      LIMIT ? OFFSET ?
    `;

    const params = [
      latNum, // ? pour (? - latitude)
      latNum, // ? pour COS(RADIANS(?))
      lngNum, // ? pour (? - longitude)
      latNum - degLat, // minLat
      latNum + degLat, // maxLat
      lngNum - degLng, // minLng
      lngNum + degLng, // maxLng
      R, // rayon km
      Math.max(1, Math.min(500, Number(limit) || 200)),
      Math.max(0, Number(offset) || 0),
    ];

    const [rows] = await pool.query(sql, params);
    return rows;
  }
}

module.exports = ShopLocationRepository;
