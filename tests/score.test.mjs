import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// two layers:
//   unit     , api/_scoring.js is pure: determinism under fixed inputs, boundary verdicts,
//               the llm clamp and its junk-throwing, profile parsing.
//   integration, the real server against a temp DATA_DIR (same harness as bayapi.test.mjs),
//               WINGMIC_MOCK=on, no ai keys so CHAT_PROVIDER falls back to "none" and the
//               typed explain path runs hermetically. covers the signed-in (wingmic token)
//               and anonymous (linkedin url / paste) flows end to end.
const require = createRequire(import.meta.url);
const scoring = require(new URL("../api/_scoring.js", import.meta.url).pathname);
const bay = require(new URL("../api/_baydata.js", import.meta.url).pathname);

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
const DEAD_EVENT = {
  ...HACK_EVENT,
  id: "seed:dead-event",
  title: "dead event",
  startsAt: iso(NOW - 96 * 36e5),
  endsAt: iso(NOW - 92 * 36e5), // past the 24h grace at NOW
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

/* ---------- integration: the real server ---------- */

let main, base, rateProc, rateBase;

const writeStore = (dir, records) => {
  fs.writeFileSync(path.join(dir, "events.json"), JSON.stringify({ updatedAt: iso(NOW), records }));
};

const norm = (r) => bay.normalizeRecord(r).record;

before(async () => {
  const root = new URL("..", import.meta.url).pathname;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bay-score-"));
  writeStore(dir, [norm(HACK_EVENT), norm(TOUR_EVENT), norm(DEAD_EVENT)]);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "bay-rate-"));
  writeStore(dir2, [norm(HACK_EVENT)]);

  const portA = 4500 + Math.floor(Math.random() * 300);
  const portB = portA + 1;
  base = `http://127.0.0.1:${portA}`;
  rateBase = `http://127.0.0.1:${portB}`;
  const boot = (port, dataDir, extra) =>
    spawn(process.execPath, ["scripts/server.mjs"], {
      env: { PATH: process.env.PATH, PORT: String(port), LOG_LEVEL: "error", DATA_DIR: dataDir, ...extra },
      cwd: root,
      stdio: "ignore",
    });
  main = boot(portA, dir, { WINGMIC_MOCK: "on" });
  // production mode so the handler module (and its module-level limiter) persists across
  // requests, dev re-requires handlers per request, which would never trip the limit.
  // ingest stays off so the boot never calls out to event apis.
  rateProc = boot(portB, dir2, { SCORE_PER_HOUR: "2", NODE_ENV: "production", INGEST_ENABLED: "off" });
  for (const b of [base, rateBase]) {
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(b + "/api/health");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
});
after(() => {
  main.kill();
  rateProc.kill();
});

const post = (b, body) =>
  fetch(b + "/api/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("score: capability probe reports the typed fallback and the mock wingmic", async () => {
  const r = await fetch(base + "/api/score");
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ai, false, "no keys in this env, so the llm stage is off");
  assert.equal(j.wingmic, "mock");
});

test("score: signed-in demo profile gets a full card with mock network overlap", async () => {
  const r = await post(base, { eventId: "seed:ai-hack", goal: "meet builders", wingmicToken: "mock-demo-1" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.profile.kind, "wingmic");
  assert.equal(j.event.id, "seed:ai-hack");
  const s = j.score;
  assert.ok(["go", "maybe", "skip"].includes(s.verdict), `verdict is explicit: ${s.verdict}`);
  assert.ok(typeof s.outcome === "string" && s.outcome.length > 10, "the outcome sentence is there");
  assert.ok(s.reasons.length >= 1, "reasons are there");
  assert.ok(s.meet.length >= 1 && s.meet[0].who === "dex morales", "the mock network surfaces dex for a hackathon");
  assert.ok(j.fit && j.fit.rank >= 1 && j.fit.rank <= j.fit.of, "rank is honest within the live set");
});

test("score: same ask, same answer (typed determinism over http)", async () => {
  const ask = { eventId: "seed:ai-hack", profile: { headline: "ml engineer shipping agents", topics: ["agents"] } };
  const a = await (await post(base, ask)).json();
  const b = await (await post(base, ask)).json();
  assert.equal(a.score.go, b.score.go);
  assert.deepEqual(a.score.reasons, b.score.reasons);
});

test("score: anonymous linkedin url scores without a login wall", async () => {
  const r = await post(base, { eventId: "seed:ai-hack", source: { kind: "linkedin_url", value: "https://www.linkedin.com/in/sam-rivera" } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.profile.kind, "throwaway", "no signup between paste and answer");
  assert.ok(j.score.verdict, "the answer still lands");
});

test("score: a bare url without a profile is asked for, not guessed", async () => {
  const r = await post(base, { eventId: "seed:ai-hack", source: { kind: "linkedin_url", value: "https://evil.example/u/x" } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "bad_source");
  const none = await post(base, { eventId: "seed:ai-hack" });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).error, "profile_needed");
});

test("score: unknown and expired events are refused honestly", async () => {
  const unknown = await post(base, { eventId: "seed:nope", profile: { headline: "hi" } });
  assert.equal(unknown.status, 404);
  const dead = await post(base, { eventId: "seed:dead-event", profile: { headline: "hi" } });
  assert.equal(dead.status, 410);
});

test("score: per-ip rate limit trips with 429", async () => {
  const first = await post(rateBase, { eventId: "seed:ai-hack", profile: { headline: "hi" } });
  assert.equal(first.status, 200);
  const second = await post(rateBase, { eventId: "seed:ai-hack", profile: { headline: "hi" } });
  assert.equal(second.status, 200);
  const third = await post(rateBase, { eventId: "seed:ai-hack", profile: { headline: "hi" } });
  assert.equal(third.status, 429);
});
