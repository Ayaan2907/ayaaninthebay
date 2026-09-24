/* /bay: the bay area as a real map. maplibre gl from a cdn, raster tiles from
   carto (openstreetmap data, no key, no build step). this replaces the
   hand-rolled canvas city; places and their notes live in /assets/bay/places.json.
   standalone surface: loads nothing from the terminal. deep links back via /?q=. */
(function () {
  const hud = document.getElementById("bayHud");
  const nightBtn = document.getElementById("bayNight");

  // honest failure: the cdn did not arrive. say so instead of shipping a dead page.
  if (typeof maplibregl === "undefined") {
    hud.textContent = "map library failed to load — check the network";
    return;
  }

  // carto raster basemaps: light_all for day, dark_all for night. openstreetmap data, no key.
  const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
  const cartoTiles = (dark) => ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}.png`);
  const PAPER = () => (isDark() ? "#0b0b0c" : "#faf9f6");
  const ATTRIB = "© openstreetmap contributors © carto";
  function styleFor() {
    return {
      version: 8,
      sources: {
        "tiles-light": { type: "raster", tiles: cartoTiles(false), tileSize: 256, attribution: ATTRIB },
        "tiles-dark": { type: "raster", tiles: cartoTiles(true), tileSize: 256, attribution: ATTRIB },
      },
      layers: [
        { id: "paper", type: "background", paint: { "background-color": PAPER() } },
        { id: "raster-light", type: "raster", source: "tiles-light", paint: { "raster-fade-duration": 150 } },
        { id: "raster-dark", type: "raster", source: "tiles-dark", layout: { visibility: isDark() ? "visible" : "none" }, paint: { "raster-fade-duration": 150 } },
      ],
    };
  }

  // sf pulled south so the whole bay fits the first screen: marin down to the south bay
  const map = new maplibregl.Map({
    container: "bayMap",
    center: [-122.27, 37.63],
    zoom: 10.55,
    style: styleFor(),
    attributionControl: false, // attribution lives in the layers panel, always on screen
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  // night flips the saved theme and swaps the raster source; both styles ship in one
  // style object so the toggle is a visibility flip, not a rebuild.
  function setNight(dark) {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) {}
    nightBtn.textContent = dark ? "d · day" : "n · night";
    if (map.getLayer("paper")) map.setPaintProperty("paper", "background-color", PAPER());
    if (map.getLayer("raster-light")) {
      map.setLayoutProperty("raster-light", "visibility", dark ? "none" : "visible");
      map.setLayoutProperty("raster-dark", "visibility", dark ? "visible" : "none");
    }
  }
  nightBtn.addEventListener("click", () => setNight(!isDark()));
  document.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === "n") setNight(!isDark());
  });

  map.on("load", () => { hud.textContent = "tiles loaded"; });
  map.on("error", (e) => { if (e && e.error) console.error("bay map:", e.error); });
})();
