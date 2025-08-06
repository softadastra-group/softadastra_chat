const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());

const messagesRoute = require("./routes/messages");
app.use("/api/messages", messagesRoute);

const uploadRoute = require("./routes/upload");
app.use(uploadRoute);
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

const notificationsRoutes = require("./routes/notifications");
app.use("/api/notifications", notificationsRoutes);

const statusRoutes = require("./routes/status");
app.use("/api/status", statusRoutes);

require("./ws/chat")(wss);

const PORT = process.env.PORT || 3000;

const fs = require("fs");

app.get("/", (req, res) => {
  res.json({
    message: "Hello from Softadastra Node.js API!",
    time: new Date().toISOString(),
  });
});

app.get("/test", (req, res) => {
  res.send(`
    <html>
      <head><title>Test Node</title></head>
      <body>
        <h1>✅ Serveur Node.js opérationnel</h1>
        <p>Date actuelle : ${new Date().toLocaleString()}</p>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log(`✅ Serveur WebSocket lancé sur ws://localhost:${PORT}`);
});
