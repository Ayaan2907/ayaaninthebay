// api/_wingmic.js
// the wingmic client boundary. the map consumes wingmic profiles and network overlap
// through this interface and never touches wingmic's database directly (the data boundary
// in the spec). one interface, two implementations:
//   mock , deterministic fixtures, for tests and local dev (WINGMIC_MOCK=on). labeled as
//           demo everywhere it surfaces.
//   real , lands when wingmic PR #180 (public REST v1) merges; see docs/wingmic-client.md
//           for the mapping. until then makeWingmicClient returns null and the signed-in
//           path answers 503 while the anonymous ask path keeps working.
//
// contract, both implementations:
//   getProfile(token)                   → Profile | null
//       the signed-in viewer's profile. token is the viewer's own scoped wingmic key
//       ("sign in with wingmic" magic link → `wk_live_…`). v1 has no self-profile read
//       yet, so the real adapter will return null and scoring leans on networkOverlap
//       plus the ask path; the mock returns a fixture so the flow is testable end to end.
//       Profile: { kind: "wingmic", name?, headline?, roles[], topics[], goals[], links{} }
//   networkOverlap(token, { event, k }) → Meet[]
//       people from the viewer's own network connected to the event's world. the real
//       adapter calls GET /api/v1/recall?q=<event words>&limit=k (scope search:read) and
//       maps entities to meets. auth, scope, rate-limit and server errors degrade to []
//       with a log line: scoring never fails because wingmic did.
//       Meet: { who, why, starter? }

const log = require("./_log.js");
const { tokenize, eventText } = require("./_scoring.js");

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

// production wiring lands with wingmic PR #180 (docs/wingmic-client.md carries the
// endpoint mapping). explicit flag only: a mock must never serve real traffic by accident.
function makeWingmicClient(ENV) {
  if (ENV && ENV.wingmicMock === "on") return new MockWingmicClient();
  return null;
}

// shared guard for the real adapter later and the handler now: never let a wingmic outage
// break a score.
async function overlapSafely(client, token, eventCtx) {
  if (!client || !token) return [];
  try {
    return await client.networkOverlap(token, eventCtx);
  } catch (e) {
    log.warn("wingmic.overlap", { err: e });
    return [];
  }
}

module.exports = { MockWingmicClient, MOCK_PROFILE, makeWingmicClient, overlapSafely };
