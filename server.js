const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path"); // ✅ AJOUT ICI
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ✅ Middleware CORS pour accepter les requêtes venant du frontend PHP
app.use(cors());

// ✅ Route REST pour charger les anciens messages
const messagesRoute = require("./routes/messages");
app.use("/api/messages", messagesRoute);

const uploadRoute = require("./routes/upload");
app.use(uploadRoute);
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

const notificationsRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationsRoutes);

const statusRoutes = require("./routes/status");
app.use("/api/status", statusRoutes);

// WebSocket logic
require("./ws/chat")(wss);

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur WebSocket lancé sur ws://localhost:${PORT}`);
});
