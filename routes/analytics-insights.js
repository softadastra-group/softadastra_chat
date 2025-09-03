// routes/analytics-insights.js
const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");
const { authRequired } = require("../utils/auth-phpjwt");

// DAU/MAU + active now (visiteurs vus <5 min)
router.get("/overview", authRequired, async (req, res) => {
  const [dau] = await pool.query(
    `SELECT DATE(event_time_utc) d, COUNT(DISTINCT anon_id) dau
     FROM sa_pageviews
     WHERE event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)
     GROUP BY d ORDER BY d DESC LIMIT 30`
  );
  const [mau] = await pool.query(
    `SELECT COUNT(DISTINCT anon_id) mau
     FROM sa_pageviews WHERE event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)`
  );
  const [activeNow] = await pool.query(
    `SELECT COUNT(DISTINCT anon_id) nowc
     FROM sa_pageviews WHERE event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 5 MINUTE)`
  );
  res.json({ dau, mau: mau[0]?.mau || 0, active_now: activeNow[0]?.nowc || 0 });
});

// Top pages 24h
router.get("/top-pages", authRequired, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT path, COUNT(*) views, COUNT(DISTINCT anon_id) visitors
     FROM sa_pageviews
     WHERE event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 1 DAY)
     GROUP BY path ORDER BY views DESC LIMIT 50`
  );
  res.json({ pages: rows });
});

// Funnels simples (ex: product_view -> add_to_cart -> checkout_start)
router.get("/funnels/basic", authRequired, async (req, res) => {
  const [pv] = await pool.query(
    `SELECT COUNT(*) c FROM sa_events WHERE name='product_view' AND event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)`
  );
  const [atc] = await pool.query(
    `SELECT COUNT(*) c FROM sa_events WHERE name='add_to_cart' AND event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)`
  );
  const [co] = await pool.query(
    `SELECT COUNT(*) c FROM sa_events WHERE name='checkout_start' AND event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 7 DAY)`
  );
  res.json({
    product_view: pv[0]?.c || 0,
    add_to_cart: atc[0]?.c || 0,
    checkout_start: co[0]?.c || 0,
  });
});

// Parse range -> fenêtre temporelle
function parseRange(range = "7d") {
  const now = new Date();
  let start = new Date(now);
  if (range === "24h") start.setDate(now.getDate() - 1);
  else if (range === "30d") start.setDate(now.getDate() - 30);
  else start.setDate(now.getDate() - 7); // 7d par défaut
  return { start, end: now };
}

// ---------- GET /api/analytics/cohorts?range=7d ----------
// Calcule des cohortes par jour de 1ère vue (sa_sessions.first_seen_utc)
// et la rétention J+0..J+6 basée sur sa_pageviews.event_time_utc
router.get(
  "/cohorts",
  /*authRequired,*/ async (req, res) => {
    try {
      const range = String(req.query.range || "7d");
      // Fenêtre de cohortes: on prend les 7 derniers jours (cohortes)
      const end = new Date(); // aujourd’hui
      const start = new Date(end);
      start.setDate(end.getDate() - 6); // 7 cohortes (D-6 ... D)

      // Denominator: nombre d'utilisateurs par cohorte (distinct anon_id)
      const [denoRows] = await pool.query(
        `
      SELECT DATE(first_seen_utc) AS cohort_day,
             COUNT(DISTINCT anon_id) AS users
      FROM sa_sessions
      WHERE first_seen_utc >= ? AND first_seen_utc < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 14
      `,
        [start]
      );

      if (!denoRows.length) {
        return res.json({ cohorts: [] });
      }

      // Numerator: rétention J (join sessions->pageviews)
      // j = DATEDIFF(date(pageview), date(first_seen))
      const [retRows] = await pool.query(
        `
      SELECT
        DATE(s.first_seen_utc) AS cohort_day,
        DATEDIFF(DATE(p.event_time_utc), DATE(s.first_seen_utc)) AS j,
        COUNT(DISTINCT s.anon_id) AS users_retained
      FROM sa_sessions s
      JOIN sa_pageviews p
        ON p.anon_id = s.anon_id
      WHERE s.first_seen_utc >= ?
        AND s.first_seen_utc < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND p.event_time_utc >= s.first_seen_utc
        AND DATEDIFF(DATE(p.event_time_utc), DATE(s.first_seen_utc)) BETWEEN 0 AND 6
      GROUP BY 1,2
      ORDER BY 1 DESC, 2 ASC
      `,
        [start]
      );

      // Indexer les denos
      const denoMap = new Map(); // key: 'YYYY-MM-DD' -> users
      denoRows.forEach((r) =>
        denoMap.set(String(r.cohort_day), Number(r.users))
      );

      // Construire map cohort_day -> { j -> users_retained }
      const retMap = new Map();
      retRows.forEach((r) => {
        const day = String(r.cohort_day);
        const j = Number(r.j);
        const u = Number(r.users_retained);
        if (!retMap.has(day)) retMap.set(day, {});
        retMap.get(day)[j] = u;
      });

      // Générer la liste des cohortes (du plus récent au plus ancien, max 7)
      // Si une cohorte n'a pas de retention pour un j, on met 0
      const cohorts = Array.from(denoMap.keys())
        .sort((a, b) => (a < b ? 1 : -1)) // desc
        .slice(0, 7)
        .map((day) => {
          const users = denoMap.get(day) || 0;
          const retForDay = retMap.get(day) || {};
          const d = [];
          for (let j = 0; j <= 6; j++) {
            const num = retForDay[j] || 0;
            d.push(users > 0 ? num / users : 0);
          }
          return { day, users, d };
        });

      return res.json({ cohorts });
    } catch (e) {
      console.error("cohorts error:", e);
      return res.status(500).json({ error: "server" });
    }
  }
);

// ---------- GET /api/analytics/countries?range=7d ----------
// Agrège par pays basé sur sa_sessions.locale (ex: 'fr', 'en-US' → 'US')
// (si tu as un champ pays dédié en base, adapte la requête)
router.get(
  "/countries",
  /*authRequired,*/ async (req, res) => {
    try {
      const { start } = parseRange(String(req.query.range || "7d"));

      // On part de sa_sessions.last_seen_utc dans la fenêtre
      const [rows] = await pool.query(
        `
      SELECT
        s.locale,
        COUNT(DISTINCT s.anon_id) AS users
      FROM sa_sessions s
      WHERE s.last_seen_utc >= ?
      GROUP BY s.locale
      ORDER BY users DESC
      LIMIT 50
      `,
        [start]
      );

      // Map locale -> country code/name
      function localeToCountry(locale) {
        if (!locale) return { code: "??", name: "Unknown" };
        const str = String(locale);
        // 'fr'     -> ?? (Unknown)
        // 'en-US'  -> US
        // 'pt-BR'  -> BR
        const m = str.match(/^[a-zA-Z]{2,3}-([A-Za-z]{2})$/);
        const code = m ? m[1].toUpperCase() : "??";
        const names = {
          US: "United States",
          FR: "France",
          GB: "United Kingdom",
          DE: "Germany",
          NG: "Nigeria",
          KE: "Kenya",
          UG: "Uganda",
          CA: "Canada",
          BR: "Brazil",
          ES: "Spain",
          IT: "Italy",
          IN: "India",
        };
        return {
          code,
          name: names[code] || (code !== "??" ? code : "Unknown"),
        };
      }

      const countries = rows.map((r) => {
        const { code, name } = localeToCountry(r.locale);
        return { code, name, users: Number(r.users || 0) };
      });

      return res.json({ countries });
    } catch (e) {
      console.error("countries error:", e);
      return res.status(500).json({ error: "server" });
    }
  }
);

module.exports = router;
