#!/usr/bin/env node
// The ci gate. No bundler, no linter to install: syntax-check every js file, validate the json
// content, and run the same secret/voice scans the repo rules ask for. Exits 1 on the first problem.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".claude"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p);

// 1. every js/mjs file parses
for (const f of files.filter((p) => /\.(m?js)$/.test(p))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { problems.push(`${rel(f)}: ${String(e.stderr).split("\n").slice(0, 3).join(" ")}`); }
}

// 2. json content is valid and has the shape the front end expects
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
try {
  const city = json("content/city.json"); if (!Array.isArray(city.districts)) problems.push("content/city.json: districts missing");
  const pb = json("content/playbook.json"); if (!Array.isArray(pb.pipeline) || !pb.commit || !pb.commit.format) problems.push("content/playbook.json: pipeline/commit missing");
  const bb = json("content/billboards.json"); for (const k of ["x", "instagram", "blog"]) if (!Array.isArray(bb[k])) problems.push(`content/billboards.json: ${k} missing`);
  const posts = json("posts/index.json"); if (!Array.isArray(posts)) problems.push("posts/index.json: not an array");
} catch (e) { problems.push("json: " + e.message); }

// 3. no secrets in tracked text
const SECRET = /(sk-ant-[a-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,})/;
for (const f of files.filter((p) => !/\.(png|jpg|ico|lock)$/.test(p) && !rel(p).startsWith(".env.local"))) {
  const s = fs.readFileSync(f, "utf8");
  const m = SECRET.exec(s);
  if (m) problems.push(`${rel(f)}: looks like a secret (${m[0].slice(0, 12)}…)`);
}

// 4. env docs stay in sync with api/_env.js
const envJs = fs.readFileSync(path.join(ROOT, "api/_env.js"), "utf8");
const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
for (const m of envJs.matchAll(/\b(?:int|oneOf|str)\("([A-Z0-9_]+)"/g)) {
  const name = m[1];
  if (name === "NODE_ENV") continue;
  if (!new RegExp(`^#?\\s*${name}=`, "m").test(example)) problems.push(`.env.example: ${name} is read in api/_env.js but not documented`);
}

// 5. banned words in visitor-facing copy (UNSLOP)
const BANNED = /\b(delve|robust|seamless|cutting-edge|leverage|comprehensive|game-changer|revolutionary|supercharge)\b/i;
for (const f of ["index.html", "bay.html", "blog/index.html", "blog/post.html", "content/knowledge.js"]) {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  const m = BANNED.exec(s);
  if (m) problems.push(`${f}: banned word "${m[0]}"`);
}

if (problems.length) { for (const p of problems) process.stderr.write("✗ " + p + "\n"); process.exit(1); }
process.stdout.write(`✓ check: ${files.length} files, no problems\n`);
