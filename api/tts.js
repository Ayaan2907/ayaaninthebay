// /api/tts: text → speech for the /call feature. Puter's txt2speech with MY token (free on a free
// account, ~400 ms, Polly voices). POST { text } → audio/mpeg bytes. Env: TTS_VOICE (default Matthew).
const { ENV } = require("./_env.js");
const log = require("./_log.js");
const { clientIp, limiter } = require("./_ratelimit.js");
const P = require("./_puter.js");
const VOICE = ENV.ttsVoice;
const rate = limiter({ perHour: ENV.ttsPerHour });

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  if (!ENV.puterAuthToken) { res.statusCode = 503; return res.end("no tts"); }
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String((body && body.text) || "").trim().slice(0, 600);
  if (!text) { res.statusCode = 400; return res.end("no text"); }
  const ip = clientIp(req);
  if (!rate.take(ip)) { res.statusCode = 429; return res.end("slow down"); }
  try {
    const a = await P.puter().ai.txt2speech(text, { voice: VOICE, engine: "neural", language: "en-US" });
    const src = a && a.src ? String(a.src) : "";
    const m = /^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i.exec(src);
    if (!m) throw new Error("unexpected tts response");
    const buf = Buffer.from(m[2], "base64");
    res.statusCode = 200;
    res.setHeader("content-type", m[1]);
    res.setHeader("cache-control", "no-store");
    res.end(buf);
  } catch (e) {
    log.error("tts", { ip, err: e });
    res.statusCode = 502; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: String(e.message || e).slice(0, 200) }));
  }
};
