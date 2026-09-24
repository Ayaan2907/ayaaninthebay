# ayaan.

my personal site, built as a coding-agent session. type a question and it answers as me. type `/` and it shows commands.

`/bay` is its own surface now: san francisco at night, districts are chapters of my life, buildings are my github repos, vans are commits driving to the dock, the weather and daylight are real. the terminal links out to it. `/build <thing>` writes and ships a small web app for the visitor, live at a url, and takes follow-up edits. `/call` is a voice call with the ai version of me. `/activity` is my github feed. `/blog` is markdown in a folder that a github action publishes in my voice.

one runtime dependency (`@heyputer/puter.js`), no build step, no framework. node 22, one process, deployed on railway.

live: <https://ayaan.sh>

## run it

```
git clone https://github.com/Ayaan2907/ayaan-site && cd ayaan-site
npm ci
cp .env.example .env.local      # add PUTER_AUTH_TOKEN; everything else has a default
npm run dev                     # http://localhost:3000, hot-reloads api/ and restarts on change
```

without a token the site still works: the terminal answers from `content/knowledge.js` offline, `/build` runs in visitor mode, `/call` is off. the status bar says `ai: local`.

```
npm run check     # syntax, json shapes, secret scan, env docs in sync, banned words   (ci)
npm test          # node:test: env validation, rate limiter, the server end to end     (ci)
npm run publish   # drafts/ → posts/, rebuild index + rss + billboards
```

## layout

```
index.html               the terminal
bay.html                 /bay: the map surface, own entry point
assets/app.js            terminal ui, commands, routing to the ai / build / call
assets/bay/map.js        /bay: maplibre map of the bay with first-person notes, standalone bundle
assets/bay/places.json   /bay data: bay area places with real coordinates, category, note
assets/bay/bay.css       /bay styles, shared nothing with the terminal
assets/build.js          /build client: consumes the step stream, previews, follow-ups; visitor mode
assets/call.js           /call client: speech recognition, sentence-level tts queue, interruption
assets/map.js            /graph: the older orbit + timeline view
assets/md.js             markdown renderer + front matter
assets/style.css

content/knowledge.js     the one file about me. terminal, ai persona and publisher read it (the bay map carries its own links)
content/voice.md         how i write. ai persona and blog publisher read it
content/playbook.json    the /build pipeline: my agentos skills, house style, commit + pr shape
content/city.json        districts, landmarks, which repo goes where
content/billboards.json  what the billboards show. blog entries auto-update on publish
content/repos.fallback.json  repos shown when github is unreachable

api/_env.js              the only place that reads process.env. validated at boot
api/_log.js              json-lines logger
api/_ratelimit.js        per-ip sliding window + daily cap
api/_puter.js            puter sdk client (chat + fs + hosting), my token, free models
api/health.js            GET  /api/health   railway healthcheck
api/chat.js              GET|POST /api/chat streams the ai answering as me
api/build.js             GET|POST /api/build owner-mode builder, ndjson step stream
api/tts.js               POST /api/tts      text → mp3 for /call
api/github.js            GET  /api/github   events, calendar, repos (cached 15 min)
api/weather.js           GET  /api/weather  sf conditions from open-meteo (cached 30 min)

blog/                    index + post page (client-rendered markdown)
posts/*.md               posts. front matter: title, date, summary, tags, type, draft
posts/index.json         generated
feed.xml                 generated
drafts/                  drop rough notes here; the publish action turns them into posts

scripts/server.mjs       the server. static files + api/ handlers. dev and prod are the same file
scripts/check.mjs        the ci gate
scripts/publish.mjs      drafts → posts
tests/                   node:test
docs/                    architecture, deploy runbook, adrs, build playbook handoff
```

## how the pieces talk

```
browser ──/api/chat──▶ api/chat.js ──▶ puter sdk (gpt-4.1, my token)   ◀── knowledge.js + voice.md as the system prompt
        ──/api/build─▶ api/build.js ─▶ plan (json) → write (stream) → puter fs + hosting → <slug>.puter.site
        ──/api/tts───▶ api/tts.js ───▶ puter txt2speech → mp3 bytes
        ──/api/github▶ api/github.js ▶ github rest (+ graphql calendar with a token)
        ──/api/weather▶ api/weather.js ▶ open-meteo
```

details in [`docs/architecture.md`](docs/architecture.md). deploying and rotating secrets in [`docs/deploy.md`](docs/deploy.md). why it is built this way in [`docs/adr/`](docs/adr/).

## edit what it says about me

everything is in `content/knowledge.js`. change a bullet there and the terminal, the ai and the map update. the ai only knows what is in that file plus `voice.md`; it says "haven't written that down" for anything else and declines family, employer internals, immigration, politics and religion.

## publish a post

write anything into `drafts/some-note.md` (bullets, a transcript, a paragraph) and push. the `publish` action rewrites it in my voice, writes `posts/<slug>.md`, rebuilds the index, rss and the blog billboards, commits, and railway redeploys. read it at `/blog/<slug>` or `/read <slug>` in the terminal.

to write a post by hand, create `posts/<slug>.md` with front matter and run `npm run index`. `draft: true` hides a post.

## commands

`/help /about /now /work /projects /stack /blog /read <slug> /activity /sf /links /contact /map /graph /build <thing> /call /hangup /theme /clear`

`?q=...` in the url pre-asks a question. `ctrl+l` clears. `n` in the map forces night.

## license

code is mit. the writing is mine.
