const webpush = require("web-push");

webpush.setVapidDetails(
	  process.env.VAPID_SUBJECT || "mailto:gaspardkirira@softadastra.com",
	  process.env.VAPID_PUBLIC,
	  process.env.VAPID_PRIVATE
);

module.exports = { webpush };
