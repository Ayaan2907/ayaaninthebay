/* ayaan — agent-session terminal. zero deps. */
(function () {
  const K = window.KNOWLEDGE;
  const $ = (s, r = document) => r.querySelector(s);
  const log = $("#log"), input = $("#input"), form = $("#promptForm"), menu = $("#menu");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => sleep(reduced ? 0 : ms);

  let chat = [];            // [{role, content}] sent to /api/chat
  let cmdHist = [], histIdx = -1, draft = "";
  let busy = false;
  let ai = null, aiInfo = null;            // null=unknown, true/false

  /* ---------------- rendering ---------------- */
  function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function scroll() { requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: reduced ? "auto" : "smooth" })); }
  function turn(kind, glyph, inner) { const n = el(`<div class="turn ${kind}"><span class="g">${glyph}</span><div class="c">${inner}</div></div>`); log.appendChild(n); scroll(); return n; }
  const user = (t) => turn("user", "❯", MD.esc(t));
  const agent = (md, raw) => turn("agent", "●", raw ? md : MD.render(md));
  const error = (t) => turn("error", "●", MD.esc(t));
  function tool(name, args) { return turn("tool", "●", `<span class="name">${name}</span><span class="args">(${MD.esc(args)})</span>`); }
  function result(toolEl, html) { const r = el(`<div class="res"><span class="g">⎿</span><div class="c">${html}</div></div>`); toolEl.appendChild(r); scroll(); return r; }
  function chips(list) {
    const c = el(`<div class="chips"></div>`);
    list.forEach((t) => { const b = el(`<button class="chip ${t.startsWith("/") ? "cmd" : ""}">${MD.esc(t)}</button>`); b.onclick = () => submit(t); c.appendChild(b); });
    return c;
  }
  async function toolCall(name, args, html, delay = 260) {
    const t = tool(name, args); await wait(delay); result(t, html); return t;
  }

  /* ---------------- content blocks ---------------- */
  const link = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t || u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>`;
  const lines = (arr) => arr.map((x) => `<div>${MD.inline(MD.esc(x))}</div>`).join("");

  const blocks = {
    about: () => `<div class="hl">${K.name}</div>${lines(K.about)}`,
    now: () => lines(K.now),
    work: () => K.work.map((w) => `<div class="item"><div class="h">${w.company} <span class="meta">· ${w.role} · ${w.period}</span></div><ul>${w.bullets.map((b) => `<li>${MD.inline(MD.esc(b))}</li>`).join("")}</ul></div>`).join(""),
    projects: () => K.projects.map((p) => `<div class="item"><div class="h">${link(p.url, p.name)}</div><div>${MD.inline(MD.esc(p.blurb))}</div></div>`).join(""),
    stack: () => `<div class="kv">${Object.entries(K.stack).map(([g, v]) => `<span class="k">${g}</span><span>${v.join(", ")}</span>`).join("")}</div>`,
    links: () => `<div class="kv">${Object.entries(K.links).map(([n, u]) => `<span class="k">${n}</span><span>${link(u, u.replace(/^mailto:/, ""))}</span>`).join("")}</div>`,
    edu: () => lines(K.education),
    sf: () => lines([
      "moved to san francisco in september 2026 for work. first time living on the west coast.",
      "i'm documenting the city, the ai scene, and what it's like to be an engineer here on instagram: " + link(K.links.instagram, "@ayaaninthebay"),
      "if you're in sf and want to grab coffee, dm me on x: " + link(K.links.x, "@ayaaninthebay"),
    ]),
  };

  /* ---------------- github activity ---------------- */
  function activityHTML(d) {
    const days = d.days || {};
    const N = d.source === "graphql" ? 364 : 119;           // 52 weeks or 17 weeks
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today); start.setUTCDate(today.getUTCDate() - N);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // align to sunday
    const cells = []; let max = 1, sum = 0, active = 0;
    for (let dt = new Date(start); dt <= today; dt.setUTCDate(dt.getUTCDate() + 1)) {
      const k = dt.toISOString().slice(0, 10); const v = days[k] || 0; if (v > max) max = v; sum += v; if (v) active++;
      cells.push({ k, v });
    }
    const lvl = (v) => v === 0 ? 0 : v >= max * .75 ? 4 : v >= max * .5 ? 3 : v >= max * .25 ? 2 : 1;
    const grid = `<div class="heat" style="grid-template-rows:repeat(7,1fr);grid-auto-flow:column">${cells.map((c) => `<i class="l${lvl(c.v)}" title="${c.k}: ${c.v}"></i>`).join("")}</div>`;
    const span = d.source === "graphql" ? "last 12 months" : "last ~90 days (public events)";
    const head = `<div class="hl">${d.total != null ? d.total + " contributions" : sum + " events"} · ${span} · ${active} active days</div>`;
    const prof = d.profile ? `<div class="dim">${d.profile.repos} public repos · ${d.profile.followers} followers · <a href="${K.links.github}" target="_blank" rel="noopener">github.com/ayaan2907</a></div>` : "";
    const feed = (d.feed || []).slice(0, 12).map((f) => {
      const ago = timeAgo(f.at);
      return `<div class="ev"><span class="dim">${ago}</span> <span class="verb">${MD.esc(f.verb)}</span> ${f.url ? `<a href="${f.url}" target="_blank" rel="noopener">${MD.esc(f.repo)}</a>` : MD.esc(f.repo)}${f.text ? ` <span class="dim">— ${MD.esc(f.text.slice(0, 80))}</span>` : ""}</div>`;
    }).join("");
    return head + grid + prof + `<div style="margin-top:8px">${feed || '<span class="dim">quiet lately.</span>'}</div>`;
  }
  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }

  /* ---------------- commands ---------------- */
  const COMMANDS = [
    ["/help", "list commands"],
    ["/about", "who i am"],
    ["/now", "what i'm doing right now"],
    ["/work", "experience"],
    ["/projects", "things i've built"],
    ["/stack", "languages, frameworks, infra"],
    ["/blog", "posts (also /read <slug>)"],
    ["/activity", "live github activity"],
    ["/sf", "new in san francisco"],
    ["/links", "github, x, linkedin, instagram…"],
    ["/contact", "how to reach me"],
    ["/map", "sf at night: my repos as a living city"],
    ["/build", "hey ayaan, build me <this>. a real app, shipped live"],
    ["/call", "voice call with the ai version of me"],
    ["/graph", "graph of me (the old map)"],
    ["/theme", "toggle light / dark"],
    ["/clear", "clear the session"],
  ];

  let posts = null;
  async function loadPosts() {
    if (posts) return posts;
    try { posts = await (await fetch("/posts/index.json", { cache: "no-cache" })).json(); } catch { posts = []; }
    return posts;
  }

  async function runCommand(raw) {
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "/help":
        await toolCall("Read", "commands.md", `<div class="kv">${COMMANDS.map(([c, d]) => `<span class="k">${c}</span><span>${d}</span>`).join("")}</div><div class="dim" style="margin-top:6px">or just type a question — i'll answer as me.</div>`);
        break;
      case "/about": case "/whoami":
        await toolCall("Read", "about.md", blocks.about());
        break;
      case "/now":
        await toolCall("Read", "now.md", blocks.now());
        break;
      case "/work": case "/experience": case "/resume": case "/cv":
        await toolCall("Bash", "git log --author=ayaan --reverse --format='%s'", blocks.work());
        agent(`full resume-style detail is on [linkedin](${K.links.linkedin}).`);
        break;
      case "/projects":
        await toolCall("Glob", "~/projects/**", blocks.projects());
        break;
      case "/stack":
        await toolCall("Read", "stack.md", blocks.stack());
        break;
      case "/edu": case "/education":
        await toolCall("Read", "education.md", blocks.edu());
        break;
      case "/sf":
        await toolCall("WebFetch", "instagram.com/ayaaninthebay", blocks.sf());
        break;
      case "/links": case "/social": case "/socials":
        await toolCall("Read", "links.md", blocks.links());
        break;
      case "/contact":
        await toolCall("Read", "contact.md", lines([
          "fastest: dm on x → " + link(K.links.x, "@ayaaninthebay"),
          "work-ish: " + link(K.links.linkedin, "linkedin"),
          "email: " + link(K.links.email, K.links.email.replace("mailto:", "")),
        ]));
        break;
      case "/blog": case "/posts": {
        const ps = await loadPosts();
        const t = tool("Glob", "~/blog/*.md"); await wait(260);
        if (!ps.length) { result(t, `<span class="dim">no posts yet. soon.</span>`); break; }
        result(t, ps.map((p) => `<div class="item"><div class="h"><a href="/blog/${p.slug}">${MD.esc(p.title)}</a> <span class="meta">· ${p.date}</span></div><div>${MD.esc(p.summary || "")}</div><div class="dim">/read ${p.slug}</div></div>`).join(""));
        break;
      }
      case "/read": {
        const ps = await loadPosts();
        const p = ps.find((x) => x.slug === arg) || ps.find((x) => x.slug.includes(arg));
        if (!arg || !p) { error(`usage: /read <slug>   (try /blog to list)`); break; }
        const t = tool("Read", `~/blog/${p.slug}.md`); await wait(200);
        try {
          const src = await (await fetch(`/posts/${p.slug}.md`)).text();
          const { body } = MD.frontMatter(src);
          result(t, `<div class="hl">${MD.esc(p.title)}</div><div class="dim">${p.date} · <a href="/blog/${p.slug}">open as page</a></div><hr style="border:0;border-top:1px solid var(--line);margin:8px 0">${MD.render(body)}`);
        } catch { result(t, `<span class="dim">couldn't load that post.</span>`); }
        break;
      }
      case "/activity": case "/github": case "/gh": {
        const t = tool("Bash", "gh api users/ayaan2907/events --paginate | jq"); await wait(150);
        try {
          const r = await fetch("/api/github"); const d = await r.json();
          if (d.error) throw new Error(d.error);
          result(t, activityHTML(d));
        } catch (e) {
          result(t, `<span class="dim">github api didn't answer (${MD.esc(String(e.message))}). see it live at ${link(K.links.github)}.</span>`);
        }
        break;
      }
      case "/map": case "/sf": case "/city":
        await toolCall("Bash", "gh api users/ayaan2907/repos | ./build-city --sf --live", `<span class="dim">laying out the city…</span>`, 120);
        window.CITY.open();
        break;
      case "/call": case "/talk": case "/live": case "/voice":
        await window.CALL.start({ tool, result, agent, error, wait, user });
        break;
      case "/hangup": case "/bye":
        window.CALL.end("hung up");
        break;
      case "/build": case "/make":
        await window.BUILD.run(arg, { tool, result, agent, error, wait });
        break;
      case "/graph":
        await toolCall("Bash", "wingmic graph --self", `<span class="dim">rendering graph of me…</span>`, 120);
        window.MAP.open();
        break;
      case "/theme":
        toggleTheme();
        agent(`switched to **${document.documentElement.getAttribute("data-theme") || "light"}**.`);
        break;
      case "/clear":
        log.innerHTML = ""; chat = [];
        agent("cleared. still me.");
        break;
      default:
        error(`unknown command: ${cmd}. try /help`);
    }
  }

  /* ---------------- ai ---------------- */
  const THINK = ["thinking", "recalling", "checking my notes", "pondering", "grepping memory"];
  function thinking() {
    const w = THINK[Math.floor(Math.random() * THINK.length)];
    const n = turn("agent", "✻", `<span class="think"><span class="w">${w}</span><span class="dots"></span></span>`);
    n.querySelector(".g").classList.add("spin");
    return n;
  }

  async function probeAI() {
    try {
      const r = await fetch("/api/chat", { method: "GET" });
      const j = await r.json();
      ai = !!j.ai; aiInfo = j;
    } catch { ai = false; }
    const s = $("#aiState"); s.textContent = ai ? "ai: " + (aiInfo && aiInfo.model ? aiInfo.model : "on") : "ai: local";
    s.className = ai ? "ai-on" : "ai-off";
    $("#modelLine").textContent = ai ? `ayaan (${aiInfo && aiInfo.model ? aiInfo.model : "llm"}${aiInfo && aiInfo.provider ? " via " + aiInfo.provider : ""}, first-person)` : "ayaan (local, offline answers)";
  }

  async function ask(q) {
    if (window.CALL && window.CALL.active()) { window.CALL.say(q); return; }
    if (window.BUILD && window.BUILD.isFollowUp(q)) { await window.BUILD.run(q, { tool, result, agent, error, wait }); return; }
    chat.push({ role: "user", content: q });
    const th = thinking();
    let text = "";
    let node = null;
    const start = () => { if (!node) { th.remove(); node = turn("agent", "●", ""); } };
    const paint = () => { node.querySelector(".c").innerHTML = MD.render(text); scroll(); };

    if (ai !== false) {
      try {
        const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: chat.slice(-12) }) });
        if (r.status === 503) { ai = false; await probeAI(); }
        else if (!r.ok) throw new Error("upstream " + r.status);
        else {
          const reader = r.body.getReader(); const dec = new TextDecoder();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            text += dec.decode(value, { stream: true });
            start(); paint();
          }
          if (!text.trim()) throw new Error("empty");
          chat.push({ role: "assistant", content: text });
          return;
        }
      } catch (e) {
        text = "";
        // fall through to local
      }
    }
    // local fallback
    await wait(500);
    const { md, follow } = localAnswer(q);
    text = md; start(); paint();
    if (follow && follow.length) node.querySelector(".c").appendChild(chips(follow));
    chat.push({ role: "assistant", content: md });
  }

  /* ---------------- offline brain ---------------- */
  function localAnswer(q) {
    const s = q.toLowerCase();
    const has = (...ws) => ws.some((w) => s.includes(w));
    const P = (n) => K.projects.find((p) => p.name.toLowerCase().startsWith(n));

    if (/^(hey ayaan[, ]*)?(build|make|create) me /i.test(q)) return { md: "on it. run **/build " + q.replace(/^(hey ayaan[, ]*)?(build|make|create) me /i, "") + "**", follow: ["/build " + q.replace(/^(hey ayaan[, ]*)?(build|make|create) me /i, "")] };
    if (has("bot", "are you ai", "are you real", "human", "chatgpt", "claude", "llm", "model")) return { md: "this is an ai version of me, running on my notes. the real me is on [x](" + K.links.x + "). right now the site is in **local mode** (no api key), so answers come from a fixed set of facts. ask about work, projects, stack, or sf.", follow: ["/work", "/projects"] };
    if (has("wingmic", "wing mic", "networking", "voice note", "knowledge graph")) return { md: `**wingmic**: ${P("wingmic").blurb}\n\n[wingmic.xyz](${K.links.wingmic})`, follow: ["what else have you built?", "/map"] };
    if (has("aria", "advanceiq", "advance iq", "power bi", "dax", "mca", "merchant cash")) return { md: `at **advanceiq.ai** i'm the sole engineer. the main thing is **aria**: ${P("aria").blurb}\n\nit's revenue-based finance (merchant cash advance analytics), not lending.`, follow: ["/work", "what's your stack?"] };
    if (has("hire", "hiring", "open to work", "available", "job", "looking for", "recruit", "freelance", "contract")) return { md: K.faq[0][1], follow: ["/contact", "/work"] };
    if (has("coffee", "meet", "hang", "in sf", "san francisco", "bay area", "move", "moved", "new to")) return { md: K.faq[1][1] + "\n\n" + K.now[4] + " → [@ayaaninthebay](" + K.links.instagram + ")", follow: ["/sf", "/contact"] };
    if (has("terminal", "why this", "this site", "built this", "how did you build", "how was this")) return { md: K.faq[2][1] + " " + K.faq[3][1], follow: ["/stack", "/map"] };
    if (has("stack", "language", "framework", "typescript", "python", "rust", "go ", "golang", "next", "react", "tools", "use")) return { md: "**stack:**\n" + Object.entries(K.stack).map(([g, v]) => `- ${g}: ${v.join(", ")}`).join("\n"), follow: ["/projects"] };
    if (has("project", "built", "build", "made", "work on", "working on", "side")) return { md: "things i've built:\n" + K.projects.slice(0, 5).map((p) => `- [${p.name}](${p.url}): ${p.blurb.split(". ")[0].replace(/\.$/, "")}.`).join("\n"), follow: ["/projects", "/map"] };
    if (has("experience", "work", "job", "career", "muvik", "tinyco", "headstarter", "resume", "cv", "company", "companies")) return { md: K.work.map((w) => `- **${w.company}**, ${w.role} (${w.period}): ${w.bullets[0]}`).join("\n"), follow: ["/work", "/links"] };
    if (has("school", "study", "degree", "university", "college", "master", "education", "monroe", "michigan")) return { md: K.education.map((e) => "- " + e).join("\n"), follow: ["/now"] };
    if (has("github activity", "commits", "contributions", "active", "activity")) return { md: "live from github. type **/activity**.", follow: ["/activity"] };
    if (has("write", "blog", "post", "substack", "article", "read")) return { md: K.writing.map((w) => "- " + w).join("\n"), follow: ["/blog"] };
    if (has("contact", "email", "reach", "dm", "twitter", " x", "linkedin", "github", "instagram", "social")) return { md: Object.entries(K.links).map(([n, u]) => `- ${n}: ${u.replace("mailto:", "")}`).join("\n"), follow: ["/contact"] };
    if (has("who are you", "about you", "yourself", "intro", "hello", "hi", "hey", "sup", "what do you do", "name")) return { md: K.about.join(" "), follow: ["what are you building?", "/work", "/projects"] };
    if (has("now", "these days", "currently", "lately", "right now", "up to")) return { md: K.now.map((n) => "- " + n).join("\n"), follow: ["/sf", "/projects"] };
    if (has("finance", "fintech", "factor", "rtr", "charge", "syndication", "ach", "lending", "loan")) return { md: K.domain, follow: ["tell me about aria"] };
    return { md: "i haven't written that down here yet. i'm in **local mode** right now, so i only know the basics. try one of these, or ask me on [x](" + K.links.x + ").", follow: ["what are you building?", "/work", "/projects", "/sf"] };
  }

  /* ---------------- input ---------------- */
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (cur === "dark") document.documentElement.setAttribute("data-theme", "dark"); else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("theme", cur); } catch {}
  }

  async function submit(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    input.value = ""; autosize(); hideMenu();
    cmdHist.push(text); histIdx = cmdHist.length; draft = "";
    user(text);
    try {
      if (text.startsWith("/")) await runCommand(text);
      else await ask(text);
    } catch (e) { error("something broke: " + e.message); }
    busy = false; input.focus();
  }

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px"; }

  // slash menu
  let menuIdx = 0, menuItems = [];
  function showMenu() {
    const v = input.value;
    if (!v.startsWith("/") || v.includes(" ")) return hideMenu();
    menuItems = COMMANDS.filter(([c]) => c.startsWith(v));
    if (!menuItems.length) return hideMenu();
    menuIdx = Math.min(menuIdx, menuItems.length - 1);
    menu.innerHTML = menuItems.map(([c, d], i) => `<div class="mi ${i === menuIdx ? "on" : ""}" data-c="${c}"><span class="n">${c}</span><span>${d}</span></div>`).join("");
    menu.hidden = false;
    menu.querySelectorAll(".mi").forEach((m) => { m.onmousedown = (e) => { e.preventDefault(); input.value = m.dataset.c; hideMenu(); submit(input.value); }; });
  }
  function hideMenu() { menu.hidden = true; menuItems = []; menuIdx = 0; }

  input.addEventListener("input", () => { autosize(); menuIdx = 0; showMenu(); });
  input.addEventListener("keydown", (e) => {
    if (!menu.hidden) {
      if (e.key === "ArrowDown") { e.preventDefault(); menuIdx = (menuIdx + 1) % menuItems.length; showMenu(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); menuIdx = (menuIdx - 1 + menuItems.length) % menuItems.length; showMenu(); return; }
      if (e.key === "Tab" || (e.key === "Enter" && menuItems.length)) { e.preventDefault(); input.value = menuItems[menuIdx][0]; hideMenu(); if (e.key === "Enter") submit(input.value); else autosize(); return; }
      if (e.key === "Escape") { hideMenu(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input.value); return; }
    if (e.key === "ArrowUp" && !input.value.includes("\n")) {
      if (!cmdHist.length) return; e.preventDefault();
      if (histIdx === cmdHist.length) draft = input.value;
      histIdx = Math.max(0, histIdx - 1); input.value = cmdHist[histIdx]; autosize();
    }
    if (e.key === "ArrowDown" && !input.value.includes("\n")) {
      if (!cmdHist.length) return; e.preventDefault();
      histIdx = Math.min(cmdHist.length, histIdx + 1); input.value = histIdx === cmdHist.length ? draft : cmdHist[histIdx]; autosize();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") { e.preventDefault(); submit("/clear"); }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(input.value); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); }
    if (e.key === "/" && document.activeElement !== input && !window.MAP.isOpen() && !window.CITY.isOpen()) { e.preventDefault(); input.focus(); input.value = "/"; showMenu(); }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".cmdlink")) submit("/help");
    if (e.target.closest("a, button, textarea, input, .map")) return;
    if (!getSelection().toString()) input.focus();
  });
  $("#themeBtn").onclick = () => submit("/theme");
  $("#mapBtn").onclick = () => submit("/map");

  // clock
  function tick() { $("#clock").textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" }).toLowerCase() + " pt"; }
  tick(); setInterval(tick, 15000);

  /* ---------------- intro ---------------- */
  async function intro() {
    probeAI();
    await wait(300);
    await toolCall("Bash", "whoami", `<span class="hl">ayaan</span> · software engineer · san francisco`, 400);
    await wait(250);
    await toolCall("Read", "now.md", blocks.now(), 500);
    await wait(350);
    const a = agent(`hey. i'm ayaan. ${K.tagline}\n\nit's a terminal because that's where i live. ask me anything, or poke around:`);
    a.querySelector(".c").appendChild(chips(["what are you building?", "/map", "/build a pomodoro timer", "/call", "/work", "coffee in sf?"]));
    if (location.hash === "#map") submit("/map");
    const q = new URLSearchParams(location.search).get("q");
    if (q) submit(q);
  }
  window.TERM = { submit, agent };
  intro();
})();
