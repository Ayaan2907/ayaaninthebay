/* /bay: the bay area as a real map. maplibre gl from a cdn, free raster tiles
   with no key and no build step: openstreetmap standard for day, esri dark
   gray canvas for night (carto's legacy raster urls now answer with an
   "api key required" watermark, so they are out). places and their notes live
   in /assets/bay/places.json; every dot carries a first-person note.
   standalone surface: loads nothing from the terminal. deep links back via /?q=. */
(function () {
  const hud = document.getElementById("bayHud");
  const nightBtn = document.getElementById("bayNight");
  const card = document.getElementById("bayCard");
  const layersEl = document.getElementById("bayLayers");

  // honest failure: the cdn did not arrive. say so instead of shipping a dead page.
  if (typeof maplibregl === "undefined") {
    hud.textContent = "map library failed to load — check the network";
    return;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // layer catalog: id, label, dot color. colors read on both tile styles.
  const CATS = [
    { id: "startup", label: "startups", color: "#e7a55b" },
    { id: "office", label: "offices", color: "#8a8883" },
    { id: "housing", label: "housing", color: "#6fb3a3" },
    { id: "sports", label: "sports", color: "#6e8fd8" },
    { id: "tour", label: "tours", color: "#b57edc" },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const dotLayers = CATS.map((c) => `dot-${c.id}`);
  // events are a layer of their own, fed from /api/events (the live store), not places.json.
  const EVENT_COLOR = "#d95f5f";
  // hud counts; the scoring flow (score.js) tops up the events side after its fetch resolves
  const counts = { places: 0, events: 0, geo: 0 };
  function renderHud() {
    const bits = [`${counts.places} places`];
    if (counts.events) bits.push(counts.geo === counts.events ? `${counts.events} events` : `${counts.geo} of ${counts.events} events on the map`);
    bits.push(`${CATS.length + (counts.events ? 1 : 0)} layers`);
    hud.textContent = bits.join(" · ");
  }

  // free raster tiles, no key: openstreetmap standard for day, esri dark gray
  // canvas for night. both public; attribution stays on screen via the layers panel.
  const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
  const OSM = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
  const ESRI_DARK = ["https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"];
  const PAPER = () => (isDark() ? "#0b0b0c" : "#faf9f6");
  const INK = () => (isDark() ? "#e8e6e1" : "#1a1a18");
  function styleFor() {
    return {
      version: 8,
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
      sources: {
        "tiles-light": { type: "raster", tiles: OSM, tileSize: 256, maxzoom: 19, attribution: "© openstreetmap contributors" },
        "tiles-dark": { type: "raster", tiles: ESRI_DARK, tileSize: 256, maxzoom: 16, attribution: "© esri" },
      },
      layers: [
        { id: "paper", type: "background", paint: { "background-color": PAPER() } },
        { id: "raster-light", type: "raster", source: "tiles-light", paint: { "raster-fade-duration": 150 } },
        { id: "raster-dark", type: "raster", source: "tiles-dark", layout: { visibility: isDark() ? "visible" : "none" }, paint: { "raster-fade-duration": 150 } },
      ],
    };
  }

  // sf in the upper half of the frame, the south bay still on screen
  const map = new maplibregl.Map({
    container: "bayMap",
    center: [-122.3, 37.67],
    zoom: 10.3,
    style: styleFor(),
    attributionControl: false, // attribution lives in the layers panel, always on screen
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  window.__bay = { map, addEvents }; // test hooks: project coordinates, drive the map, feed the events layer

  /* ---------- places: dots, labels, toggles ---------- */
  const visible = Object.fromEntries(CATS.map((c) => [c.id, true]));
  visible.events = true;
  function addPlaces(gj) {
    map.addSource("places", { type: "geojson", data: gj });
    for (const c of CATS) {
      map.addLayer({
        id: `dot-${c.id}`, type: "circle", source: "places",
        filter: ["==", ["get", "cat"], c.id],
        paint: {
          "circle-radius": 6,
          "circle-color": c.color,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": PAPER(),
        },
      });
      map.addLayer({
        id: `tag-${c.id}`, type: "symbol", source: "places", minzoom: 10,
        filter: ["==", ["get", "cat"], c.id],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" },
        paint: { "text-color": INK(), "text-halo-color": PAPER(), "text-halo-width": 1.4 },
      });
    }
    for (const l of dotLayers) {
      map.on("mouseenter", l, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; });
    }
  }

  function buildToggles(gj) {
    const counts = {};
    for (const f of gj.features) counts[f.properties.cat] = (counts[f.properties.cat] || 0) + 1;
    layersEl.innerHTML =
      `<div class="l-head"><span class="l-title">layers</span><span class="l-tip">click a dot for the story</span></div>` +
      CATS.map((c) =>
        `<label class="l-row" data-cat="${c.id}"><input type="checkbox" checked><i class="dot" style="background:${c.color}"></i>${c.label}<span class="count">${counts[c.id] || 0}</span></label>`
      ).join("") +
      `<div class="l-foot">tiles © openstreetmap contributors · © esri · maplibre gl</div>`;
    for (const row of layersEl.querySelectorAll(".l-row")) {
      const id = row.getAttribute("data-cat");
      row.querySelector("input").addEventListener("change", (e) => {
        visible[id] = e.target.checked;
        row.classList.toggle("off", !visible[id]);
        const v = visible[id] ? "visible" : "none";
        map.setLayoutProperty(`dot-${id}`, "visibility", v);
        map.setLayoutProperty(`tag-${id}`, "visibility", v);
      });
    }
    layersEl.hidden = false;
  }

  /* ---------- events: dots from the live store, scored on click ---------- */
  function addEvents(features, total = features.length) {
    map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({
      id: "dot-events", type: "circle", source: "events",
      paint: { "circle-radius": 7, "circle-color": EVENT_COLOR, "circle-stroke-width": 2, "circle-stroke-color": PAPER() },
    });
    map.addLayer({
      id: "tag-events", type: "symbol", source: "events", minzoom: 11,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" },
      paint: { "text-color": INK(), "text-halo-color": PAPER(), "text-halo-width": 1.4 },
    });
    map.on("mouseenter", "dot-events", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "dot-events", () => { map.getCanvas().style.cursor = ""; });
    addEventsRow(features.length, total);
    counts.events = total;
    counts.geo = features.length;
    renderHud();
  }

  // the events row joins the place rows, above the attribution foot
  function addEventsRow(count, total) {
    const foot = layersEl.querySelector(".l-foot");
    if (!foot) return;
    const row = document.createElement("label");
    row.className = "l-row";
    row.setAttribute("data-cat", "events");
    row.innerHTML = `<input type="checkbox" checked><i class="dot" style="background:${EVENT_COLOR}"></i>events<span class="count">${count}${total > count ? ` of ${total}` : ""}</span>`;
    foot.insertAdjacentElement("beforebegin", row);
    row.querySelector("input").addEventListener("change", (e) => {
      visible.events = e.target.checked;
      row.classList.toggle("off", !visible.events);
      const v = visible.events ? "visible" : "none";
      if (map.getLayer("dot-events")) map.setLayoutProperty("dot-events", "visibility", v);
      if (map.getLayer("tag-events")) map.setLayoutProperty("tag-events", "visibility", v);
    });
  }

  /* ---------- the narrative card ---------- */
  function openCard(f) {
    const p = f.properties;
    const c = CAT[p.cat];
    const ext = /^https?:/.test(p.source || "");
    const src = p.source ? `<a href="${esc(p.source)}" ${ext ? 'target="_blank" rel="noopener"' : ""}>open →</a>` : "";
    const ask = `<a href="/?q=${encodeURIComponent("tell me about " + p.name)}">ask in terminal</a>`;
    card.innerHTML = `<div class="k"><span class="tag">${esc(c ? c.label : p.cat)}</span></div>` +
      `<div class="n">${esc(p.name)}</div><div class="b">${esc(p.note)}</div>` +
      (p.source || ask ? `<div class="actions">${src}${ask}</div>` : "");
    card.hidden = false;
    if (!reduced) map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 11.5), duration: 500 });
  }
  function clearCard() { card.hidden = true; }
  card.addEventListener("click", (e) => { if (e.target === card) clearCard(); });

  map.on("click", (e) => {
    const live = dotLayers.filter((l) => map.getLayer(l) && visible[l.replace("dot-", "")]);
    const slop = 12; // px of forgiveness — dots are small, clicks (and fingers) miss
    const box = [[e.point.x - slop, e.point.y - slop], [e.point.x + slop, e.point.y + slop]];
    const hits = map.queryRenderedFeatures(box, { layers: live });
    if (hits.length > 1) {
      const dist = (f) => { const q = map.project(f.geometry.coordinates); return Math.hypot(q.x - e.point.x, q.y - e.point.y); };
      hits.sort((a, b) => dist(a) - dist(b));
    }
    if (!hits.length) return clearCard();
    // event dots hand the card to the scoring flow once it is loaded
    if (hits[0].source === "events" && window.__bay.onEventClick) return window.__bay.onEventClick(hits[0]);
    openCard(hits[0]);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === "Escape") clearCard();
  });

  /* ---------- night ---------- */
  function setNight(dark) {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (err) {}
    nightBtn.textContent = dark ? "d · day" : "n · night";
    if (map.getLayer("paper")) map.setPaintProperty("paper", "background-color", PAPER());
    if (map.getLayer("raster-light")) {
      map.setLayoutProperty("raster-light", "visibility", dark ? "none" : "visible");
      map.setLayoutProperty("raster-dark", "visibility", dark ? "visible" : "none");
    }
    for (const c of [...CATS.map((x) => x.id), "events"]) {
      if (map.getLayer(`dot-${c}`)) map.setPaintProperty(`dot-${c}`, "circle-stroke-color", PAPER());
      if (map.getLayer(`tag-${c}`)) {
        map.setPaintProperty(`tag-${c}`, "text-color", INK());
        map.setPaintProperty(`tag-${c}`, "text-halo-color", PAPER());
      }
    }
  }
  nightBtn.addEventListener("click", () => setNight(!isDark()));
  document.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === "n") setNight(!isDark());
  });

  /* ---------- boot ---------- */
  map.on("load", () => {
    fetch("/assets/bay/places.json")
      .then((r) => { if (!r.ok) throw new Error("places fetch: " + r.status); return r.json(); })
      .then((gj) => {
        addPlaces(gj);
        buildToggles(gj);
        counts.places = gj.features.length;
        renderHud();
      })
      .catch((err) => {
        // never swallow it: the map still pans and zooms, the dots just do not show
        console.error("bay: places failed to load", err);
        hud.textContent = "places failed to load — the map still works, try a reload";
      });
  });
  map.on("error", (e) => { if (e && e.error) console.error("bay map:", e.error); });
})();
