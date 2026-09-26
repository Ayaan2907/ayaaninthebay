import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// api/_scoring.js is pure, so these tests run hermetically: determinism under fixed
// inputs, boundary verdicts, the llm clamp and its junk-throwing, profile parsing.
// the integration layer (the /api/score route over a running scripts/server.mjs)
// retired with the deployment on 2026-09-26; the route's behavior is re-expressed in
// the tRPC boundary tests in Ayaan2907/wingmic.
const require = createRequire(import.meta.url);
const scoring = require(new URL("../api/_scoring.js", import.meta.url).pathname);

const NOW = new Date("2026-09-24T18:00:00Z").getTime();
const iso = (ms) => new Date(ms).toISOString();

const HACK_EVENT = {
  id: "seed:ai-hack",
  type: "event",
  title: "ai agents hackathon weekend",
  category: "hackathons",
  source: "seed",
  venue: "somewhere in soma",
  note: "builders ship fast, judges from the infra world",
  lat: 37.77,
  lng: -122.41,
  startsAt: iso(NOW + 36e5),
  endsAt: iso(NOW + 36e5 + 4 * 36e5),
};
const TOUR_EVENT = {
  id: "seed:city-tour",
  type: "event",
  title: "mission district food tour",
  category: "tours",
  source: "seed",
  note: "newcomers walk, taste, and trade recommendations",
  lat: 37.76,
  lng: -122.42,
  startsAt: iso(NOW + 48e5),
};
const ENGINEER = {
  kind: "pasted",
  headline: "ml engineer shipping agents and infra",
  roles: ["ml engineer"],
  topics: ["agents", "hackathons", "infra"],
  goals: [],
  links: {},
};

/* ---------- unit: embeddings ---------- */

test("scoring: embed is deterministic and normalized", () => {
  const a = scoring.embed("builders shipping agents fast");
  const b = scoring.embed("builders shipping agents fast");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "same text, same vector");
  const norm = Math.sqrt([...a].reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, "nonempty vectors are unit length");
  const empty = [...scoring.embed("")];
  assert.ok(empty.every((x) => x === 0), "empty text embeds to the zero vector, no NaN");
});

/* ---------- unit: the typed scorer ---------- */

test("scoring: heuristicScore is deterministic under fixed inputs", () => {
  const run = () =>
    scoring.heuristicScore({
      profile: ENGINEER,
      event: HACK_EVENT,
      goal: "meet builders",
      meets: [{ who: "dex morales", why: "builder" }],
      now: NOW,
    });
  assert.deepEqual(run(), run());
  const { go, confidence, facts } = run();
  assert.ok(go >= 0.02 && go <= 0.97, "go stays in its calibrated band");
  assert.ok(confidence > 0.2, "a real profile carries real confidence");
  assert.equal(facts.soon, 1, "36h out counts as starts-soon");
});

test("scoring: a matching profile outscores a mismatched one", () => {
  const on = scoring.heuristicScore({ profile: ENGINEER, event: HACK_EVENT, goal: "meet builders", meets: [], now: NOW });
  const off = scoring.heuristicScore({
    profile: ENGINEER,
    event: { ...TOUR_EVENT, title: "gardening club meetup", note: "plants and pruning" },
    goal: "meet builders",
    meets: [],
    now: NOW,
  });
  assert.ok(on.go > off.go, `agent match ${on.go} should beat the gardening club ${off.go}`);
});

test("scoring: verdict boundaries", () => {
  assert.equal(scoring.verdictOf(0.6), "go");
  assert.equal(scoring.verdictOf(0.59), "maybe");
  assert.equal(scoring.verdictOf(0.4), "maybe");
  assert.equal(scoring.verdictOf(0.39), "skip");
  assert.equal(scoring.verdictOf(0.97), "go");
});

test("scoring: retrieval ranks the matching event first and breaks ties by id", () => {
  const ranked = scoring.retrieve(scoring.profileText(ENGINEER), [TOUR_EVENT, HACK_EVENT]);
  assert.equal(ranked[0].record.id, "seed:ai-hack");
  assert.ok(ranked[0].fit >= ranked[1].fit);
  const none = scoring.retrieve("", [TOUR_EVENT, HACK_EVENT]);
  assert.ok(none.every((r) => r.fit === 0), "no profile words, no fit claims");
});

/* ---------- unit: the explain fallback and the llm stage ---------- */

test("scoring: fallbackExplain returns the full card shape", () => {
  const h = scoring.heuristicScore({ profile: ENGINEER, event: HACK_EVENT, goal: "meet builders", meets: [], now: NOW });
  const card = scoring.fallbackExplain(h, { profile: ENGINEER, event: HACK_EVENT, goal: "meet builders", meets: [] });
  assert.equal(card.scorer, "typed");
  assert.equal(card.go, h.go);
  assert.ok(["go", "maybe", "skip"].includes(card.verdict));
  assert.ok(typeof card.outcome === "string" && card.outcome.length > 10, "the outcome sentence is real");
  assert.ok(Array.isArray(card.reasons) && card.reasons.length >= 1, "at least one reason, always");
  assert.ok(Array.isArray(card.meet) && card.meet.length >= 1 && card.meet[0].who, "who to meet is populated");
});

test("scoring: llm output is clamped near the typed anchor", async () => {
  const h = scoring.heuristicScore({ profile: ENGINEER, event: HACK_EVENT, goal: "", meets: [], now: NOW });
  const chat = async () =>
    JSON.stringify({ go: 0.99, confidence: 0.9, outcome: "you will ship something", reasons: ["matches your agents work"], meet: [] });
  const card = await scoring.llmScore({ chat, heuristic: h, profile: ENGINEER, event: HACK_EVENT, goal: "", meets: [] });
  assert.equal(card.scorer, "llm");
  assert.ok(card.go <= h.go + 0.15 + 1e-9, `anchored ${card.go} stays within 0.15 of ${h.go}`);
  assert.ok(card.outcome.length > 0, "the llm words land");
});

test("scoring: llm junk throws, fenced json parses", async () => {
  const h = scoring.heuristicScore({ profile: ENGINEER, event: HACK_EVENT, goal: "", meets: [], now: NOW });
  await assert.rejects(scoring.llmScore({ chat: async () => "i refuse to answer in json", heuristic: h, profile: ENGINEER, event: HACK_EVENT }), /json/i);
  const fenced = async () =>
    "```json\n" +
    JSON.stringify({ go: h.go, outcome: "ok", reasons: ["fits"], meet: [{ who: "x", why: "y", starter: "z" }] }) +
    "\n```";
  const card = await scoring.llmScore({ chat: fenced, heuristic: h, profile: ENGINEER, event: HACK_EVENT });
  assert.equal(card.scorer, "llm");
  assert.equal(card.meet[0].who, "x");
});

/* ---------- unit: the profile consume path ---------- */

test("scoring: buildProfile accepts a linkedin url, a paste, and rejects junk", () => {
  const url = scoring.buildProfile({ source: { kind: "linkedin_url", value: "https://www.linkedin.com/in/sam-rivera" } });
  assert.equal(url.profile.kind, "throwaway");
  assert.equal(url.profile.links.linkedin, "https://www.linkedin.com/in/sam-rivera");
  const paste = scoring.buildProfile({ source: { kind: "text", value: "i build compilers and i am new to the city" } });
  assert.equal(paste.profile.kind, "throwaway");
  assert.equal(paste.profile.raw, "i build compilers and i am new to the city");
  const bad = scoring.buildProfile({ source: { kind: "linkedin_url", value: "https://evil.example/u/x" } });
  assert.equal(bad.profile, null);
  assert.equal(bad.quality, "none");
  const junk = scoring.buildProfile({ source: { kind: "text", value: "   " } });
  assert.equal(junk.profile, null);
});

test("scoring: parsePaste lifts fields from a paste without inventing any", () => {
  const p = scoring.parsePaste(
    "ml engineer at acme\nbuilt agents and infra for years\nlooking for a cofounder\ntopics: rust, edge configs, inference",
  );
  assert.equal(p.headline, "ml engineer at acme");
  assert.deepEqual(p.roles, ["ml engineer"]);
  assert.equal(p.goals[0], "looking for a cofounder");
  assert.deepEqual(p.topics, ["rust", "edge configs", "inference"]);
  // a bare line is claimed by nothing; it rides in raw only
  const bare = scoring.parsePaste("ml engineer\ni build compilers");
  assert.deepEqual(bare.roles, []);
  assert.deepEqual(bare.goals, []);
  assert.deepEqual(bare.topics, []);
  assert.equal(scoring.parsePaste(""), null);
});

test("scoring: a pasted text source builds a throwaway with parsed fields and the raw text", () => {
  const b = scoring.buildProfile({ source: { kind: "text", value: "ml engineer at acme\nlooking for a cofounder" } });
  assert.equal(b.profile.kind, "throwaway");
  assert.equal(b.profile.headline, "ml engineer at acme");
  assert.deepEqual(b.profile.roles, ["ml engineer"]);
  assert.ok(b.profile.raw.includes("looking for a cofounder"), "the raw text rides along for retrieval");
  assert.equal(b.quality, "ok");
});
