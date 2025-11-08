/**
 * @file utils/push.js
 * @description
 * Web Push Notification utility for the Softadastra platform.
 *
 * This module initializes and exports a configured instance of the
 * **Web Push** service using VAPID (Voluntary Application Server Identification)
 * credentials. It enables secure server-to-browser push notifications
 * through the Web Push API, compatible with service workers.
 *
 * ## Responsibilities
 * - Configure VAPID credentials for the `web-push` library.
 * - Provide a pre-configured `webpush` instance for sending push notifications.
 * - Serve as a central entry point for all server-side notification dispatch logic.
 *
 * ## Environment Variables
 * - `VAPID_SUBJECT` — Contact email or URL (e.g., `"mailto:admin@softadastra.com"`).
 * - `VAPID_PUBLIC` — Public VAPID key (shared with clients).
 * - `VAPID_PRIVATE` — Private VAPID key (kept secret on the server).
 *
 * ## Example
 * ```js
 * const { webpush } = require("./utils/push");
 *
 * // Example: Send a push notification
 * await webpush.sendNotification(
 *   {
 *     endpoint: subscription.endpoint,
 *     keys: subscription.keys,
 *   },
 *   JSON.stringify({
 *     title: "Softadastra",
 *     body: "You have a new message.",
 *     icon: "/icons/notification.png",
 *   })
 * );
 * ```
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Push_API
 * @see https://github.com/web-push-libs/web-push
 * @version 1.0.0
 * @license MIT
 */

const webpush = require("web-push");

// Configure Web Push VAPID credentials
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:gaspardkirira@softadastra.com",
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

/**
 * Exported, pre-configured `webpush` instance for global use.
 * Use this object to send browser push notifications securely.
 *
 * @type {import("web-push")}
 */
module.exports = { webpush };
