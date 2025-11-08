/**
 * @file repositories/ShopLocationRepository.js
 * @description
 * Repository responsible for managing vendor shop locations within the
 * Softadastra platform. Handles storage, updates, and retrieval of geographic
 * data (latitude, longitude, address, visibility), with support for public
 * listings and spatial queries.
 *
 * ## Responsibilities
 * - Manage a **1:1** shop-location record per vendor (`user_id` is UNIQUE).
 * - Provide **UPSERT** semantics via `ON DUPLICATE KEY UPDATE`.
 * - Support **public listing**, **bounding-box** filtering, and **nearby** search.
 * - Integrate MySQL spatial features (e.g., `POINT(lng, lat)` geometry column).
 *
 * ## Database Schema (simplified)
 * - `shop_locations`
 *   - `id` INT AUTO_INCREMENT
 *   - `user_id` INT UNIQUE
 *   - `address` VARCHAR(255)
 *   - `latitude` DOUBLE
 *   - `longitude` DOUBLE
 *   - `geo` POINT  // stored as POINT(longitude, latitude)
 *   - `is_public` BOOLEAN
 *   - `created_at`, `updated_at` DATETIME
 *
 * ## Implementation Notes
 * - Uses `mysql2/promise` pooled connections from `db/mysql.js`.
 * - Validates and normalizes numeric inputs for coordinates and limits.
 * - Applies a **bounding-box prefilter** before Haversine distance to reduce cost.
 * - `listPublicNear()` returns distances in **kilometers**.
 *
 * @example
 * const ShopLocationRepository = require('./repositories/ShopLocationRepository');
 * const repo = new ShopLocationRepository();
 *
 * await repo.upsert({
 *   user_id: 42,
 *   address: "Kampala Road, Uganda",
 *   latitude: 0.315,
 *   longitude: 32.582,
 *   is_public: true
 * });
 *
 * const nearby = await repo.listPublicNear({ lat: 0.315, lng: 32.582, radiusKm: 5 });
 *
 * @see db/mysql.js — MySQL pool configuration
 * @see Softadastra Maps integration (frontend consumption)
 * @version 1.0.0
 * @license MIT
 */

const pool = require("../db/mysql");

/**
 * Repository for CRUD and spatial queries on `shop_locations`.
 */
class ShopLocationRepository {
  constructor() {
    /**
     * @private
     * @type {string}
     */
    this.table = "shop_locations";
  }

  /**
   * Retrieves a single shop location by vendor user ID.
   *
   * @async
   * @param {number|string} userId - Vendor user ID (will be coerced to Number).
   * @returns {Promise<Object|null>} The location row if found; otherwise `null`.
   */
  async getByUserId(userId) {
    const sql = `SELECT * FROM ${this.table} WHERE user_id = ? LIMIT 1`;
    const [rows] = await pool.query(sql, [Number(userId)]);
    return rows[0] || null;
  }

  /**
   * Creates or updates a vendor shop location (UPSERT).
   * Uses `ON DUPLICATE KEY UPDATE` keyed by `user_id`. Also updates:
   * - `updated_at` timestamp
   * - `geo` POINT(longitude, latitude) for spatial indexing/queries
   *
   * @async
   * @param {Object} params - Location payload.
   * @param {number} params.user_id - Vendor user ID (unique).
   * @param {string} params.address - Human-readable address.
   * @param {number|string} params.latitude - Latitude in decimal degrees.
   * @param {number|string} params.longitude - Longitude in decimal degrees.
   * @param {boolean|number} params.is_public - Visibility flag (1/0 or boolean).
   * @returns {Promise<boolean>} `true` if the row was inserted/updated; else `false`.
   * @throws {Error} If the query fails or inputs are not coercible to valid types.
   */
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
      Number(longitude), // POINT(lng, lat)
      Number(latitude),
    ];
    const [res] = await pool.query(sql, params);
    return res.affectedRows > 0;
  }

  /**
   * Permanently removes a shop location for the given vendor user ID.
   *
   * @async
   * @param {number|string} userId - Vendor user ID.
   * @returns {Promise<boolean>} `true` if a row was deleted; otherwise `false`.
   */
  async removeByUserId(userId) {
    const sql = `DELETE FROM ${this.table} WHERE user_id = ?`;
    const [res] = await pool.query(sql, [Number(userId)]);
    return res.affectedRows > 0;
  }

  /**
   * Lists publicly visible shop locations with pagination.
   *
   * @async
   * @param {Object} [opts={}] - Pagination options.
   * @param {number} [opts.limit=100] - Max rows to return (1..500).
   * @param {number} [opts.offset=0] - Row offset for pagination.
   * @returns {Promise<Object[]>} Array of location rows.
   */
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

  /**
   * Returns public shop locations within a geographic bounding box.
   * Useful as a coarse spatial filter (can be combined with client-side clustering).
   *
   * @async
   * @param {Object} params - Bounding box and pagination.
   * @param {number|string} params.minLat - Minimum latitude.
   * @param {number|string} params.maxLat - Maximum latitude.
   * @param {number|string} params.minLng - Minimum longitude.
   * @param {number|string} params.maxLng - Maximum longitude.
   * @param {number} [params.limit=200] - Max rows (1..500).
   * @param {number} [params.offset=0] - Offset for pagination.
   * @returns {Promise<Object[]>} Array of matching location rows.
   */
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

  /**
   * Finds public shop locations within a radius using the Haversine formula.
   * Applies a bounding-box prefilter to reduce computational cost.
   *
   * @async
   * @param {Object} params - Search parameters.
   * @param {number|string} params.lat - Latitude (center).
   * @param {number|string} params.lng - Longitude (center).
   * @param {number|string} [params.radiusKm=10] - Search radius in kilometers.
   * @param {number} [params.limit=200] - Max rows (1..500).
   * @param {number} [params.offset=0] - Offset for pagination.
   * @returns {Promise<Object[]>} Rows enriched with `distance_km` (ascending).
   */
  async listPublicNear({ lat, lng, radiusKm = 10, limit = 200, offset = 0 }) {
    const R = Math.max(0.1, Number(radiusKm) || 10); // km
    const latNum = Number(lat);
    const lngNum = Number(lng);

    // Approximate bounding box (reduces rows before Haversine)
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
      latNum, // (? - latitude)
      latNum, // COS(RADIANS(?))
      lngNum, // (? - longitude)
      latNum - degLat, // minLat
      latNum + degLat, // maxLat
      lngNum - degLng, // minLng
      lngNum + degLng, // maxLng
      R, // radius km
      Math.max(1, Math.min(500, Number(limit) || 200)),
      Math.max(0, Number(offset) || 0),
    ];

    const [rows] = await pool.query(sql, params);
    return rows;
  }
}

module.exports = ShopLocationRepository;
