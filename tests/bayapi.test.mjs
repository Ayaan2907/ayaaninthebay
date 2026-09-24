import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// boots the real server against a temp DATA_DIR holding one live + one expired event
// and no places file, so /api/events exercises expiry filtering and /api/places
// exercises the committed-seed fallback in one boot.
const require = createRequire(import.meta.url);
const bay = require(new URL("../api/_baydata.js", import.meta.url).pathname);

let proc, base;
before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bay-api-"));
  const event = (id, title, startDays, endDays) =>
    bay.normalizeRecord({
      id, type: "event", title, category: "events", source: "seed",
      lat: 37.77, lng: -122.41,
      startsAt: new Date(Date.now() + startDays * 864e5).toISOString(),
      endsAt: new Date(Date.now() + endDays * 864e5).toISOString(),
    }).record;
  const live = event("seed:live-event", "live event", 2, 2.125);
  const dead = event("seed:dead-event", "dead event", -3, -2.042); // past the 24h grace
  fs.writeFileSync(path.join(dir, "events.json"), JSON.stringify({ updatedAt: new Date().toISOString(), records: [live, dead] }));

  const port = 4400 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ["scripts/server.mjs"], {
    env: { PATH: process.env.PATH, PORT: String(port), LOG_LEVEL: "error", DATA_DIR: dir },
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error("server did not start");
});
after(() => proc.kill());

test("events: live only, expiry counted, cache headers like /api/github", async () => {
  const r = await fetch(base + "/api/events");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, s-maxage=900, stale-while-revalidate=3600");
  const j = await r.json();
  assert.equal(j.store, "store");
  assert.deepEqual(j.events.map((e) => e.id), ["seed:live-event"], "the expired event never leaves the api");
  assert.equal(j.expired, 1);
  assert.ok(j.asOf);
  assert.ok(j.sources.includes("seed"));
});

test("places: falls back to the committed seed when no store exists", async () => {
  const j = await (await fetch(base + "/api/places")).json();
  assert.equal(j.store, "seed");
  assert.ok(j.total >= 1);
  for (const p of j.places) assert.equal(p.source, "seed");
  for (const p of j.places) assert.ok(bay.CATEGORIES.includes(p.category));
});

test("the read api is get/head only", async () => {
  assert.equal((await fetch(base + "/api/events", { method: "POST", body: "{}" })).status, 405);
  assert.equal((await fetch(base + "/api/events", { method: "HEAD" })).status, 200);
});
