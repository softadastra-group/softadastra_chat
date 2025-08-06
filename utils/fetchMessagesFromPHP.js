const fetch = require("node-fetch");

async function fetchMessagesFromPHP() {
  try {
    const res = await fetch("https://softadastra.com/api/messages.php");
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || "Erreur côté PHP");
    }

    return data.messages;
  } catch (err) {
    console.error("Erreur Node.js (fetchMessagesFromPHP) :", err.message);
    throw err;
  }
}

module.exports = fetchMessagesFromPHP;
