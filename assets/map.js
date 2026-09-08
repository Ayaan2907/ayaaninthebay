/* /map — a living graph of me. canvas 2d, zero deps.
   orbits: work / projects / writing / socials ring around the center.
   pulses travel the edges. hover a node and its edges light up.
   type a query and matching nodes glow. press t for the timeline layout. */
(function () {
  const K = window.KNOWLEDGE;
  const root = document.getElementById("map");
  const cv = document.getElementById("graph");
  const card = document.getElementById("mapCard");
  const qInput = document.getElementById("mapQuery");
  const modeBtn = document.getElementById("mapMode");
  const ctx = cv.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let nodes = [], edges = [], built = false;
  let view = { x: 0, y: 0, k: 1 }, target = { x: 0, y: 0, k: 1 };
  let hover = null, sel = null, mode = "orbit", query = "", born = 0, t0 = 0;
  let raf = null, W = 0, H = 0, dpr = 1, stars = [];
  let C = {};

  const RING = { me: 0, company: 175, project: 300, post: 300, social: 420 };
  const KIND_LANE = { company: -200, project: -65, post: 70, social: 200 };

  function colors() {
    const s = getComputedStyle(document.documentElement);
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    C = {
      bg: s.getPropertyValue("--bg").trim(), fg: s.getPropertyValue("--fg").trim(), dim: s.getPropertyValue("--fg-dim").trim(),
      mute: s.getPropertyValue("--fg-mute").trim(), line: s.getPropertyValue("--line").trim(), accent: s.getPropertyValue("--accent").trim(),
      accent2: s.getPropertyValue("--accent-2").trim(), dark,
    };
  }
  const kindColor = (k) => k === "me" || k === "project" ? C.accent : k === "company" ? C.accent2 : k === "post" ? C.dim : C.mute;

  /* ---------- data ---------- */
  function yearOf(s) {
    if (!s) return null;
    const m = /(\d{4})/.exec(s); if (!m) return null;
    const mon = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mm = /([a-z]{3})/i.exec(s.toLowerCase()); const mi = mm && mon[mm[1]] != null ? mon[mm[1]] : 6;
    return +m[1] + mi / 12;
  }
  function build() {
    nodes = []; edges = [];
    const add = (id, label, kind, data, r = 11) => {
      const a = Math.random() * Math.PI * 2, rad = RING[kind] || 300;
      const n = { id, label, kind, data, r, x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0, born: nodes.length, year: yearOf(data.meta) ?? yearOf(data.when) };
      nodes.push(n); return n;
    };
    const E = (a, b, l) => edges.push({ a, b, l, p: Array.from({ length: 2 }, () => ({ t: Math.random(), v: 0.0012 + Math.random() * 0.0012 })), bend: (Math.random() - .5) * 60 });
    const me = add("me", "ayaan", "me", { title: K.name, body: K.about.join("\n\n"), meta: "you are here" }, 22); me.x = 0; me.y = 0; me.year = 2026.7;

    K.work.forEach((w, i) => { const n = add("w" + i, w.company, "company", { title: `${w.company}`, sub: `${w.role} · ${w.period}`, body: w.bullets.map((b) => "- " + b).join("\n"), meta: w.period }, 13); E(me, n, w.kind === "apprenticeship" ? "apprenticed at" : w.kind === "program" ? "fellow at" : i === 0 ? "works at" : "worked at"); });
    K.projects.forEach((p, i) => { const n = add("p" + i, p.name.replace(/ \(OSS contributor\)/, ""), "project", { title: p.name, sub: p.when, body: p.blurb, url: p.url, meta: p.when }, 12); E(me, n, "built"); });
    const find = (l) => nodes.find((n) => n.label === l);
    if (find("ARIA") && find("AdvanceIQ.ai")) E(find("AdvanceIQ.ai"), find("ARIA"), "ships");
    if (find("Auto LLM Selector") && find("WingMic")) E(find("Auto LLM Selector"), find("WingMic"), "routes for");
    const mcp = add("mcp", "MCP", "project", { title: "MCP", sub: "concept", body: "WingMic exposes its graph over the Model Context Protocol, so Claude Desktop and Cursor can read your network. This site borrows the idea the other way round: tool calls as the interface.", meta: "2026" }, 9); if (find("WingMic")) E(find("WingMic"), mcp, "exposes");

    Object.entries(K.links).forEach(([n, u], i) => { if (n === "wingmic") return; const nd = add("s" + i, n, "social", { title: "@" + (n === "email" ? "mail" : n), sub: u.replace("mailto:", "").replace(/^https?:\/\//, ""), body: "", url: u, meta: "" }, 8); E(me, nd, ""); });
    const sf = add("sf", "san francisco", "social", { title: "san francisco", sub: "since sept 2026", body: "moved here for work. first time on the west coast. documenting the city and the ai scene on instagram.", url: K.links.instagram, meta: "sep 2026" }, 10); E(me, sf, "lives in");
    const ny = add("ny", "new york", "social", { title: "new york", sub: "until 2026", body: "where the last few years happened: grad school, first startups, and ARIA's first version.", meta: "2024" }, 8); E(sf, ny, "moved from");
    const edu = add("edu", "Monroe University", "company", { title: "m.s. computer science", sub: "monroe university · 2026", body: K.education.join("\n"), meta: "jul 2026" }, 11); E(me, edu, "studies at");
    const mich = add("mich", "U. Michigan", "company", { title: "grad coursework", sub: "university of michigan · fall 2024", body: K.education[1], meta: "sep 2024" }, 9); E(edu, mich, "before");
    const blog = add("blog", "blog", "post", { title: "blog", sub: "/blog", body: "posts live at /blog. inside the terminal, /read <slug>.", url: "/blog/", meta: "2026" }, 10); E(me, blog, "writes");
    const sub = add("sub", "substack", "post", { title: "substack", sub: "ayaankk.substack.com", body: K.writing.slice(0, 2).map((w) => "- " + w).join("\n"), url: K.links.substack, meta: "sep 2025" }, 9); E(blog, sub, "before that");
    const act = add("act", "github activity", "post", { title: "github activity", sub: "live", body: "commits, prs and stars, pulled live. type /activity in the terminal.", url: K.links.github, meta: "2026" }, 9); E(me, act, "ships to");
    fetch("/posts/index.json").then((r) => r.json()).then((ps) => {
      ps.slice(0, 6).forEach((p, i) => { const n = add("b" + i, p.title.length > 24 ? p.title.slice(0, 23) + "…" : p.title, "post", { title: p.title, sub: p.date, body: p.summary || "", url: "/blog/" + p.slug, meta: p.date }, 7); n.x = blog.x + 30; n.y = blog.y + 30; E(blog, n, ""); });
    }).catch(() => {});
    built = true;
  }

  /* ---------- layout ---------- */
  function targets(n) {
    if (mode === "timeline") {
      const y = n.year ?? 2026.75; const x = (y - 2025.2) * 300;
      const lane = n.kind === "me" ? 0 : KIND_LANE[n.kind];
      return { x, y: lane + ((n.born * 37) % 5 - 2) * 24 };
    }
    return null;
  }
  function step() {
    const N = nodes.length; let energy = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; const d2 = dx * dx + dy * dy + 1; const d = Math.sqrt(d2);
      const f = (mode === "timeline" ? 6500 : 7000) / d2; dx /= d; dy /= d; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    if (mode === "orbit") {
      for (const e of edges) {
        const a = e.a, b = e.b; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) + 0.01;
        const rest = (a.kind === "me" || b.kind === "me") ? RING[b.kind === "me" ? a.kind : b.kind] : 95; const f = (d - rest) * 0.015;
        a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
    }
    for (const n of nodes) {
      if (n.kind === "me" && mode === "orbit") { n.x = 0; n.y = 0; n.vx = n.vy = 0; continue; }
      const tg = targets(n);
      if (tg) { n.vx += (tg.x - n.x) * 0.03; n.vy += (tg.y - n.y) * 0.03; }
      else { const r = Math.hypot(n.x, n.y) + 0.01; const want = RING[n.kind]; const f = (want - r) * 0.01; n.vx += n.x / r * f; n.vy += n.y / r * f; }
      n.vx *= 0.8; n.vy *= 0.8; if (n.drag) continue; n.x += n.vx; n.y += n.vy; energy += Math.abs(n.vx) + Math.abs(n.vy);
    }
    return energy;
  }

  /* ---------- draw ---------- */
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!stars.length) stars = Array.from({ length: 160 }, () => ({ x: Math.random() * 2400 - 1200, y: Math.random() * 1600 - 800, z: 0.3 + Math.random() * 0.7, s: Math.random() * 1.4 + 0.3 }));
  }
  const fitK = () => Math.min(1, Math.min(W, H - 40) / 940);
  const toScreen = (x, y) => ({ x: W / 2 + view.x + x * view.k, y: H / 2 + view.y + y * view.k });
  const toWorld = (sx, sy) => ({ x: (sx - W / 2 - view.x) / view.k, y: (sy - H / 2 - view.y) / view.k });
  function ctrl(e) { const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2; const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y; const d = Math.hypot(dx, dy) || 1; return { x: mx - dy / d * e.bend, y: my + dx / d * e.bend }; }
  const bez = (p0, c, p1, t) => ({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y });

  function score(n) {
    if (!query) return 1;
    const hay = (n.label + " " + (n.data.title || "") + " " + (n.data.sub || "") + " " + (n.data.body || "")).toLowerCase();
    const toks = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const hits = toks.filter((t) => hay.includes(t)).length;
    return hits ? 1 : 0.12;
  }
  function related(n) { const s = new Set([n]); edges.forEach((e) => { if (e.a === n) s.add(e.b); if (e.b === n) s.add(e.a); }); return s; }

  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    // background: dust + blueprint grid
    ctx.save();
    const g = ctx.createRadialGradient(W / 2 + view.x, H / 2 + view.y, 0, W / 2 + view.x, H / 2 + view.y, Math.max(W, H) * 0.8);
    g.addColorStop(0, C.dark ? "rgba(231,165,91,.07)" : "rgba(194,99,26,.05)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = C.dark ? 0.9 : 0.55;
    for (const s of stars) {
      const p = toScreen(s.x * (0.6 + s.z * 0.4), s.y * (0.6 + s.z * 0.4)); if (p.x < -5 || p.y < -5 || p.x > W + 5 || p.y > H + 5) continue;
      const tw = 0.5 + 0.5 * Math.sin(t * (0.5 + s.z) + s.x);
      ctx.fillStyle = C.mute; ctx.globalAlpha = (C.dark ? 0.35 : 0.25) * tw * s.z; ctx.beginPath(); ctx.arc(p.x, p.y, s.s * view.k * 0.8, 0, 7); ctx.fill();
    }
    ctx.restore();
    // orbit rings
    if (mode === "orbit") {
      ctx.save(); ctx.setLineDash([2, 6]); ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      [RING.company, RING.project, RING.social].forEach((r) => { const c = toScreen(0, 0); ctx.beginPath(); ctx.arc(c.x, c.y, r * view.k, 0, 7); ctx.stroke(); });
      ctx.restore();
    } else {
      ctx.save(); ctx.strokeStyle = C.line; ctx.fillStyle = C.mute; ctx.font = "11px " + getComputedStyle(document.body).fontFamily; ctx.textAlign = "center";
      for (let y = 2023; y <= 2027; y++) { const p = toScreen((y - 2025.2) * 300, 0); ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(String(y), p.x, H - 34); }
      ctx.textAlign = "left";
      Object.entries(KIND_LANE).forEach(([k, ly]) => { const p = toScreen(0, ly); ctx.fillStyle = C.mute; ctx.fillText({ company: "work", project: "projects", post: "writing", social: "places · socials" }[k], 16, p.y + 4); });
      ctx.restore();
    }

    const focus = sel || hover; const near = focus ? related(focus) : null;
    const spawn = reduced ? 99 : Math.min(nodes.length, born);

    // edges
    for (const e of edges) {
      if (e.a.born >= spawn || e.b.born >= spawn) continue;
      const hot = near && near.has(e.a) && near.has(e.b) && (e.a === focus || e.b === focus);
      const dimmed = (near && !hot) || (query && (score(e.a) < 1 && score(e.b) < 1));
      const p0 = toScreen(e.a.x, e.a.y), p1 = toScreen(e.b.x, e.b.y), cc = ctrl(e), c = toScreen(cc.x, cc.y);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
      ctx.strokeStyle = hot ? C.accent : C.line; ctx.lineWidth = hot ? 1.6 : 1; ctx.globalAlpha = dimmed ? 0.15 : 1; ctx.stroke(); ctx.globalAlpha = 1;
      // pulses
      if (!reduced) for (const p of e.p) {
        p.t += p.v * (hot ? 3 : 1) * (view.k < 0.7 ? 0.8 : 1); if (p.t > 1) p.t -= 1;
        const q = bez(p0, c, p1, p.t);
        ctx.beginPath(); ctx.fillStyle = hot ? C.accent : C.accent2; ctx.globalAlpha = (dimmed ? 0.2 : hot ? 1 : 0.55) * Math.sin(p.t * Math.PI);
        ctx.shadowBlur = hot ? 12 : 6; ctx.shadowColor = ctx.fillStyle; ctx.arc(q.x, q.y, hot ? 2.4 : 1.6, 0, 7); ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      if (e.l && (hot || view.k > 0.9) && !dimmed) {
        const m = bez(p0, c, p1, 0.5); ctx.font = "10px " + getComputedStyle(document.body).fontFamily; ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.strokeText(e.l, m.x, m.y - 4); ctx.fillStyle = hot ? C.accent : C.mute; ctx.fillText(e.l, m.x, m.y - 4); ctx.textAlign = "left";
      }
    }
    // nodes
    const font = getComputedStyle(document.body).fontFamily;
    for (const n of nodes) {
      if (n.born >= spawn) continue;
      const age = reduced ? 1 : Math.min(1, (born - n.born) / 1);
      const pop = 1 + 0.35 * Math.sin(Math.min(1, age) * Math.PI);
      const p = toScreen(n.x, n.y); const col = kindColor(n.kind);
      const isFocus = n === focus; const dimmed = (near && !near.has(n)) || score(n) < 1;
      const r = n.r * view.k * pop * (isFocus ? 1.25 : 1);
      ctx.globalAlpha = dimmed ? 0.22 : 1;
      // glow
      const breathe = 0.5 + 0.5 * Math.sin(t * 1.4 + n.born);
      if (n.kind === "me" || isFocus || (query && score(n) === 1)) {
        const gg = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * (3 + breathe));
        gg.addColorStop(0, col + (C.dark ? "55" : "33")); gg.addColorStop(1, col + "00"); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, 7); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
      if (n.kind === "me") { const gm = ctx.createRadialGradient(p.x - r * .3, p.y - r * .3, r * .1, p.x, p.y, r); gm.addColorStop(0, C.dark ? "#ffd9a6" : "#f0a35e"); gm.addColorStop(1, C.accent); ctx.fillStyle = gm; ctx.fill(); }
      else { ctx.fillStyle = C.bg; ctx.fill(); ctx.lineWidth = isFocus ? 2 : 1.3; ctx.strokeStyle = col; if (n.kind === "social") ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, r * 0.28), 0, 7); ctx.fillStyle = col; ctx.globalAlpha *= isFocus ? 1 : 0.7; ctx.fill(); ctx.globalAlpha = dimmed ? 0.22 : 1; }
      // label
      const fs = n.kind === "me" ? 14 : n.kind === "social" ? 11 : 12;
      if (view.k > 0.55 || n.kind === "me" || isFocus || n.kind === "company" || n.kind === "project") {
        ctx.font = `${n.kind === "me" || isFocus ? "600 " : ""}${fs}px ${font}`;
        const lx = n.kind === "me" ? p.x : p.x + r + 7, ly = n.kind === "me" ? p.y + r + 16 : p.y + 4;
        ctx.textAlign = n.kind === "me" ? "center" : "left";
        ctx.lineWidth = 4; ctx.strokeStyle = C.bg; ctx.lineJoin = "round"; ctx.strokeText(n.label, lx, ly);
        ctx.fillStyle = isFocus ? C.accent : n.kind === "social" ? C.dim : C.fg; ctx.fillText(n.label, lx, ly);
        if (isFocus && n.data.sub) { ctx.font = `10px ${font}`; ctx.lineWidth = 3; ctx.strokeText(n.data.sub, lx, ly + 13); ctx.fillStyle = C.dim; ctx.fillText(n.data.sub, lx, ly + 13); }
        ctx.textAlign = "left";
      }
      ctx.globalAlpha = 1;
    }
  }

  function loop(now) {
    if (!t0) t0 = now;
    born += 0.18;
    view.x += (target.x - view.x) * 0.15; view.y += (target.y - view.y) * 0.15; view.k += (target.k - view.k) * 0.15;
    step(); draw(now);
    raf = root.hidden ? null : requestAnimationFrame(loop);
  }

  /* ---------- interaction ---------- */
  function hit(sx, sy) { const w = toWorld(sx, sy); let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - w.x, n.y - w.y); if (d < Math.max(n.r + 8, 14) / Math.max(view.k, 0.5) && d < bd) { best = n; bd = d; } } return best; }
  let pan = null, dragN = null, pinch = null;
  cv.addEventListener("pointerdown", (ev) => {
    cv.setPointerCapture(ev.pointerId);
    const n = hit(ev.offsetX, ev.offsetY);
    if (n) { dragN = n; n.drag = true; n._moved = false; } else pan = { x: ev.clientX - target.x, y: ev.clientY - target.y, moved: false };
  });
  cv.addEventListener("pointermove", (ev) => {
    if (dragN) { const w = toWorld(ev.offsetX, ev.offsetY); if (Math.hypot(w.x - dragN.x, w.y - dragN.y) > 2) dragN._moved = true; dragN.x = w.x; dragN.y = w.y; return; }
    if (pan) { target.x = view.x = ev.clientX - pan.x; target.y = view.y = ev.clientY - pan.y; pan.moved = true; cv.classList.add("dragging"); return; }
    const h = hit(ev.offsetX, ev.offsetY); if (h !== hover) { hover = h; cv.style.cursor = h ? "pointer" : "grab"; }
  });
  cv.addEventListener("pointerup", (ev) => {
    if (dragN) { dragN.drag = false; if (!dragN._moved) select(dragN); dragN = null; return; }
    if (pan && !pan.moved) clearSel(); pan = null; cv.classList.remove("dragging");
  });
  cv.addEventListener("wheel", (ev) => { ev.preventDefault(); zoomAt(ev.offsetX, ev.offsetY, ev.deltaY < 0 ? 1.12 : 0.89); }, { passive: false });
  function zoomAt(sx, sy, f) { const k = Math.min(3, Math.max(0.35, target.k * f)); const w = toWorld(sx, sy); target.k = k; target.x = sx - W / 2 - w.x * k; target.y = sy - H / 2 - w.y * k; }
  cv.addEventListener("touchstart", (e) => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
  cv.addEventListener("touchmove", (e) => { if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); zoomAt(W / 2, H / 2, d / pinch); pinch = d; } }, { passive: true });

  function select(n) {
    sel = n; const d = n.data;
    const openA = d.url ? `<a href="${d.url}" ${/^https?:/.test(d.url) ? 'target="_blank" rel="noopener"' : ""}>open →</a>` : "";
    card.innerHTML = `<div class="k">${esc(n.kind === "me" ? "you are here" : n.kind)}${d.sub ? " · " + esc(d.sub) : ""}</div><div class="n">${esc(d.title)}</div><div class="b">${window.MD.render(d.body || "")}</div><div class="actions">${openA}<button data-ask>ask in terminal</button><button data-focus>center</button></div>`;
    card.hidden = false;
    card.querySelector("[data-ask]").onclick = () => { close(); window.TERM.submit(n.kind === "me" ? "who are you?" : n.id === "act" ? "/activity" : n.id === "blog" ? "/blog" : `tell me about ${n.label}`); };
    card.querySelector("[data-focus]").onclick = () => center(n);
    if (window.innerWidth < 600) center(n);
  }
  function center(n) { target.k = Math.max(target.k, 1.1); target.x = -n.x * target.k; target.y = -n.y * target.k + (window.innerWidth < 600 ? -80 : 0); }
  function clearSel() { sel = null; card.hidden = true; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function setMode(m) {
    mode = m; modeBtn.textContent = m === "orbit" ? "t · timeline" : "t · orbit";
    if (m === "timeline") { target.k = Math.min(1, W / 1400); target.x = 0; target.y = 0; } else { target.k = fitK(); target.x = 0; target.y = 0; }
  }
  qInput.addEventListener("input", () => { query = qInput.value.trim(); });
  qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && query) { const q = query; close(); window.TERM.submit(q); }
    if (e.key === "Escape") { qInput.value = ""; query = ""; qInput.blur(); }
    e.stopPropagation();
  });
  modeBtn.onclick = () => setMode(mode === "orbit" ? "timeline" : "orbit");
  document.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (document.activeElement === qInput) return;
    if (e.key === "Escape") { if (sel) clearSel(); else close(); }
    if (e.key === "t") setMode(mode === "orbit" ? "timeline" : "orbit");
    if (e.key === "/") { e.preventDefault(); qInput.focus(); }
    if (e.key === "r") { target = { x: 0, y: 0, k: fitK() }; born = 0; }
    if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.2);
    if (e.key === "-") zoomAt(W / 2, H / 2, 0.83);
  });
  window.addEventListener("resize", () => { if (!root.hidden) resize(); });
  new MutationObserver(colors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function open() {
    root.hidden = false; document.body.style.overflow = "hidden";
    colors(); resize();
    if (!built) { build(); for (let i = 0; i < 90; i++) step(); }
    born = 0; t0 = 0; view = { x: 0, y: 0, k: 0.5 }; target = { x: 0, y: 0, k: mode === "orbit" ? fitK() : Math.min(1, W / 1400) };
    if (!raf) raf = requestAnimationFrame(loop);
    history.replaceState(null, "", "#map");
    setTimeout(() => qInput.blur(), 0);
  }
  function close() {
    root.hidden = true; document.body.style.overflow = ""; clearSel(); if (raf) { cancelAnimationFrame(raf); raf = null; }
    history.replaceState(null, "", location.pathname); document.getElementById("input").focus();
  }
  document.getElementById("mapClose").onclick = close;
  window.MAP = { open, close, isOpen: () => !root.hidden };
})();
