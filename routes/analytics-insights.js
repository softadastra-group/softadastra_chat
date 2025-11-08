/**
 * @file routes/analytics.js
 * @description
 * REST API routes for Softadastra's analytics system — providing insights into
 * user engagement, funnel performance, retention, and geo distribution (DAU/MAU,
 * live activity, cohorts, top pages, countries).
 *
 * ## Responsibilities
 * - Compute **DAU/MAU** and **Active Now** (last 5 minutes).
 * - Aggregate **Top pages (24h)**.
 * - Analyze **basic funnels**: product_view → add_to_cart → checkout_start.
 * - Build **retention cohorts** (J+0..J+6) from sessions & pageviews.
 * - Aggregate **country-level usage** derived from locale.
 *
 * ## Security
 * - Most routes are protected with `authRequired` (JWT via PHP-compatible middleware).
 * - Some routes are left open for testing but should be secured in production.
 *
 * ## Tables
 * - `sa_pageviews(anon_id, event_time_utc, path, query, referrer, …)`
 * - `sa_events(event_id, anon_id, event_time_utc, name, path, payload, …)`
 * - `sa_sessions(anon_id, first_seen_utc, last_seen_utc, locale, …)`
 *
 * @example
 * // Fetch analytics overview (requires Authorization header)
 * fetch('/api/analytics/overview', {
 *   headers: { Authorization: `Bearer ${token}` }
 * }).then(r => r.json());
 *
 * @see utils/auth-phpjwt.js  Authentication middleware (JWT)
 * @see db/mysql.js           MySQL connection pool (mysql2/promise)
 */

const express = require("express");
const router = express.Router();
const pool = require("../db/mysql");
const { authRequired } = require("../utils/auth-phpjwt");

/**
 * GET /api/analytics/overview
 * @summary Returns DAU series (30 days), MAU (30d), and live active users (5 min window).
 * @security BearerAuth
 * @returns {object} 200 - { dau: Array<{d: string, dau: number}>, mau: number, active_now: number }
 */
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

/**
 * GET /api/analytics/top-pages
 * @summary Top 50 visited pages in the last 24 hours (views + unique visitors).
 * @security BearerAuth
 * @returns {object} 200 - { pages: Array<{path: string, views: number, visitors: number}> }
 */
router.get("/top-pages", authRequired, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT path, COUNT(*) views, COUNT(DISTINCT anon_id) visitors
     FROM sa_pageviews
     WHERE event_time_utc >= (UTC_TIMESTAMP() - INTERVAL 1 DAY)
     GROUP BY path ORDER BY views DESC LIMIT 50`
  );
  res.json({ pages: rows });
});

/**
 * GET /api/analytics/funnels/basic
 * @summary 7-day basic funnel counts.
 * @description Counts events for keys: product_view, add_to_cart, checkout_start.
 * @security BearerAuth
 * @returns {object} 200 - { product_view: number, add_to_cart: number, checkout_start: number }
 */
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

/**
 * Lightweight range parser for quick filtering windows.
 * @param {"24h"|"7d"|"30d"} range
 * @returns {{start: Date, end: Date}}
 */
function parseRange(range = "7d") {
  const now = new Date();
  let start = new Date(now);
  if (range === "24h") start.setDate(now.getDate() - 1);
  else if (range === "30d") start.setDate(now.getDate() - 30);
  else start.setDate(now.getDate() - 7);
  return { start, end: now };
}

/**
 * GET /api/analytics/cohorts?range=7d
 * @summary Builds 7 daily cohorts (D-6..D) and retention J+0..J+6 for each cohort.
 * @description
 * - Denominator: distinct users by `DATE(first_seen_utc)`.
 * - Numerator: distinct users returning on J days based on pageviews.
 * - Output `d` is an array of retention ratios per J (0..6).
 * @returns {object} 200 - { cohorts: Array<{day: string, users: number, d: number[]}> }
 */
router.get(
  "/cohorts",
  /*authRequired,*/ async (req, res) => {
    try {
      const range = String(req.query.range || "7d");
      // Window of cohorts: last 7 days (D-6..D)
      const end = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - 6);

      // Denominator: users by cohort day
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

      // Numerator: retention J (0..6), sessions join pageviews
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

      const denoMap = new Map(); // 'YYYY-MM-DD' -> users
      denoRows.forEach((r) =>
        denoMap.set(String(r.cohort_day), Number(r.users))
      );

      const retMap = new Map(); // cohort_day -> { j: users_retained }
      retRows.forEach((r) => {
        const day = String(r.cohort_day);
        const j = Number(r.j);
        const u = Number(r.users_retained);
        if (!retMap.has(day)) retMap.set(day, {});
        retMap.get(day)[j] = u;
      });

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

/**
 * GET /api/analytics/countries?range=7d
 * @summary Aggregates users by country (derived from `locale`, e.g., `en-US` → `US`).
 * @returns {object} 200 - { countries: Array<{code: string, name: string, users: number}> }
 */
router.get(
  "/countries",
  /*authRequired,*/ async (req, res) => {
    try {
      const { start } = parseRange(String(req.query.range || "7d"));

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

      /**
       * Maps a BCP-47 locale to a country code and display name.
       * @param {string} locale
       * @returns {{code: string, name: string}}
       */
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
