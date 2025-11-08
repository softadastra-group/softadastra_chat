/**
 * @file utils/ws-ticket.js
 * @description
 * Utility module for generating and verifying short-lived, signed WebSocket access tickets.
 *
 * These tickets are lightweight, HMAC-signed tokens that allow clients to
 * securely authenticate a WebSocket connection without exposing persistent
 * JWT tokens. Each ticket is valid for a short time window (default: 60 seconds).
 *
 * ## Responsibilities
 * - Generate **time-limited WebSocket tickets** (`createWsTicket()`).
 * - Verify ticket authenticity and expiration (`verifyWsTicket()`).
 * - Prevent replay attacks by enforcing strict TTL validation.
 * - Use HMAC-SHA256 signing for integrity protection.
 *
 * ## Ticket Structure
 * ```
 * <uuid>.<userId>.<exp>.<signature>
 * ```
 * - `uuid` — Randomly generated ticket ID.
 * - `userId` — Numeric user identifier.
 * - `exp` — Expiration timestamp in seconds (Unix epoch).
 * - `signature` — HMAC-SHA256 over `<uuid>.<userId>.<exp>` using the shared secret.
 *
 * ## Example
 * ```js
 * const { createWsTicket, verifyWsTicket } = require("./utils/ws-ticket");
 *
 * const secret = process.env.WS_SECRET || "change_me";
 *
 * // Issue a ticket valid for 60s
 * const ticket = createWsTicket(123, secret);
 * console.log("Generated ticket:", ticket);
 *
 * // Later, on the WebSocket server:
 * const verified = verifyWsTicket(ticket, secret);
 * if (verified) {
 *   console.log("Ticket OK:", verified.userId);
 * } else {
 *   console.log("Invalid or expired ticket");
 * }
 * ```
 *
 * @see https://datatracker.ietf.org/doc/html/rfc2104 (HMAC)
 * @version 1.0.0
 * @license MIT
 */

const crypto = require("crypto");

/**
 * Ticket validity duration in seconds (default: 60 seconds).
 * @type {number}
 */
const TICKET_TTL_SEC = 60;

/**
 * Converts a buffer to a URL-safe Base64 string (RFC 4648 §5).
 *
 * @param {Buffer|string} buf - Input buffer or string.
 * @returns {string} Base64URL-encoded string.
 */
function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Computes an HMAC-SHA256 signature for a given input and secret.
 *
 * @param {string} input - The data to sign.
 * @param {string} secret - The shared secret key.
 * @returns {string} Base64URL-encoded HMAC signature.
 */
function sign(input, secret) {
  const h = crypto.createHmac("sha256", String(secret));
  h.update(input);
  return b64url(h.digest());
}

/**
 * Creates a new short-lived WebSocket access ticket.
 *
 * @param {number|string} userId - ID of the user requesting the ticket.
 * @param {string} secret - Shared secret used for signing.
 * @returns {string} A signed ticket string (`<uuid>.<userId>.<exp>.<sig>`).
 */
function createWsTicket(userId, secret) {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random();
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  const payload = `${id}.${userId}.${exp}`;
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Verifies the integrity and validity of a WebSocket ticket.
 *
 * @param {string} ticket - Ticket string to verify.
 * @param {string} secret - Shared secret used for signing.
 * @returns {{
 *   id: string,
 *   userId: number,
 *   exp: number
 * } | null}
 * Returns the decoded ticket data if valid; otherwise `null` for invalid or expired tickets.
 */
function verifyWsTicket(ticket, secret) {
  if (typeof ticket !== "string") return null;
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;

  const [id, userId, expStr, sig] = parts;
  const exp = Number(expStr);

  // Expiration check
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;

  // Recompute signature and compare securely
  const expected = sign(`${id}.${userId}.${exp}`, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { id, userId: Number(userId), exp };
}

module.exports = { createWsTicket, verifyWsTicket };
