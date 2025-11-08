/**
 * @file routes/webpush.js
 * @description
 * Public endpoint exposing the **VAPID public key** for Web Push subscriptions.
 *
 * This route is typically consumed by the frontend (Service Worker or PWA)
 * to register push notifications using the Web Push API.
 *
 * ## Responsibilities
 * - Expose the server’s `VAPID_PUBLIC` key from environment variables.
 * - Ensure that no sensitive data (private key) is ever returned.
 *
 * ## Environment Variables
 * - `VAPID_PUBLIC`: The public VAPID key (Base64-encoded, URL-safe).
 *
 * ## Example (frontend)
 * ```js
 * const res = await fetch("/api/webpush/public-key");
 * const { publicKey } = await res.json();
 * const key = urlBase64ToUint8Array(publicKey);
 * const subscription = await registration.pushManager.subscribe({
 *   userVisibleOnly: true,
 *   applicationServerKey: key,
 * });
 * ```
 *
 * @module routes/webpush
 */
const express = require("express");
const router = express.Router();

/**
 * @route GET /api/webpush/public-key
 * @summary Returns the VAPID public key used for Web Push notifications.
 * @returns {object} 200 - `{ publicKey: string }`
 * @example
 * // Example response:
 * { "publicKey": "BKHp8C5Y2wW4bW_0Gd0gQeN..." }
 */
router.get("/public-key", (_, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC || "" });
});

module.exports = router;
