// routes/shopLocations.js
const express = require("express");
const router = express.Router();

const pool = require("../db/mysql"); // ✅ important pour les routes debug
const { authRequired } = require("../utils/auth-phpjwt");
const ShopLocationRepository = require("../repositories/ShopLocationRepository");
const repo = new ShopLocationRepository();

// --------- Public ---------

// GET /api/locations/public?limit=&offset=
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

// GET /api/locations/bbox?minLat=&maxLat=&minLng=&maxLng=&limit=&offset=
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

// GET /api/locations/near?lat=&lng=&radiusKm=&limit=&offset=
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

// --------- Authentifié (CRUD par vendeur) ---------

// GET /api/shops/me/location
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

// POST /api/shops/me/location   (body: {address, latitude, longitude, is_public})
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

    // log utile (peut être retiré en prod)
    console.log("[SHOP LOC UPSERT]", {
      db: process.env.DB_NAME,
      user_id: payload.user_id,
      address: payload.address,
      lat: payload.latitude,
      lng: payload.longitude,
      is_public: payload.is_public,
      success: ok,
    });

    if (!ok) return res.json({ success: false });

    // relire en base ce qui a été écrit pour renvoyer la vérité serveur
    const saved = await repo.getByUserId(req.user.id);
    return res.json({ success: true, location: saved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur sauvegarde localisation" });
  }
});

// DELETE /api/shops/me/location
router.delete("/shops/me/location", authRequired, async (req, res) => {
  try {
    const ok = await repo.removeByUserId(req.user.id);
    res.json({ success: ok });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur suppression localisation" });
  }
});

// --------- Debug (temporaire, à retirer en prod) ---------

// A. Liste brute (20 dernières)
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

// B. Votre ligne (liée au token)
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
