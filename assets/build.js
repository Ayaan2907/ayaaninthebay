/* /build <what>: "hey ayaan, build me this."
   two modes, picked by /api/build (env BUILD_MODE / PUTER_AUTH_TOKEN):
   owner   -> the server builds and publishes on MY puter account; visitors sign in to nothing.
   visitor -> fully client-side on Puter.js (https://docs.puter.com): the visitor's
   browser asks an llm for a single-file app, writes it to the visitor's puter
   filesystem, publishes it at <random>.puter.site, and shows it in a sandboxed
   iframe. the visitor pays for their own usage (puter's model); nothing runs on
   my server. v2 adds an allow/deny check on /api/build/check with my own key.
   NOTE: written without a network to test against. if puter's api shape moved,
   the failure path prints the error in the terminal instead of breaking it. */
(function () {
  const K = window.KNOWLEDGE;
  let puterReady = null;
  function loadPuter() {
    if (window.puter) return Promise.resolve(window.puter);
    if (puterReady) return puterReady;
    puterReady = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://js.puter.com/v2/"; s.onload = () => res(window.puter); s.onerror = () => rej(new Error("couldn't load puter.js")); document.head.appendChild(s); });
    return puterReady;
  }

  const LIMIT = { perHour: 3, key: "build-log" };
  function allowed() {
    let log = []; try { log = JSON.parse(localStorage.getItem(LIMIT.key) || "[]"); } catch {}
    const now = Date.now(); log = log.filter((t) => now - t < 3600e3);
    if (log.length >= LIMIT.perHour) return false;
    log.push(now); try { localStorage.setItem(LIMIT.key, JSON.stringify(log)); } catch {}
    return true;
  }
  const BLOCK = /(login|password|credit card|payment|checkout|phishing|scrape|scraper|crawler|bank|wallet|keylog|malware|virus|exploit|porn|nsfw|nude|hate|kill|weapon)/i;

  const SYSTEM = `You write one self-contained index.html for a small web app or page a visitor asked for on ${K.name}'s personal site.
Rules: one file, inline css and js, no external requests of any kind (no fetch, no cdn, no fonts, no images from urls), no forms that collect personal data, no login, no storage beyond localStorage, no tracking, nothing about real people, nothing adult or hateful. Keep it under 250 lines. Mobile-friendly. Start with <!doctype html>. Output only the html, no markdown fences, no commentary.`;

  let modeInfo = null;
  async function getMode() { if (modeInfo) return modeInfo; try { modeInfo = await (await fetch("/api/build")).json(); } catch { modeInfo = { mode: "visitor" }; } return modeInfo; }

  function preview(ui, html, url, edited) {
    const t5 = ui.tool("Preview", url || "inline");
    const holder = ui.result(t5, `<div class="buildframe"><iframe sandbox="allow-scripts allow-pointer-lock" referrerpolicy="no-referrer" title="built app"></iframe></div>`);
    holder.querySelector("iframe").srcdoc = html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'">`);
    ui.agent(edited ? "changed. same link, new file. keep going: \"make the button bigger\", \"add a reset\", or /build something new." : `there you go. that's roughly how i work: read the ask, write one file, ship it, show it. ${url ? "send the link to someone. " : ""}want changes? just say them: "make it dark", "add a reset button".`);
  }

  // the last build in this session, so "/build make the button bigger" edits it instead of starting over
  let last = null;
  const FOLLOW = /^(change|make|add|remove|fix|update|rename|move|turn|swap|replace|use|set|bigger|smaller|darker|lighter|can you|could you|now )/i;
  function isFollowUp(prompt) { return !!last && (FOLLOW.test(prompt) || /\b(it|that|this|the (button|color|title|timer|page|font))\b/i.test(prompt)); }

  // owner mode: the server builds on my puter account. visitors sign in to nothing.
  async function runOwner(prompt, ui) {
    const { tool, result, error } = ui;
    let cur = null, code = null, html = "";
    const prev = isFollowUp(prompt) ? last : null;
    const r = await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, prev }) });
    if (!r.ok || !r.body) { error("the builder didn't answer (" + r.status + ")."); return; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    const handle = (ev) => {
      if (ev.t === "step") {
        if (cur && ev.name !== "Write" && !cur._closed && cur._pending) { cur._closed = true; }
        cur = tool(ev.name, ev.args); cur._pending = true;
        if (ev.name === "Write") { const box = result(cur, `<pre class="buildlog"><code></code></pre>`); code = box.querySelector("code"); }
        else if (ev.out) result(cur, `<div class="stepout">${MD.render(ev.out)}</div>`);
      } else if (ev.t === "chunk") { html += ev.text; if (code) code.textContent = html.split("\n").slice(-12).join("\n"); }
      else if (ev.t === "error") { error(ev.message); }
      else if (ev.t === "meta") { last = Object.assign(last || {}, { slug: ev.slug, issue: ev.issue }); }
      else if (ev.t === "done") { last = Object.assign(last || {}, { html: ev.html, url: ev.url }); if (code) code.textContent = `${ev.html.split("\n").length} lines · ${(ev.html.length / 1024).toFixed(1)} kb`; preview(ui, ev.html, ev.url, !!prev); }
    };
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const l of lines) { if (!l.trim()) continue; try { handle(JSON.parse(l)); } catch {} }
    }
    if (buf.trim()) { try { handle(JSON.parse(buf)); } catch {} }
  }

  async function run(prompt, ui) {
    const { tool, result, agent, error, wait } = ui;
    if (!prompt) { error("usage: /build <what you want>   e.g. /build a pomodoro timer with a tomato that shrinks"); return; }
    if (BLOCK.test(prompt)) { error("not that. keep it to small, harmless apps: timers, toys, calculators, games, generators."); return; }
    const mi = await getMode();
    if (mi.mode === "off") { error("builds are switched off right now."); return; }
    if (mi.mode === "owner") { await runOwner(prompt, ui); return; }
    if (!allowed()) { error(`slow down: ${LIMIT.perHour} builds an hour per browser. come back in a bit.`); return; }

    // visitor mode: same pipeline, run in the browser on the visitor's puter account
    let PB; try { PB = await (await fetch("/content/playbook.json")).json(); } catch { PB = { pipeline: [], style: [], voice: [], commit: { format: "type(scope): summary", rules: [] }, pr: { sections: ["what", "why", "how to verify"] } }; }
    const step = (skill, out) => { const p = PB.pipeline.find((x) => x.skill === skill); const t = tool(p ? p.show.split("(")[0] : skill, p ? p.show.replace(/^[^(]*\(|\)$/g, "") : ""); if (out) result(t, `<div class="stepout">${MD.render(out)}</div>`); return t; };
    const t1 = tool("Bash", "puter spin-up --sandbox");
    let puter;
    try { puter = await loadPuter(); } catch (e) { result(t1, `<span class="dim">${e.message}. the builder needs puter.js, which your network blocked.</span>`); return; }
    result(t1, `<span class="dim">sandbox up on your puter account (free tier). first run asks you to sign in once.</span>`);
    const say = async (messages, opts) => { const r = await puter.ai.chat(messages, Object.assign({ model: "gpt-4.1" }, opts || {})); return typeof r === "string" ? r : (r && r.message && (typeof r.message.content === "string" ? r.message.content : (r.message.content || []).map((c) => c.text || "").join(""))) || String(r); };
    const planSystem = `You are Ayaan's build pipeline. A visitor asked for a tiny web app. Produce strict JSON: {"issue":{"title":string,"acceptance":[string,string,string],"out_of_scope":[string]},"restate":string,"ladder":{"verdict":string,"lines":number},"commit":string,"pr":{"title":string,"what":string,"why":string,"verify":string}}. Acceptance criteria are testable one-liners. "restate" is one blunt lowercase sentence. "ladder" walks ponytail's ladder and lands on "minimum that works" under 250 lines. commit is "${PB.commit.format}" (${(PB.commit.rules || []).join("; ")}). Voice: ${PB.voice.join(" ")} Output only the JSON.`;
    let plan; const prev = isFollowUp(prompt) ? last : null;
    if (prev) { plan = { issue: prev.issue || { title: "follow-up", acceptance: [prompt], out_of_scope: [] }, ladder: { verdict: "edit in place, minimum diff", lines: prev.html.split("\n").length }, commit: "fix(build): " + prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40), pr: null }; step("ticket-create", `**follow-up on ${plan.issue.title}**\n\n- ${prompt}`); step("ponytail", "edit in place. smallest diff that does the thing."); }
    else {
    try { const raw = await say([{ role: "system", content: planSystem }, { role: "user", content: prompt }]); plan = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); if (!plan.issue) throw new Error("plan shape"); }
    catch (e) { error("planning failed: " + (e && e.message ? e.message : e)); return; }
    step("ticket-create", `**${plan.issue.title}**\n\nacceptance:\n${(plan.issue.acceptance || []).map((a) => "- " + a).join("\n")}\n\nout of scope: ${(plan.issue.out_of_scope || []).join("; ") || "none"}`);
    step("ticket-resolve", plan.restate || "");
    step("ponytail", `${plan.ladder ? plan.ladder.verdict : "minimum that works"} → ~${plan.ladder ? plan.ladder.lines : 120} lines, one file.`);
    step("code-style", "strict types, early returns, named functions, a11y not traded for brevity.");
    }

    const t3 = tool(prev ? "Edit" : "Write", "index.html");
    const box = result(t3, `<pre class="buildlog"><code></code></pre>`);
    const code = box.querySelector("code");
    const writeSystem = `You write one self-contained index.html for a small web app a visitor asked for on ${K.name}'s personal site. It must satisfy this issue exactly and nothing more: ${JSON.stringify(plan.issue)}\nHouse style:\n${PB.style.map((x) => "- " + x).join("\n")}\nVoice for visible text:\n${PB.voice.map((x) => "- " + x).join("\n")}\nHard rules: one file, inline css and js, no external requests of any kind, no forms that collect personal data, no login, no storage beyond localStorage, no tracking, nothing about real people, nothing adult or hateful. Start with <!doctype html>. Output only the html, no markdown fences, no commentary.`;
    let html = "";
    const msgs = prev ? [{ role: "system", content: writeSystem + "\n\nYou are EDITING an existing file. Apply only the requested change and keep everything else where possible. Output the full updated file." }, { role: "user", content: "current index.html:\n\n" + prev.html + "\n\nchange request: " + prompt }] : [{ role: "system", content: writeSystem }, { role: "user", content: prompt }];
    try {
      const resp = await puter.ai.chat(msgs, { model: "gpt-4.1", stream: true });
      for await (const part of resp) { const chunk = typeof part === "string" ? part : (part && (part.text || (part.message && part.message.content) || "")) || ""; html += chunk; code.textContent = html.split("\n").slice(-12).join("\n"); }
    } catch (e) {
      try { html = await say(msgs); }
      catch (e2) { code.textContent = ""; error("the model call failed: " + (e2 && e2.message ? e2.message : e2)); return; }
    }
    html = html.replace(/^```html?\s*/i, "").replace(/```\s*$/, "").trim();
    if (!/^<!doctype html>/i.test(html) || html.length < 200) { error("got something that isn't a page. try rephrasing."); return; }
    if (/<script[^>]+src=|fetch\(|XMLHttpRequest|WebSocket|<link[^>]+href=|url\(\s*['"]?https?:|<iframe/i.test(html)) { error("the generated page tried to reach the network, which the rules forbid. try again with a simpler ask."); return; }
    code.textContent = `${html.split("\n").length} lines · ${(html.length / 1024).toFixed(1)} kb`;
    step("check", `${html.split("\n").length} lines · ${(html.length / 1024).toFixed(1)} kb · doctype ok · no network`);
    step("commit-structure", "`" + (plan.commit || "feat(build): " + plan.issue.title.toLowerCase()) + "`");
    if (plan.pr) step("pr-create", `**${plan.pr.title}**\n\n- what: ${plan.pr.what}\n- why: ${plan.pr.why}\n- how to verify: ${plan.pr.verify}`);

    const slug = (prev && prev.slug) || "ayaan-" + Math.random().toString(36).slice(2, 8);
    let url = "";
    try {
      const dir = "ayaan-builds/" + slug;
      await puter.fs.mkdir(dir, { createMissingParents: true });
      await puter.fs.write(dir + "/index.html", html);
      if (!(prev && prev.slug)) await puter.hosting.create(slug, dir);
      url = "https://" + slug + ".puter.site";
      step("publish", prev ? `updated in place: [${url}](${url})` : `live: [${url}](${url}) · lives on your puter account, not mine`);
    } catch (e) { step("publish", `hosting failed (${e && e.message ? e.message : e}). showing it inline instead.`); }
    last = { html, url, slug: url ? slug : null, issue: plan.issue };
    preview(ui, html, url, !!prev);
  }
  window.BUILD = { run, isFollowUp: (p) => isFollowUp(p) };
})();
