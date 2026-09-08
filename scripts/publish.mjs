#!/usr/bin/env node
// publish.mjs — turn rough drafts into finished posts in your voice, then
// rebuild posts/index.json and feed.xml. Zero dependencies (Node 20+).
//
//   node scripts/publish.mjs              # process every file in drafts/, rebuild index + feed
//   node scripts/publish.mjs --index-only # just rebuild index + feed from posts/*.md
//   node scripts/publish.mjs --raw        # publish drafts as-is (no AI), needs a title line
//   node scripts/publish.mjs --dry        # print the generated post, write nothing
//
// A draft is any .md/.txt in drafts/. It can be bullets, a voice-note transcript,
// a pasted chat, whatever. Optional front matter:
//   ---
//   title: ...        (else the AI picks one)
//   type: build-log | take | sf-note | project-note   (else inferred)
//   tags: a, b
//   date: 2026-09-08 (else today)
//   ---
// Env (api/_env.js): PUTER_AUTH_TOKEN (free, used first) or ANTHROPIC_API_KEY; CHAT_MODEL / ANTHROPIC_MODEL; SITE_URL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...s) => path.join(ROOT, ...s);
const args = new Set(process.argv.slice(2));
const K = require(P("content", "knowledge.js"));
const { ENV } = require(P("api", "_env.js"));
const SITE = ENV.siteUrl;
const MODEL = ENV.anthropicModel;

const today = () => new Date().toISOString().slice(0, 10);
const slugify = (s) => s.toLowerCase().replace(/['"’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function frontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  m[1].split("\n").forEach((ln) => { const k = ln.indexOf(":"); if (k > 0) data[ln.slice(0, k).trim()] = ln.slice(k + 1).trim().replace(/^["']|["']$/g, ""); });
  return { data, body: src.slice(m[0].length) };
}
const fm = (d) => "---\n" + Object.entries(d).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${String(v).replace(/\n/g, " ")}`).join("\n") + "\n---\n\n";

async function polish(draft, data) {
  const key = ENV.anthropicApiKey;
  if (!ENV.puterAuthToken && !key) throw new Error("PUTER_AUTH_TOKEN or ANTHROPIC_API_KEY missing (or use --raw)");
  const voice = fs.readFileSync(P("content", "voice.md"), "utf8");
  const facts = `name: ${K.name}\nrole: ${K.role}\nlocation: ${K.location}\nprojects: ${K.projects.map((p) => p.name).join(", ")}\nwork: ${K.work.map((w) => `${w.company} (${w.role})`).join("; ")}\noff-limits: ${K.offLimits.join("; ")}`;
  const system = `You are ghost-writing a blog post for Ayaan, published on his personal site under his name. Write it so it is indistinguishable from his own writing.

${voice}

FACTS YOU MAY RELY ON
${facts}

RULES
- Use ONLY what is in the draft plus the facts above. Do not invent events, numbers, quotes, or opinions he didn't express. If the draft is thin, the post is short. Never pad.
- Keep his exact technical claims and numbers. Keep his phrasing where it already sounds like him.
- Muvik is an apprenticeship / founder-level build with the co-founder, never "a job".
- Nothing about employer internals beyond what's public, family, immigration, politics, religion.
- No title case in headings. No emoji. No closing "thanks for reading".
- Output STRICT JSON: {"title": string, "slug": string, "summary": string (one sentence, lowercase), "tags": string[], "type": string, "body": string (markdown, no H1 — the title is rendered separately)}.`;

  const user = `DRAFT${data.type ? ` (type: ${data.type})` : ""}${data.title ? ` (title: ${data.title})` : ""}:\n\n${draft}`;
  if (ENV.puterAuthToken) {
    const text = await require(P("api", "_puter.js")).chat([{ role: "system", content: system }, { role: "user", content: user }], { model: ENV.chatModel, timeout: 120e3 });
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    return JSON.parse(text.slice(s, e + 1));
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: user }, { role: "assistant", content: "{" }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = "{" + j.content.map((c) => c.text || "").join("");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  return JSON.parse(text.slice(s, e + 1));
}

async function processDrafts() {
  const dir = P("drafts");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f) && !f.startsWith("_") && !f.startsWith("README"));
  const out = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const { data, body } = frontMatter(src);
    let post;
    if (args.has("--raw")) {
      const title = data.title || (body.match(/^#\s+(.+)$/m) || [])[1];
      if (!title) { console.error(`skip ${f}: --raw needs a title`); continue; }
      post = { title, slug: data.slug || slugify(title), summary: data.summary || "", tags: data.tags ? data.tags.split(",").map((t) => t.trim()) : [], type: data.type || "", body: body.replace(/^#\s+.+\n/, "").trim() };
    } else {
      process.stdout.write(`✻ polishing ${f} … `);
      post = await polish(body.trim(), data);
      console.log("ok");
    }
    const date = data.date || today();
    let slug = data.slug || post.slug || slugify(post.title);
    if (fs.existsSync(P("posts", slug + ".md")) && !data.slug) slug = `${slug}-${date}`;
    const md = fm({ title: post.title, date, summary: post.summary, tags: (post.tags || []).join(", "), type: post.type, source: f }) + post.body.trim() + "\n";
    if (args.has("--dry")) { console.log("\n" + md); continue; }
    fs.mkdirSync(P("posts"), { recursive: true });
    fs.writeFileSync(P("posts", slug + ".md"), md);
    fs.mkdirSync(path.join(dir, "published"), { recursive: true });
    fs.renameSync(path.join(dir, f), path.join(dir, "published", `${date}-${f}`));
    console.log(`  → posts/${slug}.md`);
    out.push(slug);
  }
  return out;
}

function rebuildIndex() {
  const dir = P("posts");
  fs.mkdirSync(dir, { recursive: true });
  const posts = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { data, body } = frontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    const slug = f.replace(/\.md$/, "");
    return { slug, title: data.title || slug, date: data.date || "", summary: data.summary || "", tags: data.tags ? data.tags.split(",").map((t) => t.trim()).filter(Boolean) : [], type: data.type || "", words: body.split(/\s+/).filter(Boolean).length, draft: data.draft === "true" };
  }).filter((p) => !p.draft).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  fs.writeFileSync(P("posts", "index.json"), JSON.stringify(posts, null, 2) + "\n");

  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const items = posts.map((p) => `  <item>\n    <title>${esc(p.title)}</title>\n    <link>${SITE}/blog/${p.slug}</link>\n    <guid>${SITE}/blog/${p.slug}</guid>\n    <pubDate>${p.date ? new Date(p.date + "T12:00:00Z").toUTCString() : ""}</pubDate>\n    <description>${esc(p.summary)}</description>\n  </item>`).join("\n");
  fs.writeFileSync(P("feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n  <title>ayaan — blog</title>\n  <link>${SITE}/blog/</link>\n  <description>build logs, takes on ai and agents, notes from san francisco.</description>\n${items}\n</channel></rss>\n`);
  // billboards in /map: keep the blog board in sync
  try {
    const bbPath = P("content", "billboards.json"); const bb = JSON.parse(fs.readFileSync(bbPath, "utf8"));
    bb.blog = posts.slice(0, 6).map((p) => ({ title: p.title, url: "/blog/" + p.slug, date: p.date }));
    fs.writeFileSync(bbPath, JSON.stringify(bb, null, 2) + "\n");
  } catch (e) { console.warn("billboards.json not updated:", e.message); }
  console.log(`index: ${posts.length} post${posts.length === 1 ? "" : "s"} → posts/index.json, feed.xml, content/billboards.json`);
  return posts;
}

(async () => {
  try {
    if (!args.has("--index-only")) await processDrafts();
    rebuildIndex();
  } catch (e) { console.error("✗", e.message); process.exit(1); }
})();
