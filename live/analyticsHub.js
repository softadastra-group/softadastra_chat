/**
 * @file live/analyticsHub.js
 * @description
 * Real-time analytics hub for the Softadastra Chat and Marketplace ecosystem.
 *
 * This module ingests lightweight analytics events (via an internal API or WS),
 * aggregates short-lived counters in memory, and emits **live diffs** to
 * connected WebSocket clients every 2 seconds. It keeps only recent activity
 * (≈5 minutes) to remain CPU/memory efficient, relying on simple Maps/Sets.
 *
 * ## Responsibilities
 * - Track **active users** (“active now”) from recent anonymous activity.
 * - Collect **page hits** (views and unique visitors) for top paths.
 * - Monitor **funnel** steps: `product_view`, `add_to_cart`, `checkout_start`.
 * - Broadcast JSON messages over WebSocket:
 *   - `{ type: "active_now", count }`
 *   - `{ type: "top_pages_diff", rows: [{ path, views, visitors }] }`
 *   - `{ type: "funnel_diff", product_view, add_to_cart, checkout_start }`
 *
 * ## Event Contract
 * Incoming events are expected to follow this shape (extra props ignored):
 * ```ts
 * type AnalyticsEvent = {
 *   type: "pageview" | "product_view" | "event" | string;
 *   name?: "pageview" | "product_view" | "add_to_cart" | "checkout_start" | string;
 *   path?: string;        // URL or pathname
 *   anon_id?: string;     // anonymous visitor ID
 *   ts?: number;          // epoch ms; defaults to Date.now()
 * };
 * ```
 *
 * ## Lifecycle
 * - `onTrackEvent(evt)` — ingest a new analytics event.
 * - A background **2s timer** flushes diffs to all WS clients.
 * - `getActiveNow()` — current active user count (last 5 minutes).
 * - `dispose()` — stop the 2s timer and release resources.
 *
 * @version 1.0.0
 * @license MIT
 */

/**
 * Five minutes window (in ms) used to compute "active now".
 * @type {number}
 */
const FIVE_MIN = 5 * 60 * 1000;

/**
 * Set of event kinds that should be counted as page hits.
 * Includes native `"pageview"` and `"product_view"`.
 * @type {Set<string>}
 */
const TYPE_PAGE_HIT = new Set(["pageview", "product_view"]);

/**
 * Allowed funnel step names when `evt.type === "event"`.
 * @type {Set<string>}
 */
const FUNNEL_NAMES = new Set(["product_view", "add_to_cart", "checkout_start"]);

/**
 * Safe `Date.now()` indirection for easier testing/mocking.
 * @returns {number} Epoch milliseconds.
 */
function now() {
  return Date.now();
}

/**
 * Normalizes a URL or pathname to a clean pathname string (no query string).
 * Falls back gracefully on malformed inputs.
 *
 * @param {string} p - Raw path or absolute/relative URL.
 * @returns {string} Normalized pathname (defaults to "/").
 */
function normPath(p) {
  if (!p) return "/";
  try {
    if (p.startsWith("/")) return p.split("?")[0] || "/";
    const u = new URL(p, "http://dummy");
    return u.pathname || "/";
  } catch {
    return String(p).split("?")[0] || "/";
  }
}

/**
 * Factory that creates an in-memory, real-time analytics hub bound to a WebSocket server.
 *
 * @param {import("ws").Server} wssAnalytics - A `ws` WebSocket server instance used to broadcast diffs.
 * @returns {{
 *   onTrackEvent: (evt: any) => void,
 *   dispose: () => void,
 *   getActiveNow: () => number
 * }}
 * Public API: `onTrackEvent`, `dispose`, `getActiveNow`.
 */
module.exports = function makeAnalyticsHub(wssAnalytics) {
  /**
   * Accumulates page diffs since last flush.
   * key: pathname → { views: number(+Δ), visitors: number(+Δ) }
   * @type {Map<string, {views:number, visitors:number}>}
   */
  const pageDiff = new Map();

  /**
   * Tracks unique visitors per path for the current diff window.
   * key: pathname → Set(anon_id)
   * @type {Map<string, Set<string>>}
   */
  const pageSeen = new Map();

  /**
   * Last-seen timestamps for anonymous visitors (used for “active now”).
   * key: anon_id → last epoch ms
   * @type {Map<string, number>}
   */
  const lastSeen = new Map();

  /**
   * Aggregated funnel step deltas since the last broadcast.
   * @type {{product_view:number, add_to_cart:number, checkout_start:number}}
   */
  const funnelDiff = { product_view: 0, add_to_cart: 0, checkout_start: 0 };

  /**
   * Ingests a single analytics event and updates in-memory diffs.
   * Expected shape: `{ type, name?, path?, anon_id?, ts? }`.
   * Unknown or extra fields are ignored to keep ingestion resilient.
   *
   * @param {any} evt - Analytics event payload.
   * @returns {void}
   */
  function onTrackEvent(evt) {
    // evt expected: { type, name?, path?, anon_id?, ts? }
    if (!evt) return;
    const ts = evt.ts || now();

    // --- Active now ---
    if (evt.anon_id) lastSeen.set(evt.anon_id, ts);

    // --- Top pages ---
    const kind = String(evt.type || "").toLowerCase();
    const name = String(evt.name || "").toLowerCase();
    if (TYPE_PAGE_HIT.has(kind)) {
      const path = normPath(evt.path);
      let d = pageDiff.get(path);
      if (!d) {
        d = { views: 0, visitors: 0 };
        pageDiff.set(path, d);
      }
      d.views += 1;

      if (evt.anon_id) {
        let s = pageSeen.get(path);
        if (!s) {
          s = new Set();
          pageSeen.set(path, s);
        }
        s.add(evt.anon_id);
      }
    }

    // --- Funnel ---
    // Increment if:
    //  - type === 'product_view' (native)
    //  - or type === 'event' && name ∈ {product_view, add_to_cart, checkout_start}
    if (kind === "product_view") {
      funnelDiff.product_view += 1;
    } else if (kind === "event" && FUNNEL_NAMES.has(name)) {
      funnelDiff[name] += 1;
    }
  }

  /**
   * Background flusher (every 2 seconds):
   * - Emits `{type:"active_now", count}`.
   * - Emits `{type:"top_pages_diff", rows:[{path, views, visitors}]}` if any.
   * - Emits `{type:"funnel_diff", ...}` if any delta is non-zero, then resets deltas.
   *
   * @private
   */
  const timer = setInterval(() => {
    // ---- Active now ----
    const cutoff = now() - FIVE_MIN;
    let active = 0;
    for (const [aid, ts] of lastSeen) {
      if (ts >= cutoff) active++;
      else lastSeen.delete(aid);
    }
    try {
      const msg = JSON.stringify({ type: "active_now", count: active });
      wssAnalytics.clients.forEach((c) => {
        if (c.readyState === 1) c.send(msg);
      });
    } catch {}

    // ---- Top pages diff ----
    if (pageDiff.size > 0) {
      const rows = [];
      for (const [path, v] of pageDiff) {
        const uniq = pageSeen.get(path);
        rows.push({ path, views: v.views, visitors: uniq ? uniq.size : 0 });
      }
      pageDiff.clear();
      pageSeen.clear();
      try {
        const msg = JSON.stringify({ type: "top_pages_diff", rows });
        wssAnalytics.clients.forEach((c) => {
          if (c.readyState === 1) c.send(msg);
        });
      } catch {}
    }

    // ---- Funnel diff ----
    if (
      funnelDiff.product_view ||
      funnelDiff.add_to_cart ||
      funnelDiff.checkout_start
    ) {
      try {
        const msg = JSON.stringify({ type: "funnel_diff", ...funnelDiff });
        wssAnalytics.clients.forEach((c) => {
          if (c.readyState === 1) c.send(msg);
        });
      } catch {}
      // Reset funnel deltas after emitting
      funnelDiff.product_view = 0;
      funnelDiff.add_to_cart = 0;
      funnelDiff.checkout_start = 0;
    }
  }, 2000);

  /**
   * Stops the periodic flusher and cleans up timers.
   * Call this when the hub is no longer needed.
   *
   * @returns {void}
   */
  function dispose() {
    try {
      clearInterval(timer);
    } catch {}
  }

  /**
   * Computes the number of currently active users (last 5 minutes).
   * This does not perform any I/O; it inspects the in-memory `lastSeen` map.
   *
   * @returns {number} Active anonymous users observed in the last 5 minutes.
   */
  function getActiveNow() {
    const cutoff = now() - FIVE_MIN;
    let active = 0;
    for (const ts of lastSeen.values()) if (ts >= cutoff) active++;
    return active;
  }

  return { onTrackEvent, dispose, getActiveNow };
};
