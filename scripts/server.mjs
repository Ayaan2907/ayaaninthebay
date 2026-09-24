#!/usr/bin/env node
// The one server. Serves the static site and runs api/*.js handlers. Zero dependencies.
// Same code in dev and prod; the only differences are env vars and --watch.
//   dev : npm run dev    (node --watch --env-file-if-exists=.env.local scripts/server.mjs)
//   prod: npm start      (railway sets PORT)
// Handlers use the vercel-style (req, res) signature, so the same api/ folder still deploys to vercel untouched.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runIngest } from "./ingest.mjs";

const require = createRequire(import.meta.url);
const { ENV, describe } = require("../api/_env.js");
const log = require("../api/_log.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD = ENV.nodeEnv === "production";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const MAX_BODY = 512 * 1024;

// folders a request may touch. anything else on disk is invisible.
const PUBLIC = ["assets", "blog", "content", "posts", "bay.html", "index.html", "feed.xml", "robots.txt", "sitemap.xml"];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "", n = 0;
    req.on("data", (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error("body too large")); req.destroy(); } else b += c; });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

function securityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "microphone=(self), camera=(), geolocation=()");
  if (PROD) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}

async function api(req, res, name) {
  const file = path.join(ROOT, "api", name.replace(/[^a-z0-9_-]/gi, "") + ".js");
  if (name.startsWith("_") || !fs.existsSync(file)) { res.statusCode = 404; return res.end("no such function"); }
  if (!PROD) delete require.cache[require.resolve(file)];
  let raw = "";
  try { raw = await readBody(req); } catch (e) { res.statusCode = 413; return res.end(e.message); }
  try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
  try { await require(file)(req, res); }
  catch (e) { log.error("api.crash", { fn: name, err: e }); if (!res.headersSent) res.statusCode = 500; res.end("function error"); }
}

function serveStatic(req, res, p) {
  if (/^\/blog\/[^/.]+\/?$/.test(p)) p = "/blog/post.html";
  if (p === "/bay" || p === "/bay/") p = "/bay.html";
  if (p === "/map" || p === "/city") { res.statusCode = 302; res.setHeader("location", "/bay"); return res.end(); } // the old canvas-map urls land on the real map
  if (p === "/") p = "/index.html";
  if (p.endsWith("/")) p += "index.html";
  if (!PUBLIC.some((x) => p === "/" + x || p.startsWith("/" + x + "/"))) { res.statusCode = 404; return res.end("404"); }
  let file = path.join(ROOT, p);
  if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html";
  else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("404"); }
  const ext = path.extname(file);
  res.setHeader("content-type", MIME[ext] || "application/octet-stream");
  const isAsset = p.startsWith("/assets/") || p.startsWith("/content/");
  res.setHeader("cache-control", ext === ".html" ? "no-cache" : isAsset ? "public, max-age=3600, stale-while-revalidate=86400" : "public, max-age=300");
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  securityHeaders(res);
  res.on("finish", () => { if (ENV.logLevel === "debug" || res.statusCode >= 500) log.debug("http", { m: req.method, p: req.url, s: res.statusCode, ms: Date.now() - t0 }); });
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.statusCode = 400; return res.end("bad url"); }
  if (p.startsWith("/api/")) return api(req, res, p.slice(5));
  if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end(); }
  return serveStatic(req, res, p);
});

server.listen(ENV.port, () => log.info("listen", { url: `http://localhost:${ENV.port}`, ...describe() }));

// bay data refresh. a railway cron service cannot share this container's filesystem
// (volumes attach to one service), so the running server refreshes the store itself;
// docs/deploy.md has the cron-service alternative for when the store moves to libsql.
// off in dev unless INGEST_ENABLED=on.
if (ENV.ingestEnabled === "on") {
  const refresh = () => runIngest().catch((e) => log.error("ingest.timer", { err: e }));
  const first = setTimeout(refresh, 10_000);
  const timer = setInterval(refresh, ENV.ingestIntervalHours * 60 * 60 * 1000);
  first.unref();
  timer.unref();
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { log.info("shutdown", { sig }); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}
