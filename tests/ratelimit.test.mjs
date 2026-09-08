import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { limiter, dailyCap, clientIp } = createRequire(import.meta.url)("../api/_ratelimit.js");

test("limiter allows perHour hits then refuses, and forgets after the window", () => {
  let t = 0;
  const l = limiter({ perHour: 2, windowMs: 100, now: () => t });
  assert.equal(l.take("a"), true);
  assert.equal(l.take("a"), true);
  assert.equal(l.take("a"), false);
  assert.equal(l.take("b"), true, "other ips are independent");
  t = 150;
  assert.equal(l.take("a"), true);
  assert.equal(l.remaining("a"), 1);
});

test("dailyCap resets when the date changes", () => {
  let d = new Date("2026-09-08T10:00:00Z");
  const c = dailyCap(1, () => d);
  assert.equal(c.take(), true);
  assert.equal(c.take(), false);
  d = new Date("2026-09-09T00:00:01Z");
  assert.equal(c.take(), true);
});

test("clientIp prefers the first x-forwarded-for hop", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } }), "1.2.3.4");
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
});
