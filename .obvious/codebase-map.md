# codebase map — ayaan-site

| path | role |
|---|---|
| `index.html` | the terminal (single-page entry) |
| `assets/app.js` | terminal ui, commands, routing to ai / build / call |
| `assets/city.js` | /map — hand-rolled canvas 3d of sf |
| `assets/build.js` | /build client — step stream, previews, follow-ups, visitor mode |
| `assets/call.js` | /call client — speech recognition, tts queue, interruption |
| `assets/map.js` | /graph — older orbit + timeline view |
| `assets/md.js` | markdown renderer + front matter |
| `assets/style.css` | styles |
| `api/` | server handlers: `_env.js` (only env reader), `_log.js`, `_ratelimit.js`, `_puter.js` (puter sdk client), `health.js`, `chat.js`, `build.js`, `tts.js`, `github.js`, `weather.js` |
| `scripts/` | `server.mjs` (the server, dev and prod), `check.mjs` (ci gate), `publish.mjs` (drafts → posts) |
| `content/` | `knowledge.js` (the persona), `voice.md`, `playbook.json`, `city.json`, `billboards.json`, `repos.fallback.json` |
| `blog/` | index + post page (client-rendered markdown) |
| `posts/` | markdown posts + generated `index.json` |
| `drafts/` | rough notes, turned into posts by the publish action |
| `tests/` | node:test — env, rate limiter, server e2e |
| `docs/` | architecture, deploy runbook, adrs, build playbook |
| `.github/` | workflows (ci + blog publish), issue templates, pr template |
| root | `feed.xml`, `robots.txt`, `vercel.json` (rewrites/headers), `railway.json` + `railpack.json` (railway deploy), `.env.example`, `.node-version` |
