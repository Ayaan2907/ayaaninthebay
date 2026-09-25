import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// the persona weights module is pure and shared by both surfaces, so the tests
// pin its behavior from node. the browser copy is byte-identical: same file,
// loaded as a global. the server-side rank over the live store is pinned by the
// http tests in bayapi.test.mjs, the client re-rank by the qa screenshots.
const require = createRequire(import.meta.url);
const personas = require(new URL("../assets/bay/personas.js", import.meta.url).pathname);

const S = (id, cat, text) => ({ id, category: cat, title: text, venue: "", note: text });

test("personas: three launch personas, stable ids", () => {
  assert.deepEqual(personas.PERSONA_IDS, ["hiring", "raising", "newcomer"]);
  for (const id of personas.PERSONA_IDS) {
    const p = personas.resolvePersona(id);
    assert.ok(p.label && p.button && p.why && p.intent, `${id} carries its ui words`);
    assert.ok(p.intent.length <= 80, "the intent leads the goal channel, so it stays short");
  }
  assert.equal(personas.resolvePersona("nope"), null);
});

test("personas: category canon folds both vocabularies to one", () => {
  // a store record (plural) and a static place feature (singular) for the same
  // kind of dot must weigh the same, or the map would rank them apart
  const hiring = personas.resolvePersona("hiring");
  const storeRecord = { id: "luma:hack", category: "hackathons", title: "ai hackathon weekend", note: "builders ship fast" };
  const placeFeature = { id: "hack-venue", cat: "startup", name: "a startup office", note: "engineers everywhere" };
  assert.equal(personas.personaFit(hiring, storeRecord), personas.personaFit(hiring, { ...storeRecord, category: undefined, cat: "hackathons" }));
  const fit = personas.personaFit(hiring, placeFeature);
  assert.ok(fit > 0, `a startup office reads as hiring ground, got ${fit}`);
  assert.equal(personas.personaFit(hiring, { ...placeFeature, cat: "startups" }), fit, "singular and plural categories agree");
});

test("personas: fit is deterministic, bounded, and reads both record shapes", () => {
  const hiring = personas.resolvePersona("hiring");
  const r = S("luma:x", "hackathons", "ai agents hackathon weekend, builders ship fast");
  assert.equal(personas.personaFit(hiring, r), personas.personaFit(hiring, r), "same inputs, same fit");
  for (const id of personas.PERSONA_IDS) {
    for (const rec of [r, S("p:y", "tours", "food tour for newcomers")]) {
      const f = personas.personaFit(personas.resolvePersona(id), rec);
      assert.ok(f >= 0 && f <= 1, `fit stays in 0..1, got ${f}`);
    }
  }
  assert.equal(personas.personaFit(hiring, null), 0);
  assert.equal(personas.personaFit(null, r), 0);
});

test("personas: each persona ranks its own world first (fixed store)", () => {
  const store = [
    S("luma:hackathon", "hackathons", "ai agents hackathon weekend, builders ship fast, recruiters watch"),
    S("luma:demo-night", "events", "founder demo night, eight startups pitch to a panel of investors"),
    S("luma:food-tour", "tours", "mission district food tour for newcomers, walk and taste"),
    S("luma:pickup-soccer", "sports", "casual pickup soccer in the park, newcomers welcome"),
  ];
  const top = (id) => personas.rank(personas.resolvePersona(id), store)[0].id;
  assert.equal(top("hiring"), "luma:hackathon");
  assert.equal(top("raising"), "luma:demo-night");
  assert.equal(top("newcomer"), "luma:food-tour");

  // the cross-checks that make it a ranking layer and not a label: each persona
  // puts its own room above the others' rooms
  const order = (id) => personas.rank(personas.resolvePersona(id), store).map((r) => r.id);
  const h = order("hiring");
  const r = order("raising");
  const n = order("newcomer");
  assert.ok(h.indexOf("luma:hackathon") < h.indexOf("luma:food-tour"));
  assert.ok(r.indexOf("luma:demo-night") < r.indexOf("luma:hackathon"));
  assert.ok(n.indexOf("luma:food-tour") < n.indexOf("luma:demo-night"));
  assert.ok(n.indexOf("luma:pickup-soccer") < n.indexOf("luma:demo-night"));
});

test("personas: rank is stable, sorted by fit, ties break by id", () => {
  const hiring = personas.resolvePersona("hiring");
  const store = [
    S("luma:b-event", "events", "a plain listing"),
    S("luma:a-event", "events", "a plain listing"), // same category, same words: pure id tie
    S("luma:hack", "hackathons", "hackathon for engineers"),
  ];
  const a = personas.rank(hiring, store);
  const b = personas.rank(hiring, store);
  assert.deepEqual(a, b, "rank twice, same order");
  assert.equal(a[0].id, "luma:hack");
  assert.equal(a[1].id, "luma:a-event", "ties break by id, not insertion order");
  assert.equal(a[2].id, "luma:b-event");
  assert.ok(a[0].fit > a[1].fit);
  for (const entry of a) assert.ok(Number.isFinite(entry.fit) && entry.fit >= 0 && entry.fit <= 1);
});

test("personas: rank drops id-less records and empty stores", () => {
  const newcomer = personas.resolvePersona("newcomer");
  assert.deepEqual(personas.rank(newcomer, []), []);
  assert.deepEqual(personas.rank(newcomer, [{ category: "tours", title: "no id here" }]), []);
  assert.deepEqual(personas.rank(newcomer, null), []);
});

test("personas: combineGoal feeds the scorer's goal channel only", () => {
  assert.equal(personas.combineGoal(null, "meet builders"), "meet builders", "no persona, no change");
  assert.equal(personas.combineGoal("nope", "meet builders"), "meet builders");
  const hiring = personas.resolvePersona("hiring");
  assert.equal(personas.combineGoal("hiring", ""), hiring.intent, "persona alone fills the goal");
  assert.equal(personas.combineGoal("hiring", "meet rust devs"), `${hiring.intent}. meet rust devs`, "persona leads, user words follow");
  assert.equal(personas.combineGoal("raising", "   "), personas.resolvePersona("raising").intent, "a whitespace goal counts as none");
});
