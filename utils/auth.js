const jwt = require("jsonwebtoken");

function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || req.headers.Authorization;
    if (!h || !/^Bearer\s+/i.test(h)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = h.replace(/^Bearer\s+/i, "").trim();
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id }; // adapte si ton payload est différent
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { authRequired };
