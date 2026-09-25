// assets/bay/personas.js: persona views: query weights over the event and place
// store. one module serves both sides, the same way content/knowledge.js serves
// node and the terminal: the read apis (api/_baydata.js) rank the live store with
// it server side, and the /bay surface loads it as a browser global to re-rank
// what the map emphasizes. one weights file, so the two can never drift apart.
//
// a persona is a ranking layer, not a scorer: it reorders which dots surface
// first. the per-event go/no-go still comes from the one scorer in
// api/_scoring.js; a persona reaches scoring only through that scorer's goal
// channel (combineGoal below), so the calibration stays in exactly one place.
// everything here is pure and deterministic: fixed store, fixed ranking.

// the store speaks plural categories (api/_baydata.js CATEGORIES); the static
// places geojson predates it with singular ones. canon folds both vocabularies
// to one, so a startup dot and a startups record weigh the same.
const CANON = {
  // the store's own plural vocabulary
  housing: "housing",
  sports: "sports",
  tours: "tours",
  hackathons: "hackathons",
  offices: "offices",
  startups: "startups",
  events: "events",
  // the static places geojson predates the store and speaks singular
  startup: "startups",
  office: "offices",
  tour: "tours",
};

// same tokenizer idea as api/_scoring.js, kept self-contained so this file
// requires nothing and loads anywhere.
const STOP = new Set(
  "a an and are as at be but by for from in is it its of on or that the this to with".split(" "),
);
const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

const textOf = (r) => [r.title, r.name, r.note, r.venue, r.address].filter(Boolean).join(". ");

const PERSONAS = {
  hiring: {
    id: "hiring",
    label: "founder hiring",
    button: "hiring",
    intent: "meet engineers and people i could hire",
    why: "puts hackathons, startup rooms and offices first",
    // category weights carry the layer; every store category gets an explicit
    // weight so a record type is never silently read as something else.
    categories: { hackathons: 1, startups: 0.8, offices: 0.7, events: 0.5, sports: 0.2, tours: 0.1, housing: 0.1 },
    tokens: ["hiring", "recruiting", "engineers", "developers", "cofounder", "candidates", "hackathon", "builders", "careers", "devs"],
  },
  raising: {
    id: "raising",
    label: "founder raising",
    button: "raising",
    intent: "meet investors and founders who have raised",
    why: "puts investor and founder rooms first",
    categories: { startups: 1, offices: 0.7, hackathons: 0.5, events: 0.5, sports: 0.1, tours: 0.1, housing: 0 },
    tokens: ["investors", "vc", "venture", "pitch", "raising", "seed", "demo", "founders", "angels", "fund"],
  },
  newcomer: {
    id: "newcomer",
    label: "new in town",
    button: "new in town",
    intent: "get to know the city and meet new people",
    why: "puts tours, housing and sports first",
    categories: { tours: 1, housing: 0.8, sports: 0.7, events: 0.5, startups: 0.3, offices: 0.2, hackathons: 0.2 },
    tokens: ["tour", "walk", "newcomers", "neighbors", "market", "park", "food", "pickup", "museum", "free"],
  },
};

const PERSONA_IDS = Object.keys(PERSONAS);
const round2 = (n) => Math.round(n * 100) / 100;

const resolvePersona = (id) => (id && PERSONAS[id]) || null;

// one record, one persona, one fit in 0..1. category weight carries 60%, token
// overlap in the record's own words carries 40%. reads both record shapes: store
// records (category/title/venue/note) and static place features (cat/name/note).
function personaFit(persona, record) {
  if (!persona || !record || typeof record !== "object") return 0;
  const cat = CANON[record.category ?? record.cat] || "events";
  const catW = persona.categories[cat] != null ? persona.categories[cat] : 0.3;
  const words = new Set(tokenize(textOf(record)));
  const hits = persona.tokens.filter((t) => words.has(t)).length;
  const textScore = persona.tokens.length ? hits / persona.tokens.length : 0;
  return round2(Math.min(1, Math.max(0, 0.6 * catW + 0.4 * textScore)));
}

// rank records for one persona: fit desc, ties break by id so the order is
// stable across runs and across the server and browser copies of this module.
// records without an id cannot be ranked onto the map, so they drop out.
function rank(persona, records) {
  return (Array.isArray(records) ? records : [])
    .filter((r) => r && r.id != null)
    .map((r) => ({ id: String(r.id), fit: personaFit(persona, r) }))
    .sort((a, b) => b.fit - a.fit || a.id.localeCompare(b.id));
}

// the persona reaches the scorer through the goal channel only: the intent line
// leads, the visitor's own words follow. no persona, no change. the user goal
// arrives already capped (api/score.js slices to 400 before calling this).
function combineGoal(personaId, goal) {
  const p = resolvePersona(personaId);
  const user = String(goal || "").trim();
  if (!p) return user;
  return [p.intent, user].filter(Boolean).join(". ");
}

const BAY_PERSONAS = { PERSONAS, PERSONA_IDS, resolvePersona, personaFit, rank, combineGoal };
if (typeof module !== "undefined") module.exports = BAY_PERSONAS;
if (typeof window !== "undefined") window.BAY_PERSONAS = BAY_PERSONAS;
