// api/link.js — "sign in with wingmic" for the /bay score cards: the token exchange.
//   POST { key, profile? } → 200 { linked: true, captured, note? }
//
// wingmic v1 issues scoped wk_live_ keys in its dashboard (the magic-link sign-in
// happens over there); there is no oauth endpoint to redirect through, so the exchange
// is honest about its shape: the visitor pastes the key here, this handler probes the
// real api once (verify), and on success the browser keeps the key for the session and
// sends it to /api/score, which reads network overlap through the same client. the key
// is never written to disk or logged here.
//
// profile (optional) is the throwaway profile text from the paste path. when present
// and the key carries capture:write, the claim pushes it into the owner's wingmic graph
// via POST /api/v1/capture — the map feeding captures back, per the spec. best effort:
// a key without the scope or an extraction outage leaves the link standing without the
// capture, and the response says so instead of pretending.

const { ENV } = require("./_env.js");
const log = require("./_log.js");
const { clientIp, limiter } = require("./_ratelimit.js");
const crypto = require("node:crypto");
const { makeWingmicClient, WingmicAuthError } = require("./_wingmic.js");

const rate = limiter({ perHour: ENV.wingmicLinkPerHour });

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const KEY_RE = /^[A-Za-z0-9_-]{8,256}$/;
const PROFILE_MAX = 4000;

// stable retry id so a double-clicked link does not capture the profile twice
const captureIdFor = (text) => "bay-claim-" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return json(res, 405, { error: "method_not_allowed" });
  }

  const ip = clientIp(req);
  if (!rate.take(ip)) return json(res, 429, { error: "rate_limited", message: "slow down. try again in a few minutes." });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  if (!body || typeof body !== "object") return json(res, 400, { error: "bad_request" });

  const key = typeof body.key === "string" && KEY_RE.test(body.key) ? body.key : null;
  if (!key) return json(res, 400, { error: "bad_request", message: "paste your wingmic key (it starts with wk_live_)" });
  const raw = typeof body.profile === "string" ? body.profile.trim().slice(0, PROFILE_MAX) : "";

  const client = makeWingmicClient(ENV);
  if (!client) return json(res, 503, { error: "wingmic_unavailable", message: "wingmic sign-in is not live on this deployment" });

  let v;
  try {
    v = await client.verify(key);
  } catch (e) {
    log.warn("link.verify", { err: e });
    return json(res, 503, { error: "wingmic_down", message: "wingmic is unreachable right now; try again soon" });
  }
  if (!v.ok) {
    if (v.reason === "missing_scope") {
      return json(res, 403, {
        error: "wingmic_scope",
        message: `that key is missing the ${v.missingScope} scope; create one with network search in the wingmic dashboard`,
        missingScope: v.missingScope,
      });
    }
    if (v.reason === "rate_limited") {
      return json(res, 429, { error: "wingmic_rate_limited", message: "wingmic is rate limiting that key; try again in a minute" });
    }
    return json(res, 401, { error: "wingmic_auth", message: "that wingmic key did not resolve; create a fresh one in the dashboard" });
  }

  // the claim: push the throwaway profile into the owner's graph. false means it did
  // not land; the link itself stands either way and the note says which happened.
  let captured = false;
  let note;
  if (raw) {
    try {
      captured = await client.capture(key, { text: raw, id: captureIdFor(raw) });
    } catch (e) {
      if (e instanceof WingmicAuthError) {
        return json(res, 401, { error: "wingmic_auth", message: "that wingmic key did not resolve; create a fresh one in the dashboard" });
      }
      log.warn("link.capture", { err: e });
      captured = false;
    }
    if (!captured) note = "linked, but your profile did not make it into your wingmic graph (the key may lack capture access). your network still rides along.";
  }

  log.info("link", { ip, captured });
  return json(res, 200, { linked: true, captured, ...(note ? { note } : {}) });
};
