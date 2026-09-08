// Liveness probe for Railway. No upstream calls, no secrets. Says which features are wired.
const { ENV } = require("./_env.js");

module.exports = function handler(req, res) {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({
    status: "ok",
    chat: ENV.chatProvider !== "none",
    build: ENV.buildMode,
    call: !!ENV.puterAuthToken,
    uptime: Math.round(process.uptime()),
  }));
};
