import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// the map eats this file at open. keep the shape honest: real geojson points,
// bay area bounds, a fixed category enum, and a note on every dot. never a bare pin.
const places = JSON.parse(readFileSync(new URL("../assets/bay/places.json", import.meta.url), "utf8"));
const CATS = ["startup", "office", "housing", "sports", "tour"];
const BOUNDS = { lng: [-123.6, -121.6], lat: [36.8, 38.4] };

test("places.json is a geojson featurecollection of point features", () => {
  assert.equal(places.type, "FeatureCollection");
  assert.ok(Array.isArray(places.features) && places.features.length >= 10, "a map with three dots is a stub");
  for (const f of places.features) {
    assert.equal(f.type, "Feature");
    assert.equal(f.geometry.type, "Point");
    assert.ok(Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length === 2, "coordinates are [lng, lat]");
  }
});

test("every coordinate is a real bay area lng/lat, in bounds", () => {
  for (const f of places.features) {
    const [lng, lat] = f.geometry.coordinates;
    assert.ok(typeof lng === "number" && typeof lat === "number", `non-numeric coordinate on ${f.properties.id}`);
    assert.ok(lng > BOUNDS.lng[0] && lng < BOUNDS.lng[1], `lng ${lng} out of the bay (${f.properties.id})`);
    assert.ok(lat > BOUNDS.lat[0] && lat < BOUNDS.lat[1], `lat ${lat} out of the bay (${f.properties.id})`);
  }
});

test("every place has a category from the layer enum and a real note", () => {
  for (const f of places.features) {
    const p = f.properties;
    assert.ok(p && typeof p === "object", "every feature carries properties");
    assert.ok(CATS.includes(p.cat), `bad category "${p.cat}" on ${p.id}`);
    assert.ok(typeof p.name === "string" && p.name.trim().length > 0, `nameless place: ${p.id}`);
    assert.ok(typeof p.note === "string" && p.note.trim().length >= 20, `bare pin: ${p.id} needs a real note`);
    if (p.source !== undefined) assert.equal(typeof p.source, "string", `bad source on ${p.id}`);
  }
});

test("ids are unique so the map can address every dot", () => {
  const ids = places.features.map((f) => f.properties && f.properties.id);
  for (const id of ids) assert.ok(typeof id === "string" && id.length > 0, "every place needs an id");
  assert.equal(new Set(ids).size, ids.length, "duplicate ids");
});

test("every category in the enum is used, so no layer ships empty", () => {
  const used = new Set(places.features.map((f) => f.properties.cat));
  for (const c of CATS) assert.ok(used.has(c), `layer "${c}" has no places`);
});
