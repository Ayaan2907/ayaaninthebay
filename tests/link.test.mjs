import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// the wingmic client boundary, at the unit layer: RealWingmicClient against an
// injected fetch — recall-to-meets mapping, the dead-key throw, the scope/outage
// degradations, verify's three-way sort, capture's honest false.
//
// the integration layer (the real scripts/server.mjs against a stub wingmic v1: the
// token exchange end to end, the claim capture, the 401/403/503 answers, the mock
// deployment path) retired with the deployment on 2026-09-26. the boundary's behavior
// is re-expressed in the tRPC boundary tests in Ayaan2907/wingmic.
const require = createRequire(import.meta.url);
const { RealWingmicClient, WingmicAuthError } = require(new URL("../api/_wingmic.js", import.meta.url).pathname);

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

/* ---------- unit: the real client over an injected fetch ---------- */

const stubFetch = (status, body, capture) => async (url) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => (String(url).includes("/capture") ? (capture ?? {}) : body),
});

test("link: recall entities map to meets with company and topic words", async () => {
  const c = new RealWingmicClient({
    baseUrl: "https://app.wingmic.example/",
    fetchImpl: stubFetch(200, {
      entities: [
        { id: "e1", name: "marco diaz", score: 0.91, companies: [{ id: "c1", name: "acme" }], topics: [{ id: "t1", name: "rust" }], facts: [] },
        { id: "e2", name: "no context entity", score: 0.5, companies: [], topics: [] },
      ],
      durationMs: 1,
      mode: "semantic",
    }),
  });
  const meets = await c.networkOverlap("wk_live_k", { event: HACK_EVENT, k: 3 });
  assert.equal(meets.length, 2);
  assert.equal(meets[0].who, "marco diaz");
  assert.equal(meets[0].why, "moves in the acme, rust circle");
  assert.equal(meets[0].starter, null);
  assert.equal(meets[1].why, "in your network", "an entity with no context gets the honest fallback line");
  assert.equal(c.label, "wingmic");
  assert.equal(c.selfProfile, false);
  assert.equal(await c.getProfile("wk_live_k"), null, "v1 has no self-profile read");
});

test("link: a dead key throws, scope and outage errors degrade to no overlap", async () => {
  const base = { event: HACK_EVENT, k: 3 };
  const dead = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(401, {}) });
  await assert.rejects(dead.networkOverlap("wk_live_k", base), WingmicAuthError);
  for (const status of [403, 429, 500]) {
    const c = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(status, {}) });
    assert.deepEqual(await c.networkOverlap("wk_live_k", base), [], `${status} degrades to no overlap`);
  }
  const down = new RealWingmicClient({
    baseUrl: "https://x",
    fetchImpl: async () => {
      throw new Error("econnrefused");
    },
  });
  assert.deepEqual(await down.networkOverlap("wk_live_k", base), [], "a fetch failure degrades too");
});

test("link: verify sorts dead keys from scoped-out ones from outages", async () => {
  const ok = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(200, { entities: [] }) });
  assert.deepEqual(await ok.verify("wk_live_k"), { ok: true });
  const dead = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(401, {}) });
  assert.deepEqual(await dead.verify("wk_live_k"), { ok: false, reason: "unauthorized" });
  const scoped = new RealWingmicClient({
    baseUrl: "https://x",
    fetchImpl: stubFetch(403, {}, { error: { code: "insufficient_scope", missingScope: "search:read" } }),
  });
  assert.deepEqual(await scoped.verify("wk_live_k"), { ok: false, reason: "missing_scope", missingScope: "search:read" });
  const limited = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(429, {}) });
  assert.deepEqual(await limited.verify("wk_live_k"), { ok: false, reason: "rate_limited" });
  const down = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(503, {}) });
  await assert.rejects(down.verify("wk_live_k"), /503/);
});

test("link: capture lands on ok, scope-misses to false, dies on a dead key", async () => {
  const good = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(200, {}, { interactionId: "i1" }) });
  assert.equal(await good.capture("wk_live_k", { text: "profile text", id: "bay-claim-1" }), true);
  const scoped = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(403, {}) });
  assert.equal(await scoped.capture("wk_live_k", { text: "profile text" }), false, "no capture:write is a no, not a crash");
  const dead = new RealWingmicClient({ baseUrl: "https://x", fetchImpl: stubFetch(401, {}) });
  await assert.rejects(dead.capture("wk_live_k", { text: "profile text" }), WingmicAuthError);
});
