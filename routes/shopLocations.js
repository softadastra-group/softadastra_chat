/**
 * @file routes/locations.js
 * @description
 * REST API routes for managing **shop locations** in the Softadastra ecosystem.
 * Provides endpoints for public listings, spatial queries, and authenticated
 * CRUD operations for each seller’s precise shop location.
 *
 * ## Responsibilities
 * - Manage shop locations (create, update, delete, fetch).
 * - Provide geospatial queries (bounding box and radius search).
 * - Support visibility controls (public vs private).
 * - Include debugging routes for database validation.
 *
 * ## Security
 * - `authRequired` middleware protects authenticated seller routes.
 * - Public endpoints expose only non-sensitive, public data.
 *
 * ## Database
 * Table: `shop_locations`
 * ```
 * id, user_id, address, latitude, longitude, is_public, geo (POINT),
 * created_at, updated_at
 * ```
 *
 * @module routes/locations
 * @see repositories/ShopLocationRepository.js — Handles all SQL queries.
 */

const express = require("express");
const router = express.Router();

const pool = require("../db/mysql");
const { authRequired } = require("../utils/auth-phpjwt");
const ShopLocationRepository = require("../repositories/ShopLocationRepository");
const repo = new ShopLocationRepository();

/**
 * @route GET /api/locations/public
 * @summary Returns a list of all public shop locations.
 * @param {number} [req.query.limit=100] - Maximum number of records (1–500).
 * @param {number} [req.query.offset=0] - Pagination offset.
 * @returns {object[]} 200 - Array of public shop locations.
 * @returns {object} 500 - `{ error: "Erreur chargement des localisations publiques" }`
 * @example
 * GET /api/locations/public?limit=20
 */
router.get("/locations/public", async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const rows = await repo.listPublic({ limit, offset });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: "Erreur chargement des localisations publiques" });
  }
});

/**
 * @route GET /api/locations/bbox
 * @summary Returns all public shop locations within a geographic bounding box.
 * @param {number} req.query.minLat - Minimum latitude.
 * @param {number} req.query.maxLat - Maximum latitude.
 * @param {number} req.query.minLng - Minimum longitude.
 * @param {number} req.query.maxLng - Maximum longitude.
 * @param {number} [req.query.limit=200] - Limit results (1–500).
 * @param {number} [req.query.offset=0] - Pagination offset.
 * @returns {object[]} 200 - Array of locations within the given box.
 * @returns {object} 400 - `{ error: "Paramètres bbox invalides" }`
 * @returns {object} 500 - `{ error: "Erreur bbox" }`
 * @example
 * GET /api/locations/bbox?minLat=-1.2&maxLat=0.5&minLng=29.8&maxLng=31.0
 */
router.get("/locations/bbox", async (req, res) => {
  try {
    const { minLat, maxLat, minLng, maxLng, limit, offset } = req.query;
    for (const v of [minLat, maxLat, minLng, maxLng]) {
      if (v === undefined || isNaN(Number(v))) {
        return res.status(400).json({ error: "Paramètres bbox invalides" });
      }
    }
    const rows = await repo.listPublicInBBox({
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit,
      offset,
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur bbox" });
  }
});

/**
 * @route GET /api/locations/near
 * @summary Returns public shop locations within a given radius (km) from coordinates.
 * @param {number} req.query.lat - Center latitude.
 * @param {number} req.query.lng - Center longitude.
 * @param {number} [req.query.radiusKm=10] - Search radius in kilometers.
 * @param {number} [req.query.limit=200] - Maximum number of results.
 * @param {number} [req.query.offset=0] - Pagination offset.
 * @returns {object[]} 200 - Locations sorted by ascending distance.
 * @returns {object} 400 - `{ error: "lat/lng requis" }`
 * @returns {object} 500 - `{ error: "Erreur recherche par rayon" }`
 * @example
 * GET /api/locations/near?lat=0.315&lng=32.58&radiusKm=5
 */
router.get("/locations/near", async (req, res) => {
  try {
    const { lat, lng, radiusKm, limit, offset } = req.query;
    if (
      lat === undefined ||
      lng === undefined ||
      isNaN(Number(lat)) ||
      isNaN(Number(lng))
    ) {
      return res.status(400).json({ error: "lat/lng requis" });
    }
    const rows = await repo.listPublicNear({
      lat,
      lng,
      radiusKm,
      limit,
      offset,
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur recherche par rayon" });
  }
});

/**
 * @route GET /api/shops/me/location
 * @middleware authRequired
 * @summary Returns the authenticated seller’s shop location.
 * @returns {object} 200 - The seller’s shop location.
 * @returns {object} 404 - `{ error: "Aucune localisation" }`
 * @returns {object} 500 - `{ error: "Erreur lecture localisation" }`
 * @example
 * GET /api/shops/me/location
 */
router.get("/shops/me/location", authRequired, async (req, res) => {
  try {
    const row = await repo.getByUserId(req.user.id);
    if (!row) return res.status(404).json({ error: "Aucune localisation" });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur lecture localisation" });
  }
});

/**
 * @route POST /api/shops/me/location
 * @middleware authRequired
 * @summary Creates or updates the authenticated seller’s shop location (UPSERT).
 * @param {string} req.body.address - Full address of the shop.
 * @param {number} req.body.latitude - Latitude coordinate.
 * @param {number} req.body.longitude - Longitude coordinate.
 * @param {boolean} [req.body.is_public=false] - Visibility flag.
 * @returns {object} 200 - `{ success: true, location: {...} }`
 * @returns {object} 422 - `{ error: "address, latitude, longitude sont requis" }`
 * @returns {object} 500 - `{ error: "Erreur sauvegarde localisation" }`
 * @example
 * POST /api/shops/me/location
 * {
 *   "address": "Kampala Road, Uganda",
 *   "latitude": 0.315,
 *   "longitude": 32.58,
 *   "is_public": true
 * }
 */
router.post("/shops/me/location", authRequired, async (req, res) => {
  try {
    const { address, latitude, longitude, is_public } = req.body || {};
    if (
      typeof address !== "string" ||
      !address.trim() ||
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude))
    ) {
      return res
        .status(422)
        .json({ error: "address, latitude, longitude sont requis" });
    }

    const payload = {
      user_id: req.user.id,
      address: address.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      is_public: !!is_public,
    };

    const ok = await repo.upsert(payload);

    if (!ok) return res.json({ success: false });

    const saved = await repo.getByUserId(req.user.id);
    return res.json({ success: true, location: saved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur sauvegarde localisation" });
  }
});

/**
 * @route DELETE /api/shops/me/location
 * @middleware authRequired
 * @summary Deletes the current user’s saved shop location.
 * @returns {object} 200 - `{ success: true }`
 * @returns {object} 500 - `{ error: "Erreur suppression localisation" }`
 * @example
 * DELETE /api/shops/me/location
 */
router.delete("/shops/me/location", authRequired, async (req, res) => {
  try {
    const ok = await repo.removeByUserId(req.user.id);
    res.json({ success: ok });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur suppression localisation" });
  }
});

/**
 * @route GET /api/locations/debug/all
 * @summary Debug endpoint — returns latest 20 rows in `shop_locations`.
 * @returns {object} 200 - `{ db: string, rows: Array }`
 * @returns {object} 500 - `{ error: "debug failed", message, db }`
 * @example
 * GET /api/locations/debug/all
 */
router.get("/locations/debug/all", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,user_id,address,latitude,longitude,is_public,created_at,updated_at FROM shop_locations ORDER BY id DESC LIMIT 20"
    );
    res.json({ db: process.env.DB_NAME, rows });
  } catch (e) {
    console.error("[DEBUG ALL] error:", e.message);
    res.status(500).json({
      error: "debug failed",
      message: e.message,
      db: process.env.DB_NAME,
    });
  }
});

/**
 * @route GET /api/shops/me/location/debug
 * @middleware authRequired
 * @summary Debug endpoint — returns current user’s location record and database name.
 * @returns {object} 200 - `{ db, user_id, row }`
 * @returns {object} 500 - `{ error: "debug failed" }`
 * @example
 * GET /api/shops/me/location/debug
 */
router.get("/shops/me/location/debug", authRequired, async (req, res) => {
  try {
    const row = await repo.getByUserId(req.user.id);
    res.json({ db: process.env.DB_NAME, user_id: req.user.id, row });
  } catch (e) {
    console.error("[DEBUG ME] error:", e.message);
    res.status(500).json({
      error: "debug failed",
      message: e.message,
      db: process.env.DB_NAME,
    });
  }
});

module.exports = router;
