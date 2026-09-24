import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// the sign-in-with-wingmic link flow, at two layers:
//   unit       — RealWingmicClient against an injected fetch: recall-to-meets mapping, the
//                dead-key throw, the scope/outage degradations, verify's three-way sort.
//   integration — the real server with WINGMIC_BASE_URL pointed at a stub wingmic v1
//                (node:http, per-test statuses): the token exchange end to end, the claim
//                capture it triggers, and the 401/403/503 answers a bad key earns. plus
//                the mock deployment's link path (WINGMIC_MOCK=on) and the 503 when the
//                deployment has no wingmic wiring at all.
const require = createRequire(import.meta.url);
const bay = require(new URL("../api/_baydata.js", import.meta.url).pathname);
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

/* ---------- integration: the real server against a stub wingmic ---------- */

let stub, realProc, realBase, mockProc, mockBase, bareProc, bareBase;
const stubSeen = [];
const stubState = { recallStatus: 200, captureStatus: 200 };

before(async () => {
  stub = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      stubSeen.push({ path: url.pathname, auth: req.headers.authorization || "", body: raw ? JSON.parse(raw) : null });
      const isRecall = url.pathname === "/api/v1/recall";
      const status = isRecall ? stubState.recallStatus : stubState.captureStatus;
      res.setHeader("content-type", "application/json");
      res.statusCode = status;
      if (status === 403) {
        res.end(JSON.stringify({ error: { code: "insufficient_scope", message: "missing", missingScope: "search:read" } }));
        return;
      }
      if (isRecall) {
        res.end(JSON.stringify({
          entities: [{ id: "e1", name: "marco diaz", score: 0.91, companies: [{ id: "c1", name: "acme" }], topics: [{ id: "t1", name: "rust" }], facts: [] }],
          durationMs: 1,
          mode: "semantic",
        }));
      } else {
        res.end(JSON.stringify({ interactionId: "i1" }));
      }
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const stubPort = stub.address().port;

  const root = new URL("..", import.meta.url).pathname;
  const writeStore = (dir) =>
    fs.writeFileSync(path.join(dir, "events.json"), JSON.stringify({ updatedAt: iso(NOW), records: [bay.normalizeRecord(HACK_EVENT).record] }));
  const boot = async (extra) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bay-link-"));
    writeStore(dir);
    const port = 4800 + Math.floor(Math.random() * 300);
    const proc = spawn(process.execPath, ["scripts/server.mjs"], {
      env: { PATH: process.env.PATH, PORT: String(port), LOG_LEVEL: "error", DATA_DIR: dir, NODE_ENV: "production", INGEST_ENABLED: "off", ...extra },
      cwd: root,
      stdio: "ignore",
    });
    const b = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(b + "/api/health");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return [proc, b];
  };
  // real wiring: the server's wingmic client talks to the stub
  [realProc, realBase] = await boot({ WINGMIC_BASE_URL: `http://127.0.0.1:${stubPort}` });
  // mock wiring: the demo network
  [mockProc, mockBase] = await boot({ WINGMIC_MOCK: "on" });
  // no wiring at all: the anonymous path lives, sign-in does not
  [bareProc, bareBase] = await boot({});
});

after(() => {
  for (const p of [realProc, mockProc, bareProc]) p.kill();
  stub.close();
});

const post = (b, route, body) =>
  fetch(b + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const PASTE = "ml engineer at acme\nshipped edge configs for three years\nlooking for a cofounder";

test("link: the token exchange links a good key and captures the throwaway profile", async () => {
  stubState.recallStatus = 200;
  stubState.captureStatus = 200;
  stubSeen.length = 0;
  const r = await post(realBase, "/api/link", { key: "wk_live_goodkey1", profile: PASTE });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { linked: true, captured: true });
  const cap = stubSeen.find((s) => s.path === "/api/v1/capture");
  assert.ok(cap, "the claim reached wingmic's capture endpoint");
  assert.equal(cap.auth, "Bearer wk_live_goodkey1");
  assert.match(cap.body.clientCaptureId, /^bay-claim-/, "retry idempotency id travels along");
  assert.ok(cap.body.transcript.includes("looking for a cofounder"));
});

test("link: the linked key then scores with real network overlap and no signup wall", async () => {
  stubState.recallStatus = 200;
  const r = await post(realBase, "/api/score", { eventId: "seed:ai-hack", goal: "meet rust builders", wingmicToken: "wk_live_goodkey1" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.profile.kind, "wingmic");
  assert.ok(j.score.meet.length >= 1 && j.score.meet[0].who === "marco diaz", "the stub network surfaces marco");
  assert.ok(j.score.reasons.some((x) => x.includes("your people")), "the network reason lands");
  // and the response stays honest about what v1 cannot do: no profile read, no invented fit
  assert.equal(j.fit, null);
});

test("link: a dead key is refused with 401 at link time and at score time", async () => {
  stubState.recallStatus = 401;
  const r = await post(realBase, "/api/link", { key: "wk_live_revoked12" });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "wingmic_auth");
  const s = await post(realBase, "/api/score", { eventId: "seed:ai-hack", wingmicToken: "wk_live_revoked12" });
  assert.equal(s.status, 401, "scoring a dead key answers 401, not a silent empty network");
});

test("link: a scoped-out key names the missing scope", async () => {
  stubState.recallStatus = 403;
  const r = await post(realBase, "/api/link", { key: "wk_live_graphonly" });
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.error, "wingmic_scope");
  assert.equal(j.missingScope, "search:read");
});

test("link: capture trouble keeps the link standing and says so", async () => {
  stubState.recallStatus = 200;
  stubState.captureStatus = 403;
  const r = await post(realBase, "/api/link", { key: "wk_live_readonly1", profile: PASTE });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.linked, true);
  assert.equal(j.captured, false);
  assert.ok(j.note.includes("capture"), "the response says the capture did not land");
});

test("link: a deployment with no wingmic wiring answers 503, the ask path lives", async () => {
  const r = await post(bareBase, "/api/link", { key: "wk_live_goodkey1" });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "wingmic_unavailable");
  const s = await post(bareBase, "/api/score", { eventId: "seed:ai-hack", source: { kind: "text", value: PASTE } });
  assert.equal(s.status, 200, "anonymous scoring keeps working without any wingmic wiring");
  assert.equal((await s.json()).profile.kind, "throwaway");
});

test("link: a mock deployment links the demo profile end to end", async () => {
  const r = await post(mockBase, "/api/link", { key: "mock-demo-1", profile: PASTE });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { linked: true, captured: true });
  const s = await post(mockBase, "/api/score", { eventId: "seed:ai-hack", wingmicToken: "mock-demo-1" });
  assert.equal((await s.json()).profile.kind, "wingmic");
});

test("link: junk is refused at the boundary", async () => {
  const noKey = await post(realBase, "/api/link", {});
  assert.equal(noKey.status, 400);
  const shortKey = await post(realBase, "/api/link", { key: "abc" });
  assert.equal(shortKey.status, 400);
  const wrongMethod = await fetch(realBase + "/api/link");
  assert.equal(wrongMethod.status, 405);
});
