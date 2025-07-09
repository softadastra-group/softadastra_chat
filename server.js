const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors"); // ✅ Ajouté
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ✅ Middleware CORS pour accepter les requêtes venant du frontend PHP
app.use(cors());

// ✅ Route REST pour charger les anciens messages
const messagesRoute = require("./routes/messages");
app.use("/api/messages", messagesRoute);

// WebSocket logic
require("./ws/chat")(wss);

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur WebSocket lancé sur ws://localhost:${PORT}`);
});
