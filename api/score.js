// api/score.js, one event, scored for one viewer.
//   GET  → { ai, provider, model, wingmic }, what this deployment can do, before the client asks.
//   POST { eventId, goal?, profile? | source? | wingmicToken? } → the scored event card payload.
//
// pipeline (spec art_LkglG0Xb): retrieval over the live event store → typed scorer
// (deterministic weights, always the anchor) → explanations. the explain stage is one
// structured-output llm call when the ai provider is on, deterministic templates otherwise;
// either way the typed pass anchors the number. the wingmic side rides the client boundary
// in api/_wingmic.js: the real client talks to public REST v1 when WINGMIC_BASE_URL is set,
// the mock only when WINGMIC_MOCK=on, and production without wiring keeps the anonymous ask
// path working.

const { ENV } = require("./_env.js");
const log = require("./_log.js");
const { clientIp, limiter } = require("./_ratelimit.js");
const P = require("./_puter.js");
const bay = require("./_baydata.js");
const scoring = require("./_scoring.js");
const { makeWingmicClient, overlapSafely, WingmicAuthError } = require("./_wingmic.js");

const rate = limiter({ perHour: ENV.scorePerHour });
const wingmic = makeWingmicClient(ENV);

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const provider = () => ENV.chatProvider;
const aiOn = () => provider() !== "none";

// the explain stage's model call. puter rides the shared client; anthropic is one plain
// fetch, mirroring api/chat.js without the stream (a score is one json object).
async function scoreChat(messages) {
  if (provider() === "puter") return P.chat(messages, { model: ENV.chatModel, timeout: 30e3 });
  if (provider() === "anthropic" && ENV.anthropicApiKey) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ENV.anthropicApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ENV.anthropicModel, max_tokens: 700, system: messages[0].content, messages: messages.slice(1) }),
    });
    if (!r.ok) throw new Error("anthropic " + r.status);
    const j = await r.json();
    return (j.content || []).map((c) => c.text || "").join("");
  }
  throw new Error("no ai provider");
}

const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,256}$/;

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return json(res, 200, {
      ai: aiOn(),
      provider: provider(),
      model: provider() === "puter" ? ENV.chatModel : provider() === "anthropic" ? ENV.anthropicModel : null,
      wingmic: wingmic ? wingmic.label : "unavailable",
    });
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
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

  const eventId = String(body.eventId || "");
  if (!EVENT_ID_RE.test(eventId)) return json(res, 400, { error: "bad_request", message: "eventId is required" });
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 400) : "";
  const wingmicToken = typeof body.wingmicToken === "string" && TOKEN_RE.test(body.wingmicToken) ? body.wingmicToken : null;

  // resolve the event from the live set, same store and expiry rule as /api/events.
  const store = bay.loadStoreOrSeed(ENV.dataDir, "events");
  const known = store.records.find((e) => e.id === eventId);
  const { live } = bay.liveFilter(store.records);
  const event = live.find((e) => e.id === eventId);
  if (!event) {
    return known ? json(res, 410, { error: "expired_event", message: "this event is over" }) : json(res, 404, { error: "unknown_event" });
  }

  // profile resolution: wingmic token first, then a structured profile, then the raw ask.
  let profile;
  let kind;
  if (wingmicToken) {
    if (!wingmic) {
      return json(res, 503, {
        error: "wingmic_unavailable",
        message: "wingmic wiring is not live on this deployment; use the paste path for now",
      });
    }
    const wp = await wingmic.getProfile(wingmicToken);
    if (!wp && wingmic.selfProfile !== false) {
      return json(res, 401, { error: "wingmic_auth", message: "that wingmic key did not resolve; sign in again" });
    }
    // a real v1 key has no self-profile read (docs/wingmic-client.md): the profile stays
    // null and the score leans on the network read plus the goal.
    profile = wp;
    kind = "wingmic";
  } else {
    const built = scoring.buildProfile({ profile: body.profile, source: body.source });
    if (!built.profile) {
      return json(res, 400, {
        error: body.source && !body.profile ? "bad_source" : "profile_needed",
        message:
          body.source && !body.profile
            ? "that does not look like a linkedin url; paste a few lines about yourself instead"
            : "paste your profile or a linkedin url so the score means something",
      });
    }
    profile = built.profile;
    kind = profile.kind;
  }

  // stage 1: retrieval, fit and rank of this event across the live set for this profile.
  const pText = scoring.profileText(profile);
  const ranked = scoring.retrieve(pText, live);
  const rank = ranked.findIndex((r) => r.record.id === eventId) + 1;
  const fit = scoring.tokenize(pText).length ? { rank, of: live.length, fit: ranked[Math.max(0, rank - 1)].fit } : null;

  // network overlap, signed-in only. wingmic trouble degrades to no overlap, never an
  // error — but a dead key surfaces as 401 so the ui can ask for a fresh sign-in.
  let meets = [];
  if (wingmicToken) {
    try {
      meets = await overlapSafely(wingmic, wingmicToken, { event, k: 3 });
    } catch (e) {
      if (!(e instanceof WingmicAuthError)) throw e;
      return json(res, 401, { error: "wingmic_auth", message: "that wingmic key did not resolve; sign in again" });
    }
  }

  // stage 2: the typed anchor. stage 3: the words.
  const heuristic = scoring.heuristicScore({ profile, event, goal, meets, fit: fit ? fit.fit : undefined });
  const ctx = { profile, event, goal, meets, fitRank: fit };
  let score;
  if (aiOn()) {
    try {
      score = await scoring.llmScore({ chat: scoreChat, model: provider() === "puter" ? ENV.chatModel : ENV.anthropicModel, heuristic, ...ctx });
    } catch (e) {
      log.warn("score.llm", { err: e });
      score = scoring.fallbackExplain(heuristic, ctx);
    }
  } else {
    score = scoring.fallbackExplain(heuristic, ctx);
  }

  log.info("score", { ip, eventId, kind, quality: scoring.qualityOf(profile), scorer: score.scorer, go: score.go });
  return json(res, 200, {
    event: { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, venue: event.venue, url: event.url },
    score,
    fit,
    profile: { kind, quality: scoring.qualityOf(profile) },
    ai: aiOn(),
  });
};
