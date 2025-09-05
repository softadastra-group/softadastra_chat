// live/analyticsHub.js
const FIVE_MIN = 5 * 60 * 1000;

// live/analyticsHub.js
const TYPE_PAGE_HIT = new Set(["pageview", "product_view"]);
const FUNNEL_NAMES = new Set(["product_view", "add_to_cart", "checkout_start"]);

function onTrackEvent(evt) {
  if (!evt) return;
  const ts = evt.ts || now();
  const kind = String(evt.type || "").toLowerCase();
  const name = String(evt.name || "").toLowerCase();

  // --- Active now ---
  if (evt.anon_id) lastSeen.set(evt.anon_id, ts);

  // --- Top pages: accepte aussi event+pageview ---
  const isPageHit =
    TYPE_PAGE_HIT.has(kind) || (kind === "event" && name === "pageview");
  if (isPageHit) {
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
  if (kind === "product_view") {
    funnelDiff.product_view += 1;
  } else if (kind === "event" && FUNNEL_NAMES.has(name)) {
    funnelDiff[name] += 1;
  }
}

function now() {
  return Date.now();
}
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

module.exports = function makeAnalyticsHub(wssAnalytics) {
  // Diffs Top pages accumulés entre deux flush
  const pageDiff = new Map(); // path -> { views:+n, visitors:+m }
  const pageSeen = new Map(); // path -> Set(anon_id) (uniques depuis dernier flush)

  // Cache "active now"
  const lastSeen = new Map(); // anon_id -> last ts

  // Diffs Funnel
  const funnelDiff = { product_view: 0, add_to_cart: 0, checkout_start: 0 };

  function onTrackEvent(evt) {
    // evt attendu: { type, name?, path?, anon_id?, ts? }
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
    // On incrémente si:
    //  - type === 'product_view'  (ex: auto depuis la page produit)
    //  - ou type === 'event' + name ∈ {product_view, add_to_cart, checkout_start}
    if (kind === "product_view") {
      funnelDiff.product_view += 1;
    } else if (kind === "event" && FUNNEL_NAMES.has(name)) {
      funnelDiff[name] += 1;
    }
  }

  // Flush toutes les 2s: active_now, top_pages_diff, funnel_diff
  const timer = setInterval(() => {
    // Active now
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

    // Top pages diff
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

    // Funnel diff
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
      // reset
      funnelDiff.product_view = 0;
      funnelDiff.add_to_cart = 0;
      funnelDiff.checkout_start = 0;
    }
  }, 2000);

  function dispose() {
    try {
      clearInterval(timer);
    } catch {}
  }

  function getActiveNow() {
    const cutoff = now() - FIVE_MIN;
    let active = 0;
    for (const ts of lastSeen.values()) if (ts >= cutoff) active++;
    return active;
  }

  return { onTrackEvent, dispose, getActiveNow };
};
