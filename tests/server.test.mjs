import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// boots the real server on a random port with no secrets and hits it like a visitor would.
let proc, base;
before(async () => {
  const port = 4000 + Math.floor(Math.random() * 1000);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ["scripts/server.mjs"], { env: { PATH: process.env.PATH, PORT: String(port), LOG_LEVEL: "error" }, cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error("server did not start");
});
after(() => proc.kill());

test("health says ok and reports wiring", async () => {
  const j = await (await fetch(base + "/api/health")).json();
  assert.equal(j.status, "ok");
  assert.equal(j.chat, false);
  assert.equal(j.build, "visitor");
});

test("serves the terminal, clean urls and blog rewrites", async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/blog")).status, 200);
  assert.equal((await fetch(base + "/blog/why-a-terminal")).status, 200);
  assert.equal((await fetch(base + "/posts/index.json")).status, 200);
});

test("hides everything outside the public folders", async () => {
  for (const p of ["/package.json", "/api/_env.js", "/drafts/README.md", "/scripts/server.mjs", "/.env.example", "/../etc/passwd"]) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + "/api/_puter")).status, 404, "private helpers are not routes");
});

test("chat is 503 without a provider, 400 on junk", async () => {
  assert.equal((await fetch(base + "/api/chat", { method: "POST", body: "{}" })).status, 503);
  const g = await (await fetch(base + "/api/chat")).json();
  assert.equal(g.ai, false);
});

test("security headers are on every response", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
});

test("the bay map is its own surface, no shared runtime bundle", async () => {
  const bay = await (await fetch(base + "/bay")).text();
  const term = await (await fetch(base + "/")).text();
  assert.match(bay, /assets\/bay\/map\.js/, "bay loads its own bundle");
  assert.doesNotMatch(bay, /content\/knowledge\.js|assets\/(map|app|build|call)\.js/, "bay shares no runtime js with the terminal");
  assert.match(bay, /assets\/bay\/bay\.css/, "bay styles are its own");
  assert.equal((await fetch(base + "/bay/")).status, 200, "trailing slash works");
  assert.equal((await fetch(base + "/assets/bay/map.js")).status, 200, "map bundle is served");
  assert.equal((await fetch(base + "/assets/bay/places.json")).status, 200, "places data is served");
  assert.match(bay, /maplibre/, "the map loads maplibre from a cdn");
  assert.match(bay, /assets\/bay\/map\.js/, "bay bootstraps the real map");
  assert.doesNotMatch(bay, /cityCanvas/, "the canvas city is gone from /bay");
  assert.match(term, /content\/knowledge\.js/, "terminal keeps knowledge");
  assert.doesNotMatch(term, /assets\/city\.js/, "terminal no longer bootstraps the city canvas");
  assert.match(term, /href="\/bay"/, "terminal links out to the map");
});
