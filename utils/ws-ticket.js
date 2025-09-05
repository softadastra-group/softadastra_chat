// utils/ws-ticket.js
const crypto = require("crypto");

const TICKET_TTL_SEC = 60; // ticket valable 60s

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(input, secret) {
  const h = crypto.createHmac("sha256", String(secret));
  h.update(input);
  return b64url(h.digest());
}

function createWsTicket(userId, secret) {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random();
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  const payload = `${id}.${userId}.${exp}`;
  const sig = sign(payload, secret);
  return `${payload}.${sig}`; // id.userId.exp.sig
}

function verifyWsTicket(ticket, secret) {
  if (typeof ticket !== "string") return null;
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const [id, userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = sign(`${id}.${userId}.${exp}`, secret);
  const a = Buffer.from(expected),
    b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id, userId: Number(userId), exp };
}

module.exports = { createWsTicket, verifyWsTicket };
