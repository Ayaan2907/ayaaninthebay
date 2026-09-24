// api/_wingmic.js
// the wingmic client boundary. the map consumes wingmic profiles and network overlap
// through this interface and never touches wingmic's database directly (the data boundary
// in the spec). one interface, two implementations:
//   mock , deterministic fixtures, for tests and local dev (WINGMIC_MOCK=on). labeled as
//           demo everywhere it surfaces.
//   real , live wingmic public REST v1 (PR #180, docs/api.md): scoped wk_live_ bearer
//           keys, GET /api/v1/recall for network reads, POST /api/v1/capture for the
//           claim path. selected when WINGMIC_BASE_URL is set; see docs/wingmic-client.md
//           for the endpoint mapping.
//
// contract, both implementations:
//   getProfile(token)                   → Profile | null
//       the signed-in viewer's profile. token is the viewer's own scoped wingmic key
//       ("sign in with wingmic" → `wk_live_…`). v1 has no self-profile read, so the real
//       client always returns null (selfProfile: false below) and scoring leans on
//       networkOverlap plus the ask path; the mock returns a fixture so the flow is
//       testable end to end.
//       Profile: { kind: "wingmic", name?, headline?, roles[], topics[], goals[], links{} }
//   networkOverlap(token, { event, k }) → Meet[]
//       people from the viewer's own network connected to the event's world. the real
//       client calls GET /api/v1/recall?q=<event words>&limit=k (scope search:read) and
//       maps entities to meets. scope, rate-limit, network and server errors degrade to
//       [] with a log line: scoring never fails because wingmic did. a 401 is different —
//       it means the key is dead, so it throws WingmicAuthError and the handler answers
//       401 instead of scoring a silently empty network.
//       Meet: { who, why, starter? }
//   verify(token)                       → { ok: true } | { ok: false, reason, missingScope? }
//       one scoped probe call that tells a key from a dead one. 401 → unauthorized,
//       403 (wingmic names the missing scope) → missing_scope, 429 → rate_limited.
//       infra trouble (5xx, fetch failure) throws; the caller answers 503.
//   capture(token, { text, id })        → true | false
//       best-effort claim capture: push the throwaway profile text into the owner's
//       graph (scope capture:write). false means it did not land; the link stands.
//   selfProfile: true on the mock (tokens resolve to a fixture), false on the real
//       client (v1 cannot read the owner's profile). api/score.js consults it so a valid
//       real key is not mistaken for a failed lookup.

const log = require("./_log.js");
const { tokenize, eventText } = require("./_scoring.js");

const clip = (v, n) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

// the key is dead (unknown or revoked): not an outage, a credential problem. the handler
// maps it to 401 so the ui can ask for a fresh sign-in instead of scoring an empty network
// as if nothing was wrong.
class WingmicAuthError extends Error {
  constructor() {
    super("wingmic key did not resolve");
    this.name = "WingmicAuthError";
  }
}

const MOCK_PROFILE = Object.freeze({
  kind: "wingmic",
  name: "sam rivera",
  headline: "ml engineer at a 12 person infra startup, weighing a founder move",
  roles: ["ml engineer", "founding engineer"],
  topics: ["ai agents", "developer tools", "inference infra", "edge configs"],
  goals: ["find a cofounder", "meet builders shipping fast"],
  links: { linkedin: "https://www.linkedin.com/in/sam-rivera-mock" },
});

// fixture people with topic words; overlap is a plain token match against the event, so
// the same event always produces the same list. people whose topics miss the event stay
// out of it: the demo must not pretend the network is bigger than it is.
const MOCK_PEOPLE = Object.freeze([
  {
    who: "dex morales",
    topics: ["agents", "hackathon", "builders"],
    why: "built the agent eval harness you kept citing",
    starter: "ask what they have shipped since the last demo night",
  },
  {
    who: "priya nair",
    topics: ["inference", "infra", "developers"],
    why: "runs the platform work your last two projects leaned on",
    starter: "ask how they sized inference for the last launch",
  },
  {
    who: "lena kwan",
    topics: ["founders", "startups", "cofounder"],
    why: "made the founder move you are weighing",
    starter: "ask what they would do differently in the first 90 days",
  },
]);

class MockWingmicClient {
  constructor(label = "mock") {
    this.label = label;
    this.selfProfile = true;
  }
  async getProfile(token) {
    if (!token) return null;
    return {
      ...MOCK_PROFILE,
      roles: [...MOCK_PROFILE.roles],
      topics: [...MOCK_PROFILE.topics],
      goals: [...MOCK_PROFILE.goals],
      links: { ...MOCK_PROFILE.links },
    };
  }
  async verify(token) {
    return token ? { ok: true } : { ok: false, reason: "unauthorized" };
  }
  async capture() {
    return true;
  }
  async networkOverlap(token, { event, k = 3 } = {}) {
    if (!token || !event) return [];
    const words = new Set(tokenize(eventText(event)));
    return MOCK_PEOPLE.map((p) => ({
      p,
      hits: p.topics.flatMap((t) => tokenize(t)).filter((w) => words.has(w)).length,
    }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, Math.max(1, Math.min(k, 3)))
      .map((x) => ({ who: x.p.who, why: x.p.why, starter: x.p.starter }));
  }
}

// the real client over wingmic public REST v1 (docs/api.md on the wingmic repo):
// bearer wk_live_ keys, entities-shaped recall, 403 errors that name the missing scope.
// fetchImpl is injectable so tests can run the mapping without a network.
class RealWingmicClient {
  constructor({ baseUrl, fetchImpl } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl || ((u, o) => fetch(u, o));
    this.label = "wingmic";
    this.selfProfile = false; // v1 has no self-profile read; scoring leans on networkOverlap
  }
  async getProfile() {
    // honest null: a v1 key can search its owner's network but cannot fetch the owner's
    // profile. when wingmic ships one, only this method changes.
    return null;
  }
  async verify(token) {
    let r;
    try {
      r = await this.fetchImpl(`${this.baseUrl}/api/v1/recall?q=network&limit=1`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (e) {
      throw new Error("wingmic unreachable: " + (e && e.message ? e.message : e));
    }
    if (r.status === 200) return { ok: true };
    if (r.status === 401) return { ok: false, reason: "unauthorized" };
    if (r.status === 403) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, reason: "missing_scope", missingScope: (j.error && j.error.missingScope) || "search:read" };
    }
    if (r.status === 429) return { ok: false, reason: "rate_limited" };
    throw new Error("wingmic recall probe: " + r.status);
  }
  async networkOverlap(token, { event, k = 3 } = {}) {
    if (!event) return [];
    const q = [event.title, event.category, event.venue, event.note].filter(Boolean).join(" ").slice(0, 500);
    let r;
    try {
      r = await this.fetchImpl(`${this.baseUrl}/api/v1/recall?q=${encodeURIComponent(q)}&limit=${Math.max(1, Math.min(k, 50))}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (e) {
      log.warn("wingmic.recall", { err: e });
      return [];
    }
    if (r.status === 401) throw new WingmicAuthError();
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      // key missing the scope, rate limited, or wingmic is down: the score rides on
      // without the network rather than failing the card.
      log.warn("wingmic.recall", { status: r.status });
      return [];
    }
    if (!r.ok) throw new Error("wingmic recall: " + r.status);
    const j = await r.json();
    const entities = Array.isArray(j.entities) ? j.entities : [];
    return entities.slice(0, Math.max(1, Math.min(k, 50))).map((e) => {
      const bits = [
        ...((e.companies || []).map((c) => c && c.name).filter(Boolean)),
        ...((e.topics || []).map((t) => t && t.name).filter(Boolean)),
      ].slice(0, 3);
      return {
        who: clip(e.name, 120) || "someone from your network",
        why: bits.length ? `moves in the ${clip(bits.join(", "), 200)} circle` : "in your network",
        starter: null, // the explain stage writes starters when it has the context
      };
    });
  }
  async capture(token, { text, id } = {}) {
    if (!text) return false;
    let r;
    try {
      r = await this.fetchImpl(`${this.baseUrl}/api/v1/capture`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ transcript: String(text).slice(0, 10000), clientCaptureId: id }),
      });
    } catch (e) {
      log.warn("wingmic.capture", { err: e });
      return false;
    }
    if (r.ok) return true;
    if (r.status === 401) throw new WingmicAuthError();
    log.warn("wingmic.capture", { status: r.status });
    return false;
  }
}

// production wiring: the real client when a base url is configured (wingmic's public
// api is live), the mock only behind the explicit flag. a mock must never serve real
// traffic by accident, and an unconfigured deployment keeps the anonymous ask path.
function makeWingmicClient(ENV) {
  if (ENV && ENV.wingmicBaseUrl) return new RealWingmicClient({ baseUrl: ENV.wingmicBaseUrl });
  if (ENV && ENV.wingmicMock === "on") return new MockWingmicClient();
  return null;
}

// shared guard for the handler: never let a wingmic outage break a score. a dead key is
// not an outage, so WingmicAuthError cuts through and the caller answers 401.
async function overlapSafely(client, token, eventCtx) {
  if (!client || !token) return [];
  try {
    return await client.networkOverlap(token, eventCtx);
  } catch (e) {
    if (e instanceof WingmicAuthError) throw e;
    log.warn("wingmic.overlap", { err: e });
    return [];
  }
}

module.exports = { MockWingmicClient, RealWingmicClient, WingmicAuthError, MOCK_PROFILE, makeWingmicClient, overlapSafely };
