// api/_baydata.js
// The bay data contract: one record shape for events and places, the expiry rule, and
// the flat-file store io. Shared by the read handlers (api/events.js, api/places.js)
// and the ingestors (scripts/ingest.mjs) so they cannot drift. Underscore files are
// not routable. Schema and read api are the contract; the store format stays swappable
// (libsql/turso later, nothing heavier now).
//
// freshness honesty: every record carries source + fetchedAt. expiry is computed at
// serve time, not baked in: events die at expiresAt, else endsAt (or startsAt when no
// end is listed) + grace. places stay until someone removes them or sets expiresAt.

const { ENV } = require("./_env.js");
const log = require("./_log.js");
const fs = require("node:fs");
const path = require("node:path");

// categories are the map's layers. the six are the launch set from the spec; "events"
// is the honest bucket for general luma listings that are none of the others (a random
// ai meetup is not a hackathon, and pretending otherwise poisons the map's layers).
const CATEGORIES = ["housing", "sports", "tours", "hackathons", "offices", "startups", "events"];
const TYPES = ["event", "place"];
const SOURCES = ["seed", "luma", "eventbrite"];
// an event stays live this long past its last known moment. 24h: it is fresh the same
// night, gone the next morning.
const EVENT_GRACE_MS = 24 * 60 * 60 * 1000;
const TEXT_MAX = { title: 160, venue: 200, address: 300, note: 500, id: 120 };

const isBlank = (v) => v == null || v === "";
const isIso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const iso = (v) => new Date(v).toISOString();
const clampText = (v, max) => {
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
};
const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// validate and normalize one input record: { ok, record } or { ok: false, error }.
// allow-listed fields only, dates canonicalized to utc iso, so the store never holds junk.
function normalizeRecord(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== "object") return { ok: false, error: "record is not an object" };
  const out = {};
  const bad = (m) => ({ ok: false, error: m });

  if (!TYPES.includes(input.type)) return bad(`type must be one of ${TYPES.join("|")}`);
  out.type = input.type;
  if (!CATEGORIES.includes(input.category)) return bad(`category must be one of ${CATEGORIES.join("|")}`);
  out.category = input.category;
  const title = clampText(input.title, TEXT_MAX.title);
  if (!title) return bad("title is required");
  out.title = title;
  if (!SOURCES.includes(input.source)) return bad(`source must be one of ${SOURCES.join("|")}`);
  out.source = input.source;

  // id: stable per source. a re-ingest lands on the same id, which is what makes the
  // store idempotent (update in place, never duplicate).
  const rawId = isBlank(input.id) ? `${out.source}:${slugify(title)}` : String(input.id);
  // uppercase allowed: upstream ids are mixed-case (luma "evt-UScGHdEzFFjCto6") and
  // must be kept verbatim — case-folding them risks collapsing distinct events.
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(rawId)) return bad(`id "${rawId}" is not a slug`);
  out.id = rawId;

  for (const k of ["venue", "address", "note"]) {
    if (isBlank(input[k])) continue;
    const v = clampText(input[k], TEXT_MAX[k]);
    if (v) out[k] = v;
  }
  for (const k of ["url", "sourceUrl"]) {
    if (isBlank(input[k])) continue;
    if (!/^https:\/\//.test(String(input[k]))) return bad(`${k} must be an https url`);
    out[k] = String(input[k]);
  }
  for (const k of ["lat", "lng"]) {
    if (isBlank(input[k])) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n)) return bad(`${k} must be a number`);
    if (k === "lat" && Math.abs(n) > 90) return bad("lat out of range");
    if (k === "lng" && Math.abs(n) > 180) return bad("lng out of range");
    out[k] = n;
  }
  for (const k of ["startsAt", "endsAt", "expiresAt"]) {
    if (isBlank(input[k])) continue;
    if (!isIso(input[k])) return bad(`${k} must be a parseable date`);
    out[k] = iso(input[k]);
  }
  if (out.type === "event" && !out.startsAt) return bad("events need startsAt");
  if (out.type === "place" && (out.startsAt || out.endsAt)) return bad("places do not take startsAt/endsAt");

  out.fetchedAt = isIso(input.fetchedAt) ? iso(input.fetchedAt) : iso(now);
  out.firstSeenAt = isIso(input.firstSeenAt) ? iso(input.firstSeenAt) : out.fetchedAt;
  return { ok: true, record: out };
}

// when a record stops being live. null = no expiry (a place without expiresAt).
function expiryAt(record) {
  if (record.expiresAt) return Date.parse(record.expiresAt);
  if (record.type !== "event") return null;
  const end = record.endsAt || record.startsAt;
  return end ? Date.parse(end) + EVENT_GRACE_MS : null;
}
const isLive = (record, now = Date.now()) => {
  const t = expiryAt(record);
  return t == null || t > now;
};

// serve-time filter: stale events drop out of the live layer automatically. the store
// keeps the full history (no silent deletes); the read api only serves the live set.
function liveFilter(records, now = Date.now()) {
  const live = [];
  let expiredCount = 0;
  for (const r of records) isLive(r, now) ? live.push(r) : expiredCount++;
  return { live, expiredCount };
}

const sourcesOf = (records) => [...new Set(records.map((r) => r.source))].sort();

const stripFirstSeen = (r) => {
  const { firstSeenAt, ...rest } = r;
  return rest;
};

// merge incoming into the store by id: update in place, never duplicate. the original
// firstSeenAt survives so provenance keeps its earliest sighting.
function mergeRecords(existing, incoming) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  let created = 0;
  let updated = 0;
  for (const r of incoming) {
    const prev = byId.get(r.id);
    if (!prev) {
      byId.set(r.id, r);
      created++;
      continue;
    }
    const next = { ...prev, ...r, firstSeenAt: prev.firstSeenAt || r.firstSeenAt };
    if (JSON.stringify(stripFirstSeen(prev)) !== JSON.stringify(stripFirstSeen(next))) updated++;
    byId.set(r.id, next);
  }
  const records = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { records, created, updated };
}

// store io. data/events.json + data/places.json, envelope { updatedAt, records }.
// gitignored at runtime; data/seed/*.json (committed) is the fallback so a fresh
// deploy serves a real bay before the first ingest lands.
// type here is the plural file key ("events" | "places") — do not append an "s".
const storePath = (dataDir, type) => path.join(dataDir, `${type}.json`);
const REPO_SEED_DIR = path.resolve(__dirname, "..", "data", "seed");

function readRecords(file, { source }) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    log.warn("baydata.read", { file, err: e });
    return null;
  }
  const list = Array.isArray(raw) ? raw : raw.records || [];
  const records = [];
  for (const r of list) {
    const n = normalizeRecord(r, { source });
    if (n.ok) records.push(n.record);
    else log.warn("baydata.record", { file, err: n.error });
  }
  return records;
}

// committed curated seed, already normalized and deduped.
function seedRecords(type) {
  const records = readRecords(path.join(REPO_SEED_DIR, `${type}.json`), { source: "seed" }) || [];
  return mergeRecords([], records).records;
}

function loadStore(dataDir, type) {
  return readRecords(storePath(dataDir, type), { source: undefined });
}

function saveStore(dataDir, type, records) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = storePath(dataDir, type);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), records }, null, "\t") + "\n");
  fs.renameSync(tmp, file);
  return file;
}

// the runtime store when it exists, the committed seed when it does not.
function loadStoreOrSeed(dataDir, type) {
  const records = loadStore(dataDir, type);
  if (records) return { records, fromStore: true };
  return { records: seedRecords(type), fromStore: false };
}

// one read handler for both stores: get/head only, 15 min edge cache like /api/github.
function storeHandler(type) {
  return async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      res.statusCode = 405;
      return res.end();
    }
    const now = Date.now();
    const store = loadStoreOrSeed(ENV.dataDir, type);
    const { live, expiredCount } = liveFilter(store.records, now);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=900, stale-while-revalidate=3600");
    res.end(
      JSON.stringify({
        [type]: live,
        total: live.length,
        expired: expiredCount,
        store: store.fromStore ? "store" : "seed",
        sources: sourcesOf(live),
        asOf: new Date(now).toISOString(),
      }),
    );
  };
}

module.exports = {
  CATEGORIES,
  TYPES,
  SOURCES,
  EVENT_GRACE_MS,
  normalizeRecord,
  expiryAt,
  isLive,
  liveFilter,
  sourcesOf,
  mergeRecords,
  seedRecords,
  loadStore,
  saveStore,
  loadStoreOrSeed,
  storeHandler,
};
