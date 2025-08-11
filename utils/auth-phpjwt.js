// utils/auth-phpjwt.js
const crypto = require("crypto");

/* base64url helpers (sans padding) */
function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function b64urlFromBuffer(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function b64urlToBuffer(b64u) {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64");
}

/* Vérifie la signature à la manière de ta classe PHP JWT */
function verifyPhpJwt(token, secret) {
  // format a.b.c
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Invalid token format");
  }
  const [headB64u, payB64u, sigB64u] = token.split(".");

  // recompute signature
  const signingInput = `${headB64u}.${payB64u}`;
  const hmac = crypto.createHmac("sha256", String(secret));
  hmac.update(signingInput);
  const expectedSigB64u = b64urlFromBuffer(hmac.digest());

  // compare signatures (constant-time)
  const a = Buffer.from(expectedSigB64u);
  const b = Buffer.from(sigB64u);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Signature mismatch");
  }

  // parse payload
  let payload;
  try {
    payload = JSON.parse(b64urlToBuffer(payB64u).toString("utf8"));
  } catch {
    throw new Error("Payload decode error");
  }

  // check exp if present
  if (payload && typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error("Token expired");
  }

  return payload; // OK
}

/* Middleware Express */
function authRequired(req, res, next) {
  try {
    // 1) header Authorization: Bearer ...
    let token = null;
    const h = req.headers.authorization || req.headers.Authorization;
    if (h && /^Bearer\s+/i.test(h)) {
      token = h.replace(/^Bearer\s+/i, "").trim();
    }
    // 2) cookie 'token' en fallback (si utile)
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const secret = process.env.JWT_SECRET || process.env.SECRET || "change_me";
    const payload = verifyPhpJwt(token, secret);

    // adapte selon ton payload (ex: payload.id)
    const userId = payload.id || payload.user_id || payload.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    req.user = { id: Number(userId), payload };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { authRequired, verifyPhpJwt };
