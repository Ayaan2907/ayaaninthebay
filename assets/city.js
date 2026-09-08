/* /map: san francisco at night. a small low-poly city drawn with a hand-rolled
   3d renderer on canvas 2d (perspective projection, painter's sort, flat shading,
   depth fog). districts are chapters of my life, buildings are github repos,
   vans are commits leaving for the dock, weather and daylight are real.
   scene = plain lists of boxes, so a three.js renderer can replace draw() later. */
(function () {
  const K = window.KNOWLEDGE;
  const root = document.getElementById("city");
  const cv = document.getElementById("cityCanvas");
  const card = document.getElementById("cityCard");
  const hud = document.getElementById("cityHud");
  const qInput = document.getElementById("cityQuery");
  const ctx = cv.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1, raf = null, built = false, t0 = 0, last = 0;
  let cam = { yaw: 0.7, pitch: 0.62, dist: 170, tx: 0, tz: 8 }, want = { ...cam };
  let districts = [], buildings = [], roads = [], cars = [], peds = [], lamps = [], boards = [];
  let hover = null, sel = null, query = "", night = null, weather = { fog: 0.25, rain: 0, tempF: null }, feed = [], stars = [];
  let C = {};

  /* ---------- palette ---------- */
  function colors() {
    const s = getComputedStyle(document.documentElement);
    C = { bg: s.getPropertyValue("--bg").trim(), fg: s.getPropertyValue("--fg").trim(), dim: s.getPropertyValue("--fg-dim").trim(), mute: s.getPropertyValue("--fg-mute").trim(), line: s.getPropertyValue("--line").trim(), accent: s.getPropertyValue("--accent").trim(), accent2: s.getPropertyValue("--accent-2").trim() };
  }
  const hex = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  // scene palette: day = paper city, night = ink city with amber windows
  const PAL = {
    day: { sky: [232, 234, 230], skyLow: [246, 244, 238], ground: [226, 224, 216], road: [204, 202, 194], wall: [244, 242, 236], top: [250, 249, 245], text: [40, 40, 38], window: [180, 176, 168], glow: [255, 200, 120] },
    night: { sky: [10, 12, 18], skyLow: [26, 28, 40], ground: [18, 19, 24], road: [30, 31, 38], wall: [36, 38, 46], top: [48, 50, 60], text: [230, 228, 220], window: [255, 196, 110], glow: [255, 180, 90] },
  };
  let P = PAL.night;

  /* ---------- time & weather ---------- */
  function sfHour() { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date()); const h = +p.find((x) => x.type === "hour").value, m = +p.find((x) => x.type === "minute").value; return (h % 24) + m / 60; }
  function daylight() { const h = sfHour(); const alt = Math.sin(((h - 6) / 12) * Math.PI); return Math.max(0, Math.min(1, (alt + 0.12) / 0.4)); } // 0 night … 1 day, short dusk
  function updateLight() {
    const d = night === true ? 0 : night === false ? 1 : daylight();
    P = {}; for (const k in PAL.day) P[k] = mix(PAL.night[k], PAL.day[k], d);
    P.d = d;
  }
  async function loadWeather() { try { const w = await (await fetch("/api/weather")).json(); if (w && !w.error) weather = w; else if (w) weather = { ...weather, ...w }; } catch {} }

  /* ---------- data & layout ---------- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
  const daysAgo = (iso) => iso ? (Date.now() - new Date(iso)) / 864e5 : 999;

  async function build() {
    const [city, bb, gh] = await Promise.all([
      fetch("/content/city.json").then((r) => r.json()),
      fetch("/content/billboards.json").then((r) => r.json()).catch(() => ({ x: [], instagram: [], blog: [] })),
      fetch("/api/github").then((r) => r.json()).catch(() => null),
    ]);
    let repos = gh && gh.repos && gh.repos.length ? gh.repos : await fetch("/content/repos.fallback.json").then((r) => r.json()).catch(() => []);
    feed = gh && gh.feed ? gh.feed : [];
    districts = city.districts.map((d) => ({ ...d, tint: hex(d.tint), lots: [], cx: d.x, cz: d.z }));
    const L = 9, G = 5;
    for (const d of districts) {
      d.w = d.cols * L + (d.cols - 1) * G; d.h = d.rows * L + (d.rows - 1) * G;
      for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) d.lots.push({ x: d.cx + (c - (d.cols - 1) / 2) * (L + G), z: d.cz + (r - (d.rows - 1) / 2) * (L + G), used: false, c, r, district: d });
      // roads inside the district: between rows and columns, plus a ring
      for (let r = 0; r <= d.rows; r++) { const z = d.cz + (r - d.rows / 2) * (L + G); roads.push([[d.cx - d.w / 2 - G, z], [d.cx + d.w / 2 + G, z]]); }
      for (let c = 0; c <= d.cols; c++) { const x = d.cx + (c - d.cols / 2) * (L + G); roads.push([[x, d.cz - d.h / 2 - G], [x, d.cz + d.h / 2 + G]]); }
    }
    // arterials: every district to the hub at (0,8)
    for (const d of districts) roads.push([[d.cx, d.cz], [d.cx, 8], [0, 8]]);
    const take = (d, pref) => { const free = d.lots.filter((l) => !l.used); if (!free.length) return null; const l = pref ? free.reduce((a, b) => (pref(b) > pref(a) ? b : a)) : free[0]; l.used = true; return l; };
    buildings = [];
    // landmarks first
    for (const lm of city.landmarks) {
      const d = districts.find((x) => x.id === lm.district); if (!d) continue;
      const lot = take(d, (l) => (lm.kind === "tower" ? -l.r : lm.kind === "dock" ? l.r : 0)); if (!lot) continue;
      buildings.push({ id: lm.id, kind: lm.kind, label: lm.label, sub: lm.sub, body: lm.body, url: lm.url, x: lot.x, z: lot.z, w: lm.w, d: lm.d, h: lm.h, district: d, landmark: true, recent: 0, lit: 0.9 });
    }
    // billboards on an edge lot of their district
    boards = [];
    for (const b of city.billboards) {
      const d = districts.find((x) => x.id === b.district); if (!d) continue;
      const lot = take(d, (l) => l.c === d.cols - 1 ? 2 : 0); if (!lot) continue;
      const items = bb[b.source] || [];
      boards.push({ id: b.id, source: b.source, items, i: 0, x: lot.x, z: lot.z, w: 8.5, h: 5, y: 6, district: d, label: b.source === "x" ? "@ayaaninthebay" : b.source === "instagram" ? "instagram" : "blog", url: b.source === "x" ? K.links.x : b.source === "instagram" ? K.links.instagram : "/blog/" });
    }
    // repos → districts
    const score = (r) => Math.log10((r.size || 0) + 10) + (r.stars || 0) * 0.35 + (daysAgo(r.pushed) < 30 ? 0.8 : 0);
    const sorted = repos.slice().sort((a, b) => score(b) - score(a));
    const maxS = score(sorted[0] || { size: 100 }) || 1;
    for (const r of sorted) {
      let did = city.overrides[r.name]; const n = (r.name + " " + (r.desc || "") + " " + (r.topics || []).join(" ")).toLowerCase();
      if (!did) { for (const d of districts) if (d.match.some((m) => n.includes(m))) { did = d.id; break; } }
      let d = districts.find((x) => x.id === did) || districts.find((x) => x.id === "waterfront");
      let lot = take(d) || take(districts.find((x) => x.lots.some((l) => !l.used)) || d); if (!lot) break;
      const s = score(r) / maxS, hs = hash(r.name);
      buildings.push({ id: "r:" + r.name, kind: "repo", label: r.name, sub: [r.lang, r.stars ? r.stars + "★" : "", daysAgo(r.pushed) < 400 ? "pushed " + Math.round(daysAgo(r.pushed)) + "d ago" : ""].filter(Boolean).join(" · "), body: r.desc || "", url: r.url, x: lot.x + (hs - .5) * 1.5, z: lot.z + (hash(r.name + "z") - .5) * 1.5, w: 4 + hs * 3.5, d: 4 + hash(r.name + "d") * 3.5, h: 3 + s * 24, district: lot.district || d, landmark: false, recent: daysAgo(r.pushed), lit: daysAgo(r.pushed) < 30 ? 0.8 : daysAgo(r.pushed) < 180 ? 0.45 : 0.15, repo: r });
    }
    // street lamps along roads
    lamps = []; for (const rd of roads) for (let i = 0; i < rd.length - 1; i++) { const [a, b] = [rd[i], rd[i + 1]]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.round(len / 14)); for (let k = 0; k <= n; k++) { const t = k / n; lamps.push([a[0] + (b[0] - a[0]) * t + 1.6, a[1] + (b[1] - a[1]) * t + 1.6]); } }
    // ambient cars + pedestrians
    cars = []; for (let i = 0; i < 9; i++) cars.push(makeCar(roads[(i * 7) % roads.length], null, 0.35 + Math.random() * 0.3, hash("c" + i)));
    peds = []; for (let i = 0; i < 18; i++) { const b = buildings[(i * 5) % buildings.length]; peds.push({ x: b.x + b.w / 2 + 1.5, z: b.z + (Math.random() - .5) * 6, a: Math.random() * 6.28, v: 1.1 + Math.random() }); }
    // deliveries: recent github events become vans that leave for the dock
    const dock = buildings.find((b) => b.id === "dock");
    feed.slice(0, 14).forEach((f, i) => { const b = buildings.find((x) => x.kind === "repo" && x.label.toLowerCase() === (f.repo || "").toLowerCase()) || buildings[Math.floor(hash(f.repo || "" + i) * buildings.length)]; if (b && dock) cars.push(makeCar([[b.x, b.z + b.d / 2 + 2], [b.x, 8], [dock.x, 8], [dock.x, dock.z - dock.d / 2 - 2]], f, 0.55, i / 14, true)); });
    stars = Array.from({ length: 140 }, () => ({ a: Math.random() * Math.PI * 2, e: Math.random() * 0.9 + 0.05, s: Math.random() }));
    built = true;
  }
  function makeCar(path, ev, speed, t, van) { const segs = []; let total = 0; for (let i = 0; i < path.length - 1; i++) { const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); segs.push({ a: path[i], b: path[i + 1], l, s: total }); total += l; } return { path, segs, total, t: t * total, speed: speed * 10, ev, van: !!van, hue: hash((ev ? ev.at : "") + speed) }; }
  function carPos(c) { let d = c.t % c.total; if (d < 0) d += c.total; for (const s of c.segs) if (d <= s.s + s.l) { const t = s.l ? (d - s.s) / s.l : 0; return { x: s.a[0] + (s.b[0] - s.a[0]) * t, z: s.a[1] + (s.b[1] - s.a[1]) * t, dx: (s.b[0] - s.a[0]) / (s.l || 1), dz: (s.b[1] - s.a[1]) / (s.l || 1) }; } return { x: c.path[0][0], z: c.path[0][1], dx: 1, dz: 0 }; }

  /* ---------- camera & projection ---------- */
  let cp = { x: 0, y: 0, z: 0 }, R, U, F, FOC = 1;
  function setupCam() {
    const cy = Math.cos(cam.pitch), sy = Math.sin(cam.pitch);
    cp = { x: cam.tx + cam.dist * cy * Math.sin(cam.yaw), y: cam.dist * sy, z: cam.tz + cam.dist * cy * Math.cos(cam.yaw) };
    const f = norm([cam.tx - cp.x, 0 - cp.y, cam.tz - cp.z]); const r = norm(cross(f, [0, 1, 0])); const u = cross(r, f);
    F = f; R = r; U = u; FOC = H * 0.95;
  }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function proj(x, y, z) { const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z; const vz = dx * F[0] + dy * F[1] + dz * F[2]; if (vz < 2) return null; const vx = dx * R[0] + dy * R[1] + dz * R[2], vy = dx * U[0] + dy * U[1] + dz * U[2]; return { x: W / 2 + (vx / vz) * FOC, y: H / 2 - (vy / vz) * FOC, z: vz }; }
  const depthOf = (x, y, z) => (x - cp.x) * F[0] + (y - cp.y) * F[1] + (z - cp.z) * F[2];
  function fogT(z) { const near = cam.dist * 0.9, far = cam.dist * 2.6 + 120; return Math.max(0, Math.min(1, (z - near) / (far - near))) * (0.55 + weather.fog * 0.45); }
  const shadeCol = (base, n, top) => { const L = norm([0.5, 0.9, 0.35]); const diff = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]); const k = 0.62 + 0.38 * diff; return scale(base, top ? k + 0.06 : k); };

  /* ---------- drawing ---------- */
  function poly(pts, fill, stroke) { ctx.lineWidth = 1; ctx.lineJoin = "miter"; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }
  function drawBox(b, base, opts = {}) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y || 0, y1 = y0 + b.h;
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]].map((p) => proj(...p));
    if (c.some((p) => !p)) return;
    const faces = [
      { i: [4, 5, 6, 7], n: [0, 1, 0], top: true, cx: b.x, cy: y1, cz: b.z },
      { i: [0, 1, 5, 4], n: [0, 0, -1], cx: b.x, cy: (y0 + y1) / 2, cz: z0, axis: "x" },
      { i: [1, 2, 6, 5], n: [1, 0, 0], cx: x1, cy: (y0 + y1) / 2, cz: b.z, axis: "z" },
      { i: [2, 3, 7, 6], n: [0, 0, 1], cx: b.x, cy: (y0 + y1) / 2, cz: z1, axis: "x" },
      { i: [3, 0, 4, 7], n: [-1, 0, 0], cx: x0, cy: (y0 + y1) / 2, cz: b.z, axis: "z" },
    ].filter((f) => (cp.x - f.cx) * f.n[0] + (cp.y - f.cy) * f.n[1] + (cp.z - f.cz) * f.n[2] > 0)
      .sort((a, b2) => depthOf(b2.cx, b2.cy, b2.cz) - depthOf(a.cx, a.cy, a.cz));
    const fz = depthOf(b.x, (y0 + y1) / 2, b.z); const ft = fogT(fz);
    for (const f of faces) {
      const pts = f.i.map((k) => c[k]);
      let col = shadeCol(f.top ? mix(base, P.top, 0.5) : base, f.n, f.top);
      if (opts.hot) col = mix(col, hex(C.accent), 0.35);
      col = mix(col, P.sky, ft);
      poly(pts, rgb(col, opts.alpha ?? 1), rgb(mix(scale(col, 0.75), P.sky, ft), 0.9));
      // windows on side faces
      if (!f.top && opts.windows && ft < 0.85 && fz < cam.dist * 2.2) {
        const rows = Math.min(10, Math.floor(b.h / 2.6)), cols = Math.min(6, Math.floor((f.axis === "x" ? b.w : b.d) / 2.4));
        if (rows > 0 && cols > 0) {
          const [a, bq, cq, dq] = pts; // a=bottom-left, bq=bottom-right, cq=top-right, dq=top-left (in face order)
          for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
            const u = (k + 0.5) / cols, v = (r + 0.5) / rows; const on = hash(b.id + f.axis + r + "," + k) < opts.windows * 0.7;
            const bx = a.x + (bq.x - a.x) * u, by = a.y + (bq.y - a.y) * u, tx = dq.x + (cq.x - dq.x) * u, ty = dq.y + (cq.y - dq.y) * u;
            const px = bx + (tx - bx) * v, py = by + (ty - by) * v; const sw = Math.max(1, Math.hypot(bq.x - a.x, bq.y - a.y) / cols * 0.3), sh = Math.max(1, Math.hypot(tx - bx, ty - by) / rows * 0.34);
            const wc = on ? mix(P.window, P.sky, ft * 0.6) : mix(scale(col, 0.7), P.sky, ft);
            ctx.fillStyle = rgb(wc, on ? 0.95 : 0.6); ctx.fillRect(px - sw / 2, py - sh / 2, sw, sh);
          }
        }
      }
    }
    return c;
  }
  function groundPt(x, z) { return proj(x, 0.02, z); }
  function drawRoads() {
    for (const rd of roads) {
      const pts = rd.map((p) => groundPt(p[0], p[1])); if (pts.some((p) => !p)) continue;
      const z = depthOf(rd[0][0], 0, rd[0][1]); const ft = fogT(z);
      ctx.lineWidth = Math.max(1.5, 3.2 * FOC / z); ctx.strokeStyle = rgb(mix(P.road, P.sky, ft)); ctx.lineCap = "butt"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      if (P.d < 0.5) { ctx.setLineDash([6, 10]); ctx.lineWidth = 1; ctx.strokeStyle = rgb(mix([80, 78, 70], P.sky, ft), 0.5); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  function drawSky(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgb(P.sky)); g.addColorStop(0.62, rgb(P.skyLow)); g.addColorStop(1, rgb(P.ground));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (P.d < 0.6) { const a = (0.6 - P.d) / 0.6; for (const s of stars) { const x = ((s.a / 6.283 - cam.yaw / 6.283 + 2) % 1) * W * 1.4 - W * 0.2, y = (1 - s.e) * H * 0.55; ctx.fillStyle = rgb([220, 224, 235], a * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * (0.6 + s.s) + s.a)))); ctx.fillRect(x, y, s.s > 0.8 ? 2 : 1, s.s > 0.8 ? 2 : 1); } }
    // moon / sun
    const hr = sfHour(); const ang = ((hr - 6) / 12) * Math.PI; const sx = W * (0.15 + 0.7 * ((hr % 24) / 24)), sy = H * 0.52 - Math.sin(ang) * H * 0.35;
    if (P.d > 0.2) { ctx.fillStyle = rgb([255, 236, 190], 0.85 * P.d); ctx.beginPath(); ctx.arc(sx, sy, 22, 0, 7); ctx.fill(); }
    else { ctx.fillStyle = rgb([238, 236, 226], 0.9); ctx.beginPath(); ctx.arc(W * 0.78, H * 0.16, 11, 0, 7); ctx.fill(); ctx.fillStyle = rgb(P.sky); ctx.beginPath(); ctx.arc(W * 0.78 - 5, H * 0.16 - 3, 9, 0, 7); ctx.fill(); }
    // fog bank on the horizon
    const fg = ctx.createLinearGradient(0, H * 0.35, 0, H * 0.7); fg.addColorStop(0, rgb(P.skyLow, 0)); fg.addColorStop(1, rgb(P.skyLow, 0.55 + weather.fog * 0.4)); ctx.fillStyle = fg; ctx.fillRect(0, H * 0.35, W, H * 0.35);
  }
  function drawGround() {
    const pts = [[-160, -140], [160, -140], [160, 140], [-160, 140]].map((p) => proj(p[0], 0, p[1]));
    if (pts.every(Boolean)) poly(pts, rgb(P.ground));
    // bay to the east (x > 90)
    const bay = [[92, -140], [180, -140], [180, 140], [92, 140]].map((p) => proj(p[0], 0.01, p[1]));
    if (bay.every(Boolean)) poly(bay, rgb(mix(P.skyLow, [40, 70, 90], P.d < 0.5 ? 0.35 : 0.2)));
    // district plates + names
    for (const d of districts) {
      const q = [[d.cx - d.w / 2 - 2, d.cz - d.h / 2 - 2], [d.cx + d.w / 2 + 2, d.cz - d.h / 2 - 2], [d.cx + d.w / 2 + 2, d.cz + d.h / 2 + 2], [d.cx - d.w / 2 - 2, d.cz + d.h / 2 + 2]].map((p) => proj(p[0], 0.015, p[1]));
      if (q.every(Boolean)) poly(q, rgb(mix(P.ground, d.tint, 0.08)));
      const lp = proj(d.cx, 0.05, d.cz + d.h / 2 + 6); if (lp) { const s = Math.max(9, Math.min(15, 14 * 170 / lp.z)); ctx.font = `500 ${s}px ${font()}`; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeStyle = rgb(P.ground, 0.9); ctx.strokeText(d.name, lp.x, lp.y); ctx.fillStyle = rgb(mix(P.text, P.ground, 0.35)); ctx.fillText(d.name, lp.x, lp.y); }
    }
  }
  const font = () => getComputedStyle(document.body).fontFamily;
  function label(text, x, y, z, opts = {}) {
    const p = proj(x, y, z); if (!p) return; const s = Math.min(opts.max || 13, Math.max(8, 14 * 40 / p.z * 3));
    if (s < 8.5 && !opts.force) return;
    ctx.font = `${opts.bold ? "600 " : ""}${s}px ${font()}`; ctx.textAlign = "center"; ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = rgb(P.sky, 0.9); ctx.strokeText(text, p.x, p.y); ctx.fillStyle = opts.color || rgb(P.text); ctx.fillText(text, p.x, p.y);
    if (opts.sub) { ctx.font = `${s * 0.78}px ${font()}`; ctx.strokeText(opts.sub, p.x, p.y + s); ctx.fillStyle = rgb(mix(P.text, P.sky, 0.35)); ctx.fillText(opts.sub, p.x, p.y + s); }
  }
  function drawBoard(b, t) {
    const item = b.items[b.i % Math.max(1, b.items.length)];
    // post + panel facing -z (toward the hub)
    drawBox({ x: b.x, z: b.z, w: 0.6, d: 0.6, h: b.y, y: 0 }, [90, 88, 84]);
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y, y1 = b.y + b.h, z = b.z;
    const q = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]].map((p) => proj(...p)); if (q.some((p) => !p)) return;
    const front = (cp.z - z) < 0; // which side faces camera
    const fz = depthOf(b.x, y0, z); const ft = fogT(fz);
    poly(q, rgb(mix(P.d < 0.5 ? [250, 246, 236] : [252, 250, 244], P.sky, ft)), rgb(mix([120, 118, 110], P.sky, ft)));
    if (P.d < 0.5) { const gl = ctx.createRadialGradient((q[0].x + q[2].x) / 2, (q[0].y + q[2].y) / 2, 4, (q[0].x + q[2].x) / 2, (q[0].y + q[2].y) / 2, Math.abs(q[1].x - q[0].x)); gl.addColorStop(0, rgb(P.glow, 0.22 * (1 - ft))); gl.addColorStop(1, rgb(P.glow, 0)); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); }
    // text clipped to the panel
    ctx.save(); ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y); ctx.closePath(); ctx.clip();
    const cx = (q[0].x + q[2].x) / 2, cy = (q[0].y + q[2].y) / 2, pw = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), ph = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const fs = Math.max(7, Math.min(16, pw / 14));
    ctx.fillStyle = rgb([40, 38, 34]); ctx.textAlign = "left"; ctx.font = `500 ${fs * 0.8}px ${font()}`;
    ctx.fillText(b.label, cx - pw / 2 + fs * 0.6, cy - ph / 2 + fs * 1.1);
    ctx.font = `${fs}px ${font()}`;
    const text = item ? (item.text || item.caption || item.title || "") : "(nothing posted yet)";
    const words = text.split(" "); let line = "", y = cy - ph / 2 + fs * 2.4, maxW = pw - fs * 1.2;
    for (const w of words) { const test = line ? line + " " + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, cx - pw / 2 + fs * 0.6, y); line = w; y += fs * 1.25; if (y > cy + ph / 2 - fs * 0.4) { line = ""; break; } } else line = test; }
    if (line) ctx.fillText(line, cx - pw / 2 + fs * 0.6, y);
    if (item && item.date) { ctx.font = `${fs * 0.7}px ${font()}`; ctx.fillStyle = rgb([130, 128, 120]); ctx.textAlign = "right"; ctx.fillText(item.date, cx + pw / 2 - fs * 0.6, cy + ph / 2 - fs * 0.5); }
    ctx.restore();
    if (!reduced && b.items.length > 1 && Math.floor(t / 7) !== b._tick) { b._tick = Math.floor(t / 7); b.i++; }
    b._q = q; b._front = front;
  }

  /* ---------- frame ---------- */
  function frame(now) {
    if (!t0) t0 = now; const t = (now - t0) / 1000, dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    // camera easing
    for (const k of ["yaw", "pitch", "dist", "tx", "tz"]) cam[k] += (want[k] - cam[k]) * 0.12;
    if (!reduced && !dragging && !sel) want.yaw += dt * 0.02; // slow idle drift
    updateLight(); setupCam();
    ctx.clearRect(0, 0, W, H); drawSky(t); drawGround(); drawRoads();
    // move things
    for (const c of cars) c.t += dt * c.speed;
    for (const p of peds) { p.a += (Math.random() - .5) * 0.6; p.x += Math.cos(p.a) * p.v * dt; p.z += Math.sin(p.a) * p.v * dt; if (Math.abs(p.x) > 120 || Math.abs(p.z) > 120) p.a += Math.PI; }
    // collect drawables, painter's sort by depth
    const items = [];
    const focus = sel || hover;
    for (const b of buildings) items.push({ z: depthOf(b.x, b.h / 2, b.z), draw: () => { const base = b.landmark ? mix(P.wall, b.district.tint, 0.35) : mix(P.wall, b.district.tint, 0.12); const dimmed = query && !matches(b); const hot = b === focus || (query && matches(b)); drawBox(b, base, { hot, windows: P.d < 0.55 ? b.lit * (1 - P.d) + 0.05 : 0.0, alpha: dimmed ? 0.25 : 1 }); if (b.kind === "tower") drawBox({ x: b.x, z: b.z, y: b.h, w: 0.5, d: 0.5, h: 6 }, [120, 118, 112]); } });
    for (const b of boards) items.push({ z: depthOf(b.x, b.y, b.z), draw: () => drawBoard(b, t) });
    for (const c of cars) { const p = carPos(c); items.push({ z: depthOf(p.x, 0.5, p.z), draw: () => { const ang = Math.atan2(p.dx, p.dz); const w = Math.abs(Math.cos(ang)) * (c.van ? 1.4 : 1.1) + Math.abs(Math.sin(ang)) * (c.van ? 2.6 : 2.1), d = Math.abs(Math.sin(ang)) * (c.van ? 1.4 : 1.1) + Math.abs(Math.cos(ang)) * (c.van ? 2.6 : 2.1); const col = c.van ? hex(C.accent2) : mix([200, 196, 188], [90, 88, 84], c.hue); drawBox({ x: p.x, z: p.z, w, d, h: c.van ? 1.6 : 1.1 }, col); if (P.d < 0.5) { const hp = proj(p.x + p.dx * (c.van ? 1.4 : 1.1), 0.6, p.z + p.dz * (c.van ? 1.4 : 1.1)); if (hp) { ctx.fillStyle = rgb([255, 240, 200], 0.9); ctx.beginPath(); ctx.arc(hp.x, hp.y, Math.max(1, 30 / hp.z * 3), 0, 7); ctx.fill(); } } if (c.van && (focus === c || cam.dist < 90)) { const lp = proj(p.x, 2.6, p.z); if (lp && lp.z < 140) label(c.ev.verb + " " + (c.ev.repo || ""), p.x, 2.6, p.z, { max: 11, color: rgb(hex(C.accent2)) }); } } }); }
    for (const p of peds) items.push({ z: depthOf(p.x, 0.5, p.z), draw: () => { const q = proj(p.x, 0.9, p.z); if (!q || q.z > cam.dist * 1.6) return; ctx.fillStyle = rgb(mix([120, 118, 112], P.sky, fogT(q.z))); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.8, 60 / q.z), 0, 7); ctx.fill(); } });
    if (P.d < 0.55) for (const l of lamps) items.push({ z: depthOf(l[0], 3, l[1]), draw: () => { const q = proj(l[0], 3.2, l[1]); if (!q || q.z > cam.dist * 2) return; const r = Math.max(2, 140 / q.z); const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r); g.addColorStop(0, rgb(P.glow, 0.5 * (1 - P.d))); g.addColorStop(1, rgb(P.glow, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 7); ctx.fill(); } });
    items.sort((a, b) => b.z - a.z); for (const it of items) it.draw();
    // labels
    for (const b of buildings) { if (b.landmark || b === focus || cam.dist < 75 && depthOf(b.x, b.h, b.z) < cam.dist * 1.15) label(b.label, b.x, b.h + 2.2, b.z, { bold: b.landmark || b === focus, sub: b === focus ? b.sub : null, color: b === focus ? rgb(hex(C.accent)) : undefined, force: b === focus }); }
    for (const b of boards) label(b.label, b.x, b.y + b.h + 1.6, b.z, { max: 11 });
    if (weather.rain && !reduced) { ctx.strokeStyle = rgb([200, 210, 225], 0.35); ctx.lineWidth = 1; for (let i = 0; i < 60; i++) { const x = (i * 97 + t * 900) % (W + 40) - 20, y = (i * 61 + t * 1400) % (H + 40) - 20; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 12); ctx.stroke(); } }
    // hud text
    const hr = sfHour(); const hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60); const ampm = hh >= 12 ? "pm" : "am";
    hud.textContent = `sf · ${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${ampm}${weather.tempF != null ? " · " + weather.tempF + "°f" : ""}${weather.fog > 0.8 ? " · fog" : weather.rain ? " · rain" : weather.cloud > 60 ? " · overcast" : ""} · ${buildings.filter((b) => b.kind === "repo").length} repos · ${cars.filter((c) => c.van).length} deliveries`;
    raf = root.hidden ? null : requestAnimationFrame(frame);
  }
  const matches = (b) => { if (!query) return true; const q = query.toLowerCase(); return (b.label + " " + (b.sub || "") + " " + (b.body || "") + " " + b.district.name).toLowerCase().includes(q); };

  /* ---------- interaction ---------- */
  let dragging = false, dragStart = null, pinch = null, moved = false;
  function pick(sx, sy) {
    let best = null, bd = 1e9;
    for (const b of buildings) { const p = proj(b.x, b.h / 2, b.z); if (!p) continue; const r = Math.max(10, (b.w + b.h) * 0.5 * FOC / p.z); const d = Math.hypot(p.x - sx, p.y - sy); if (d < r && p.z < bd) { best = b; bd = p.z; } }
    for (const b of boards) { if (b._q) { const q = b._q; const inside = sx > Math.min(q[0].x, q[3].x) && sx < Math.max(q[1].x, q[2].x) && sy > Math.min(q[2].y, q[3].y) && sy < Math.max(q[0].y, q[1].y); if (inside) return b; } }
    return best;
  }
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); dragging = true; moved = false; dragStart = { x: e.clientX, y: e.clientY, yaw: want.yaw, pitch: want.pitch }; });
  cv.addEventListener("pointermove", (e) => {
    if (dragging && dragStart) { const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y; if (Math.hypot(dx, dy) > 3) moved = true; want.yaw = dragStart.yaw - dx * 0.006; want.pitch = Math.max(0.22, Math.min(1.25, dragStart.pitch + dy * 0.004)); cam.yaw = want.yaw; cam.pitch = want.pitch; return; }
    const h = pick(e.offsetX, e.offsetY); if (h !== hover) { hover = h; cv.style.cursor = h ? "pointer" : "grab"; }
  });
  cv.addEventListener("pointerup", (e) => { dragging = false; if (!moved) { const h = pick(e.offsetX, e.offsetY); if (h) select(h); else clearSel(); } });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); want.dist = Math.max(28, Math.min(300, want.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  cv.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { dragging = false; pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); } }, { passive: true });
  cv.addEventListener("touchmove", (e) => { if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); want.dist = Math.max(28, Math.min(300, want.dist * pinch / d)); pinch = d; } }, { passive: true });

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function select(b) {
    sel = b;
    const isBoard = !!b.items; const title = isBoard ? b.label : b.label; const sub = isBoard ? (b.items.length + " posts") : b.sub || b.district.name;
    const body = isBoard ? b.items.map((it) => `- ${esc(it.text || it.caption || it.title || "")}${it.date ? " (" + it.date + ")" : ""}`).join("\n") : (b.body || (b.kind === "repo" ? "a repo. height is size and stars, lit windows mean commits in the last month." : ""));
    card.innerHTML = `<div class="k">${esc(isBoard ? "billboard" : b.landmark ? b.kind : "repo · " + b.district.name)}</div><div class="n">${esc(title)}</div><div class="k" style="margin-bottom:6px">${esc(sub)}</div><div class="b">${window.MD.render(body)}</div><div class="actions">${b.url ? `<a href="${b.url}" ${/^https?:/.test(b.url) ? 'target="_blank" rel="noopener"' : ""}>open →</a>` : ""}<button data-ask>ask in terminal</button></div>`;
    card.hidden = false;
    card.querySelector("[data-ask]").onclick = () => { close(); window.TERM.submit(b.id === "dock" ? "/activity" : b.id === "newsstand" ? "/blog" : `tell me about ${b.label}`); };
    want.tx = b.x; want.tz = b.z; want.dist = Math.min(want.dist, 90);
  }
  function clearSel() { sel = null; card.hidden = true; }
  qInput.addEventListener("input", () => { query = qInput.value.trim(); });
  qInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && query) { const q = query; close(); window.TERM.submit(q); } if (e.key === "Escape") { qInput.value = ""; query = ""; qInput.blur(); } e.stopPropagation(); });
  document.addEventListener("keydown", (e) => {
    if (root.hidden || document.activeElement === qInput) return;
    if (e.key === "Escape") { if (sel) clearSel(); else close(); }
    if (e.key === "/") { e.preventDefault(); qInput.focus(); }
    if (e.key === "n") { night = night === true ? false : night === false ? null : true; }
    if (e.key === "r") { want = { yaw: 0.7, pitch: 0.62, dist: 170, tx: 0, tz: 8 }; clearSel(); }
    if (e.key === "+" || e.key === "=") want.dist = Math.max(28, want.dist * 0.85);
    if (e.key === "-") want.dist = Math.min(300, want.dist * 1.18);
  });
  document.getElementById("cityNight").onclick = () => { night = night === true ? false : night === false ? null : true; };
  document.getElementById("cityClose").onclick = () => close();
  function resize() { dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  window.addEventListener("resize", () => { if (!root.hidden) resize(); });
  new MutationObserver(colors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  async function open() {
    root.hidden = false; document.body.style.overflow = "hidden"; colors(); resize();
    if (!built) { hud.textContent = "building the city…"; await build(); loadWeather(); }
    cam = { yaw: 0.7, pitch: 0.62, dist: 260, tx: 0, tz: 8 }; want = { yaw: 0.7, pitch: 0.62, dist: window.innerWidth < 600 ? 210 : 170, tx: 0, tz: 8 };
    t0 = 0; last = 0; if (!raf) raf = requestAnimationFrame(frame);
    history.replaceState(null, "", "#map"); setTimeout(() => qInput.blur(), 0);
  }
  function close() { root.hidden = true; document.body.style.overflow = ""; clearSel(); if (raf) { cancelAnimationFrame(raf); raf = null; } history.replaceState(null, "", location.pathname); document.getElementById("input").focus(); }
  window.CITY = { open, close, isOpen: () => !root.hidden };
})();
