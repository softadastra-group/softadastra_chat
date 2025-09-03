// utils/ws-auth.js
const { verifyPhpJwt } = require("./auth-phpjwt");

function parseQS(u = "") {
  const i = u.indexOf("?");
  if (i < 0) return {};
  return Object.fromEntries(new URLSearchParams(u.slice(i + 1)));
}

function wsIsAdmin(req) {
  try {
    const q = parseQS(req.url || "");

    if (q.token) {
      const payload = verifyPhpJwt(
        q.token,
        process.env.JWT_SECRET || process.env.SECRET || "change_me"
      );
      const role = String(payload?.role || payload?.r || "").toLowerCase();

      // ✅ autorise admin ET user
      if (role === "admin" || role === "user") return true;

      return false;
    }

    // Pont dev: autorise x-user-id si présent (et optionnellement filtre Origin)
    if (q["x-user-id"] && /^\d+$/.test(String(q["x-user-id"]))) {
      const origin = String(req.headers.origin || req.headers.referer || "");
      const trusted = (
        process.env.ADMIN_ORIGINS ||
        "http://localhost:8000,http://127.0.0.1:8000"
      )
        .split(",")
        .map((s) => s.trim());

      // si tu veux vraiment restreindre:
      // return trusted.some((base) => origin.startsWith(base));
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

module.exports = { wsIsAdmin };
