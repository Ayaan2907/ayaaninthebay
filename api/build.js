// /api/build: "hey ayaan, build me this", owner mode.
//   GET  -> { mode: "owner" | "visitor" | "off", perHour, model }
//   POST { prompt } -> streams NDJSON lines:
//        {t:"step",name,args,out?}   a tool call in the terminal (out = its result, markdown allowed)
//        {t:"chunk",text}            streamed html
//        {t:"done",url,html}         finished
//        {t:"error",message}
//
// The steps are Ayaan's real pipeline from content/playbook.json (AgentOS skills). Two model calls:
//   1. plan  (json): issue, restated criteria, ponytail ladder verdict, commit message, pr body
//   2. write (stream): the single html file, with the house style + voice rules in the system prompt
//
// Modes (env BUILD_MODE, default "owner" when PUTER_AUTH_TOKEN is set, else "visitor"):
//   owner   : this function generates with the Puter SDK using MY token (free models), then
//             publishes to MY puter account with @heyputer/puter.js. visitors never sign in. i pay.
//   visitor : the browser does everything with puter.js; the visitor signs in and pays.
//   off     : disabled (BUILD_MODE=off or BUILD_KILL=1).
// Env (see api/_env.js): PUTER_AUTH_TOKEN, BUILD_MODE, BUILD_MODEL, BUILD_PER_HOUR, BUILD_DAILY_CAP

const fs = require("fs");
const path = require("path");
const PLAYBOOK = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "playbook.json"), "utf8"));

const { ENV } = require("./_env.js");
const log = require("./_log.js");
const { clientIp, limiter, dailyCap } = require("./_ratelimit.js");
const P = require("./_puter.js");
const MODEL = ENV.buildModel;
const PER_HOUR = ENV.buildPerHour;
const rate = limiter({ perHour: PER_HOUR });
const daily = dailyCap(ENV.buildDailyCap);
const BLOCK = /(login|password|credit card|payment|checkout|phishing|scrape|scraper|crawler|bank|wallet|keylog|malware|virus|exploit|porn|nsfw|nude|hate|kill|weapon|suicide)/i;
const NET = /<script[^>]+src=|fetch\(|XMLHttpRequest|WebSocket|<link[^>]+href=|url\(\s*['"]?https?:|<iframe|<img[^>]+src=["']?https?:/i;
const mode = () => ENV.buildMode;

const PLAN_SYSTEM = `You are Ayaan's build pipeline. A visitor on his personal site asked for a tiny web app. Produce the planning artifacts his workflow produces, as strict JSON with these keys:
{"issue":{"title":string,"acceptance":[string,string,string],"out_of_scope":[string]},"restate":string,"ladder":{"verdict":string,"lines":number},"commit":string,"pr":{"title":string,"what":string,"why":string,"verify":string}}
Rules: acceptance criteria are testable one-liners. "restate" is one sentence restating the criteria as Ayaan would, lowercase, blunt. "ladder" walks ponytail's ladder (does this need to exist → reuse → stdlib → native platform → existing dep → one line → minimum that works) and lands on "minimum that works" with a line estimate under 250. commit is "${PLAYBOOK.commit.format}" (${PLAYBOOK.commit.rules.join("; ")}). pr sections: ${PLAYBOOK.pr.sections.join(", ")}.
Voice for every string: ${PLAYBOOK.voice.join(" ")}
Output only the JSON.`;

const WRITE_SYSTEM = (plan) => `You write one self-contained index.html for a small web app a visitor asked for on Ayaan Kaifullah's personal site. It must satisfy this issue exactly and nothing more:
${JSON.stringify(plan.issue)}
Ladder verdict: ${plan.ladder.verdict} (about ${plan.ladder.lines} lines).

House style (from Ayaan's AgentOS/CODE-STYLE.md):
${PLAYBOOK.style.map((s) => "- " + s).join("\n")}

Voice for any visible text (from AgentOS/UNSLOP.md):
${PLAYBOOK.voice.map((s) => "- " + s).join("\n")}

Hard rules: one file, inline css and js, no external requests of any kind, no forms that collect personal data, no login, no storage beyond localStorage, no tracking, nothing about real people, nothing adult or hateful. Start with <!doctype html>. Output only the html, no markdown fences, no commentary.`;

async function chat(token, messages, opts = {}) {
  return P.chat(messages, { model: MODEL, onChunk: opts.onChunk, timeout: opts.timeout || 90e3 });
}
const parseJson = (s) => { const a = s.indexOf("{"), b = s.lastIndexOf("}"); return JSON.parse(s.slice(a, b + 1)); };

module.exports = async function handler(req, res) {
  const m = mode();
  if (req.method === "GET") { res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); return res.end(JSON.stringify({ mode: m, perHour: PER_HOUR, model: m === "owner" ? MODEL : null, pipeline: PLAYBOOK.pipeline.map((p) => ({ show: p.show, desc: p.desc })) })); }
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.setHeader("x-accel-buffering", "no");
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  const fail = (message) => { send({ t: "error", message }); res.end(); };
  if (m !== "owner") return fail(m === "off" ? "builds are switched off right now." : "server builds are off; the site is in visitor mode.");

  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const prompt = String((body && body.prompt) || "").trim().slice(0, 500);
  const prev = body && body.prev && typeof body.prev.html === "string" && body.prev.html.length < 200000 ? { html: body.prev.html, slug: String(body.prev.slug || "").replace(/[^a-z0-9-]/g, "").slice(0, 32), issue: body.prev.issue } : null;
  if (!prompt) return fail("tell me what to build.");
  if (BLOCK.test(prompt)) return fail("not that. keep it to small, harmless apps: timers, toys, calculators, games, generators.");

  const ip = clientIp(req);
  if (rate.remaining(ip) === 0) return fail(`slow down: ${PER_HOUR} builds an hour. come back in a bit.`);
  if (!daily.take()) return fail("i've hit today's build budget. try tomorrow.");
  rate.take(ip);
  log.info("build", { ip, followUp: !!prev, prompt: prompt.slice(0, 80) });

  const token = ENV.puterAuthToken;
  const step = (skill, out) => { const p = PLAYBOOK.pipeline.find((x) => x.skill === skill); send({ t: "step", name: p ? p.show.split("(")[0] : skill, args: p ? p.show.replace(/^[^(]*\(|\)$/g, "") : "", out }); };

  // 1. plan (or, for a follow-up, a change request against the previous build)
  const slugBase = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24).replace(/-$/, "");
  let plan;
  if (prev) {
    send({ t: "step", name: "Bash", args: `git checkout ${prev.slug || "feat/" + slugBase} && git log -1 --oneline`, out: "same branch, same file. this is a change request, not a rebuild." });
    plan = { issue: prev.issue || { title: "follow-up", acceptance: [prompt], out_of_scope: [] }, ladder: { verdict: "edit in place, minimum diff", lines: prev.html.split("\n").length }, commit: "fix(build): " + slugBase.replace(/-/g, " "), pr: null };
    step("ticket-create", `**follow-up on ${plan.issue.title}**\n\n- ${prompt}`);
    step("ponytail", "edit in place. smallest diff that does the thing.");
  } else {
    send({ t: "step", name: "Bash", args: "cd ~/Developer/builds && git checkout -b feat/" + slugBase, out: "fresh branch, my machine. you don't sign in to anything." });
    try {
      plan = parseJson(await chat(token, [{ role: "system", content: PLAN_SYSTEM }, { role: "user", content: prompt }], { max: 900, temp: 0.3, timeout: 40e3 }));
      if (!plan.issue || !plan.ladder) throw new Error("plan shape");
    } catch (e) { return fail("planning failed: " + (e.message || e)); }
    step("ticket-create", `**${plan.issue.title}**\n\nacceptance:\n${(plan.issue.acceptance || []).map((a) => "- " + a).join("\n")}\n\nout of scope: ${(plan.issue.out_of_scope || []).join("; ") || "none"}`);
    step("ticket-resolve", plan.restate || "");
    step("ponytail", `${plan.ladder.verdict} → ~${plan.ladder.lines} lines, one file.`);
    step("code-style", "strict types, early returns, named functions, a11y not traded for brevity.");
  }

  // 2. write
  send({ t: "step", name: prev ? "Edit" : "Write", args: "index.html" });
  let html = "";
  const messages = prev
    ? [{ role: "system", content: WRITE_SYSTEM(plan) + "\n\nYou are EDITING an existing file. Apply only the requested change and keep everything else byte-for-byte where possible. Output the full updated file." }, { role: "user", content: "current index.html:\n\n" + prev.html + "\n\nchange request: " + prompt }]
    : [{ role: "system", content: WRITE_SYSTEM(plan) }, { role: "user", content: prompt }];
  try { html = await chat(token, messages, { onChunk: (d) => send({ t: "chunk", text: d }) }); }
  catch (e) { return fail("the model call failed: " + (e.message || e)); }
  html = html.replace(/^```html?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!/^<!doctype html>/i.test(html) || html.length < 200) return fail("got something that isn't a page. try rephrasing.");
  if (NET.test(html)) return fail("the generated page tried to reach the network, which the rules forbid. try again with a simpler ask.");

  // 3. check, commit, pr
  const lines = html.split("\n").length; const a11y = /<button|<input[^>]+aria-|<label/i.test(html);
  step("check", `${lines} lines · ${(html.length / 1024).toFixed(1)} kb · doctype ok · no network · ${a11y ? "a11y basics present" : "a11y: nothing interactive to check"}`);
  step("commit-structure", "`" + (plan.commit || "feat(build): " + plan.issue.title.toLowerCase()) + "`");
  if (plan.pr) step("pr-create", `**${plan.pr.title}**\n\n- what: ${plan.pr.what}\n- why: ${plan.pr.why}\n- how to verify: ${plan.pr.verify}`);

  // 4. publish on my puter account (optional; falls back to inline preview)
  send({ t: "meta", slug: prev && prev.slug ? prev.slug : null, issue: plan.issue });
  let url = "";
  try {
    const puter = P.puter();
    const slug = (prev && prev.slug) || "ayaan-" + Math.random().toString(36).slice(2, 8);
    const dir = "ayaan-builds/" + slug;
    await puter.fs.mkdir(dir, { createMissingParents: true });
    await puter.fs.write(dir + "/index.html", html);
    if (!(prev && prev.slug)) await puter.hosting.create(slug, dir);
    url = "https://" + slug + ".puter.site";
    step("publish", prev ? `updated in place: [${url}](${url})` : `live: [${url}](${url})`);
    send({ t: "meta", slug, issue: plan.issue });
  } catch (e) {
    log.error("build.publish", { ip, err: e });
    step("publish", "hosting didn't go through (" + String(e.message || e).slice(0, 120) + "). showing it inline instead.");
  }
  send({ t: "done", url, html });
  res.end();
};
