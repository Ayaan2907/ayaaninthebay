#!/usr/bin/env node
// ingest.mjs — fill the bay store (data/events.json, data/places.json). zero dependencies.
//
//   node scripts/ingest.mjs                  every source, then write the store
//   node scripts/ingest.mjs --dry-run        report what would change, write nothing
//   node scripts/ingest.mjs --source=luma    one source instead of all of them
//
// every record carries source + fetchedAt, ids are stable per source, and re-runs
// merge in place, so the ingest is idempotent: run it nightly or twice a minute and
// the store never grows duplicates. a listing that vanishes upstream is not deleted
// here either; it simply ages past its expiry and drops out of the read api.
//
// sources:
//   seed       data/seed/*.json, committed, curated for launch
//   luma       public discovery api at api.luma.com, no key, no auth
//   eventbrite documented stub (see below)

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ENV } = require(path.join(ROOT, "api", "_env.js"));
const log = require(path.join(ROOT, "api", "_log.js"));
const bay = require(path.join(ROOT, "api", "_baydata.js"));

const USAGE = `usage: node scripts/ingest.mjs [--dry-run] [--source=seed|luma|eventbrite]

  --dry-run          merge in memory, report what would change, write nothing
  --source=<name>    run one source instead of all of them
  --help             this text
`;

const LUMA_HOST = "https://api.luma.com";
const PAGE_SIZE = 25; // observed working page sizes top out around 20-25
const MAX_PAGES = 3; // 75 events per city per run is plenty for launch
const PAGE_DELAY_MS = 1000; // the discovery api throttles aggressive paging

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "ayaan-site-ingest/0.1" },
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// one luma discovery entry -> a record input for the store. coords come with the
// entry when the host shares them; online or hidden-address events keep their venue
// text and simply have no pin. category: name says hackathon -> hackathons, anything
// else -> events (the honest bucket; the curated seed carries the specific layers).
function lumaToRecord(entry, now) {
  const ev = entry.event || {};
  const geo = ev.geo_address_info || {};
  const coord = ev.coordinate || {};
  const name = typeof ev.name === "string" ? ev.name.trim() : "";
  if (!ev.api_id || !name) return { ok: false, error: "luma entry missing api_id or name" };
  const category = /hack/i.test(name) ? "hackathons" : "events";
  const address = geo.full_address || geo.city_state || undefined;
  return bay.normalizeRecord(
    {
      id: `luma:${ev.api_id}`,
      type: "event",
      title: name,
      category,
      startsAt: ev.start_at || undefined,
      endsAt: ev.end_at || undefined,
      lat: coord.latitude ?? undefined,
      lng: coord.longitude ?? undefined,
      venue: address,
      address,
      source: "luma",
      sourceUrl: ev.url ? `https://luma.com/${ev.url}` : undefined,
      fetchedAt: now,
    },
    { now },
  );
}

// luma public discovery: get-paginated-events, keyed by place slug (sf self-scopes),
// paginated by an opaque cursor. no key, no cookies, no special headers.
async function lumaSource({ fetchImpl = fetch, now }) {
  const cities = ENV.lumaCities.split(",").map((s) => s.trim()).filter(Boolean);
  const records = [];
  const errors = [];
  for (const city of cities) {
    let cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${LUMA_HOST}/discover/get-paginated-events`);
      url.searchParams.set("slug", city);
      url.searchParams.set("pagination_limit", String(PAGE_SIZE));
      if (cursor) url.searchParams.set("pagination_cursor", cursor);
      let data;
      try {
        data = await getJson(url, fetchImpl);
      } catch (e) {
        errors.push(`luma ${city} page ${page + 1}: ${e.message}`);
        break;
      }
      for (const entry of data.entries || []) {
        const n = lumaToRecord(entry, now);
        if (n.ok) records.push(n.record);
        else errors.push(`luma ${city}: ${n.error}`);
      }
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }
  return { name: "luma", records, errors };
}

// eventbrite has no honest keyless path left: their public search api closed in 2019,
// and the consumer site's search endpoint needs a browser csrf handshake, which is
// neither stable nor fair to lean on. the stub keeps the source interface so a
// tokened v3 path (organizer event lists, event-by-id) can slot in later without
// touching the store, the merge or the handlers. see docs/deploy.md.
async function eventbriteSource() {
  return {
    name: "eventbrite",
    records: [],
    errors: [],
    skipped:
      "no public keyless search endpoint (eventbrite removed public search in 2019). stub behind the source interface; a documented oauth path can replace it later.",
  };
}

// the committed seed always has something to say; normalize + dedupe it like any source.
function seedSource() {
  const records = [...bay.seedRecords("events"), ...bay.seedRecords("places")];
  return { name: "seed", records, errors: [] };
}

const SOURCES = { seed: seedSource, luma: lumaSource, eventbrite: eventbriteSource };

// merge every source into the two stores. returns a summary; --dry-run stops before
// the write. a source that fails logs its errors and still lets the others merge.
let running = false;
async function runIngest(options = {}) {
  const {
    dryRun = false,
    only = null,
    fetchImpl = fetch,
    dataDir = path.join(ROOT, "data"),
    now = new Date().toISOString(),
  } = options;
  if (running) return { skipped: true, reason: "an ingest run is already in progress" };
  running = true;
  try {
    const names = only ? [only] : Object.keys(SOURCES);
    const results = [];
    for (const name of names) {
      const src = SOURCES[name];
      if (!src) {
        results.push({ name, records: [], errors: [`unknown source "${name}"`] });
        continue;
      }
      try {
        results.push(await src({ fetchImpl, now, dataDir }));
      } catch (e) {
        results.push({ name, records: [], errors: [String((e && e.message) || e)] });
      }
    }

    const summary = { dryRun, dataDir, ranAt: now, sources: [], events: null, places: null };
    // file keys are plural ("events"), record types are singular ("event")
    const TYPE_OF = { events: "event", places: "place" };
    for (const type of ["events", "places"]) {
      const incoming = results.flatMap((r) => (r.records || []).filter((x) => x.type === TYPE_OF[type]));
      const current = bay.loadStore(dataDir, type) || [];
      const merged = bay.mergeRecords(current, incoming);
      summary[type] = {
        total: merged.records.length,
        created: merged.created,
        updated: merged.updated,
        incoming: incoming.length,
      };
      if (!dryRun && merged.created + merged.updated > 0) {
        bay.saveStore(dataDir, type, merged.records);
      }
    }
    summary.sources = results.map(({ name, records, errors = [], skipped }) => ({
      name,
      fetched: (records || []).length,
      errors,
      ...(skipped ? { skipped } : {}),
    }));
    log.info(dryRun ? "ingest.dry-run" : "ingest.run", summary);
    return summary;
  } finally {
    running = false;
  }
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.some((a) => a !== "--dry-run" && !a.startsWith("--source="))) {
    process.stderr.write(USAGE);
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const onlyArg = args.find((a) => a.startsWith("--source="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;
  const summary = await runIngest({ dryRun, only });
  const errors = (summary.sources || []).flatMap((s) => s.errors || []);
  for (const e of errors) process.stderr.write(`error: ${e}\n`);
  return errors.length ? 1 : 0;
}

// run as a cli when invoked directly; imported as a module (server timer, tests) otherwise.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli()
    .then((code) => process.exit(code))
    .catch((e) => {
      log.error("ingest.cli", { err: e });
      process.exit(1);
    });
}

export { runIngest, lumaToRecord, SOURCES as ingestSources };
