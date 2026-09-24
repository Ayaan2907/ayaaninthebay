import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runIngest, lumaToRecord, ingestSources } from "../scripts/ingest.mjs";

const require = createRequire(import.meta.url);
const bay = require(new URL("../api/_baydata.js", import.meta.url).pathname);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bay-test-"));
const at = (days, hours = 0) => new Date(Date.now() + days * 864e5 + hours * 36e5).toISOString();
const normalize = (input) => bay.normalizeRecord(input);

const lumaEntry = (id, name, startDays = 2, durationHours = 3) => ({
  event: {
    api_id: id,
    name,
    start_at: at(startDays),
    end_at: at(startDays, durationHours),
    url: `slug-${id}`,
    location_type: "offline",
    coordinate: { latitude: 37.77, longitude: -122.41 },
    geo_address_info: { city_state: "San Francisco, CA", full_address: "101 Market St, San Francisco, CA" },
  },
  calendar: { name: "test calendar" },
});
const lumaPage = (entries, hasMore = false) => ({ entries, has_more: hasMore, next_cursor: "cursor-2" });
const fakeFetch = (entries, hasMore = false) => async () => ({ ok: true, json: async () => lumaPage(entries, hasMore) });

test("normalizeRecord enforces the contract at the boundary", () => {
  assert.match(normalize({ type: "event", title: "x", category: "church", source: "seed" }).error, /category/);
  assert.match(normalize({ type: "album", title: "x", category: "tours", source: "seed" }).error, /type/);
  assert.match(normalize({ type: "event", title: "x", category: "tours", source: "seed" }).error, /startsAt/);
  assert.match(
    normalize({ type: "place", title: "x", category: "tours", source: "seed", startsAt: at(1) }).error,
    /places do not take/,
  );
  assert.match(
    normalize({ type: "place", title: "x", category: "tours", source: "seed", lat: "high" }).error,
    /lat/,
  );
  assert.match(normalize({ type: "place", title: "x", category: "tours", source: "seed", lat: 91 }).error, /lat out of range/);
  assert.match(normalize({ type: "place", title: "x", category: "tours", source: "kirby" }).error, /source/);
  assert.match(normalize({ type: "place", title: "x", category: "tours", source: "seed", url: "http://x.com" }).error, /https/);
});

test("normalizeRecord fills a stable id, canonical dates, and drops unknown fields", () => {
  const n = normalize({ type: "event", title: "  Hello World  ", category: "events", source: "seed", junk: true, startsAt: "2026-10-01T18:00:00-07:00" });
  assert.equal(n.ok, true);
  assert.equal(n.record.id, "seed:hello-world");
  assert.equal(n.record.startsAt, "2026-10-02T01:00:00.000Z");
  assert.equal(n.record.junk, undefined);
  assert.ok(n.record.fetchedAt);
  assert.ok(n.record.firstSeenAt);
});

test("events expire at endsAt plus grace, places do not expire", () => {
  // endsAt + 24h grace: live just inside the window, expired just outside
  const event = (startsAt, endsAt) => ({ id: "e", type: "event", title: "e", category: "events", source: "luma", startsAt, endsAt });
  assert.equal(bay.isLive(event(at(-2), at(0, 1)), Date.now()), true);
  assert.equal(bay.isLive(event(at(-2), at(-2)), Date.now()), false);
  const startsOnly = { id: "e", type: "event", title: "e", category: "events", source: "luma", startsAt: at(0, -1) };
  const startMs = Date.parse(startsOnly.startsAt); // expiry counts from the start, not from the test's now
  assert.equal(bay.isLive(startsOnly, startMs + bay.EVENT_GRACE_MS - 1), true);
  assert.equal(bay.isLive(startsOnly, startMs + bay.EVENT_GRACE_MS + 1), false);
  const cancelled = { id: "e", type: "event", title: "e", category: "events", source: "luma", startsAt: at(2), expiresAt: at(-1) };
  assert.equal(bay.isLive(cancelled, Date.now()), false, "explicit expiresAt wins over a future start");
  const place = { id: "p", type: "place", title: "p", category: "tours", source: "seed" };
  assert.equal(bay.isLive(place, Date.parse(at(3650))), true, "places stay until removed");
});

test("liveFilter drops stale events and counts them", () => {
  const live = { id: "a", type: "event", title: "a", category: "events", source: "seed", startsAt: at(2) };
  const dead = { id: "b", type: "event", title: "b", category: "events", source: "seed", startsAt: at(-9), endsAt: at(-8) };
  const { live: kept, expiredCount } = bay.liveFilter([live, dead], Date.now());
  assert.deepEqual(kept.map((r) => r.id), ["a"]);
  assert.equal(expiredCount, 1);
});

test("mergeRecords updates in place, never duplicates, keeps firstSeenAt", () => {
  const a = { id: "x", type: "place", title: "x", category: "tours", source: "seed", fetchedAt: "t1", firstSeenAt: "t1" };
  const a2 = { id: "x", type: "place", title: "x", category: "tours", source: "seed", note: "new", fetchedAt: "t2", firstSeenAt: "t2" };
  const b = { id: "y", type: "place", title: "y", category: "tours", source: "seed", fetchedAt: "t1", firstSeenAt: "t1" };
  const one = bay.mergeRecords([], [a, b]);
  assert.deepEqual(one.created, 2);
  const two = bay.mergeRecords(one.records, [a2, b]);
  assert.equal(two.created, 0);
  assert.equal(two.updated, 1, "only the record that changed counts as updated");
  assert.equal(two.records.length, 2);
  const x = two.records.find((r) => r.id === "x");
  assert.equal(x.note, "new");
  assert.equal(x.fetchedAt, "t2");
  assert.equal(x.firstSeenAt, "t1", "earliest sighting survives the update");
});

test("ingest is idempotent: same fetch twice, ids stable, no duplicates", async () => {
  const dir = tmp();
  const entries = [lumaEntry("e1", "test hackathon weekend"), lumaEntry("e2", "community dinner")];
  const fetchImpl = fakeFetch(entries);
  const now1 = at(0);
  const now2 = at(0, 1);
  const seedEvents = bay.seedRecords("events").length;
  const seedPlaces = bay.seedRecords("places").length;
  assert.ok(seedEvents >= 1, "seed events must load — a broken seed path must fail loudly here");
  assert.ok(seedPlaces >= 1, "seed places must load — a broken seed path must fail loudly here");
  const s1 = await runIngest({ dataDir: dir, fetchImpl, now: now1 });
  assert.equal(s1.events.created, 2 + seedEvents);
  assert.equal(s1.places.created, seedPlaces);
  const ids1 = JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8")).records.map((r) => r.id);

  const s2 = await runIngest({ dataDir: dir, fetchImpl, now: now2 });
  assert.equal(s2.events.created, 0, "second run creates nothing");
  assert.equal(s2.places.created, 0);
  assert.equal(s2.events.updated, 2, "only the luma records change between runs; the seed is byte-stable");
  const ids2 = JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8")).records.map((r) => r.id);
  assert.deepEqual(ids2, ids1, "id set is a stable snapshot across runs");
  assert.equal(new Set(ids2).size, ids2.length, "no duplicates in the store");

  const luma = JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8")).records.find((r) => r.id === "luma:e1");
  assert.equal(luma.firstSeenAt, now1, "earliest sighting survives re-ingest");
  assert.equal(luma.fetchedAt, now2);
});

test("dry-run reports the plan and writes nothing", async () => {
  const dir = tmp();
  const s = await runIngest({ dataDir: dir, fetchImpl: fakeFetch([lumaEntry("e1", "test hackathon")]), now: at(0), dryRun: true });
  assert.equal(s.dryRun, true);
  assert.ok(s.events.incoming >= 1);
  assert.deepEqual(fs.readdirSync(dir), [], "dry run leaves the store untouched");
  await runIngest({ dataDir: dir, fetchImpl: fakeFetch([lumaEntry("e1", "test hackathon")]), now: at(0) });
  assert.ok(fs.existsSync(path.join(dir, "events.json")), "the real run writes");
});

test("luma mapping: stable id, canonical url, category heuristic, optional pin", () => {
  const n = lumaToRecord(lumaEntry("abc", "AI hackathon"), at(0));
  assert.equal(n.ok, true);
  assert.equal(n.record.id, "luma:abc");
  assert.equal(n.record.category, "hackathons");
  assert.equal(n.record.sourceUrl, "https://luma.com/slug-abc");
  assert.equal(n.record.source, "luma");
  assert.equal(n.record.lat, 37.77);
  const dinner = lumaToRecord(lumaEntry("def", "community dinner"), at(0));
  assert.equal(dinner.record.category, "events", "general listings get the honest bucket");
  const nopin = lumaToRecord({ event: { api_id: "ghi", name: "online talk", start_at: at(1) } }, at(0));
  assert.equal(nopin.ok, true);
  assert.equal(nopin.record.lat, undefined);
  assert.equal(nopin.record.venue, undefined);
  assert.match(lumaToRecord({ event: { name: "no id" } }, at(0)).error, /api_id/);
});

test("eventbrite stays a documented stub behind the source interface", async () => {
  const r = await ingestSources.eventbrite({});
  assert.deepEqual(r.records, []);
  assert.equal(r.errors.length, 0);
  assert.match(r.skipped, /2019/);
});

test("an unknown source name is an error, not a crash", async () => {
  const s = await runIngest({ dataDir: tmp(), only: "kirby", now: at(0) });
  assert.match(s.sources[0].errors[0], /unknown source/);
});

test("real luma ids are mixed-case and pass the slug rule verbatim", () => {
  const entry = lumaEntry("evt-UScGHdEzFFjCto6", "real id shape from the live api");
  const n = lumaToRecord(entry, at(0));
  assert.equal(n.ok, true);
  assert.equal(n.record.id, "luma:evt-UScGHdEzFFjCto6", "upstream ids keep their case — case-folding could collide distinct events");
});
