# architecture

one node process, plain files. the terminal, the ai persona, /build and /call share a knowledge file; the bay map stands alone. this doc is the map; the code comments carry the detail.

## request flow

```
                       ┌──────────────────────── scripts/server.mjs ─────────────────────────┐
browser ── GET /  ────▶│ static allow-list: index.html, bay.html, assets/, blog/, content/,  │
                       │ posts/, feed.xml, robots.txt. clean urls, /bay → bay.html,          │
                       │ /blog/:slug → blog/post.html                                        │
        ── /api/x ────▶│ body cap 512 kb → json parse → require("api/x.js")(req, res)       │
                       │ security headers on everything. json-lines logs to stdout.          │
                       └──────────────────────────────────────────────────────────────────────┘
```

`api/_env.js` reads and validates every env var once at boot. `api/_log.js` is the only logger. `api/_ratelimit.js` gives each handler a per-ip sliding window. `api/_puter.js` is the puter client. helpers start with `_` and are not routable.

## the terminal (index.html, assets/app.js)

a log of "turns" styled like a coding-agent session. slash commands are handled locally from `content/knowledge.js`. anything else is a question for the ai: `ask(q)` posts the last 16 turns to `/api/chat` and streams the reply into the log with `assets/md.js`. if `/api/chat` reports `ai: false`, answers come from a small keyword matcher over the same knowledge file, so the site degrades to "offline but still me".

routing inside `ask`: an active call sends the text to `CALL.say`; a message that reads like a follow-up to the last build (`BUILD.isFollowUp`) goes to `BUILD.run` with the previous html.

## the ai persona (api/chat.js)

`buildSystemPrompt(KNOWLEDGE)` turns `content/knowledge.js` and `content/voice.md` into one system prompt with the hard rules: first person, facts only from the file, off-limits topics declined, muvik as an apprenticeship, advanceiq as analytics not lending. provider is chosen in `_env.js`: puter (my token, `CHAT_MODEL`) when the token is set, anthropic when only that key is set, otherwise `none` and the handler answers 503. responses stream as plain text so the client needs no parser.

## the bay surface (bay.html, assets/bay/map.js, assets/bay/places.json)

its own entry point at `/bay`, its own css and bundle; loads nothing from the terminal. the terminal links out to it and the old canvas-map urls `/map` and `/city` 302 there. a narrative card deep-links back with `/?q=<question>`, which the terminal pre-asks.

map: maplibre gl from a cdn, free raster tiles with no key and no build step — openstreetmap standard for day, esri world dark gray canvas for night (carto's legacy raster urls answer with an "api key required" watermark, so they are out). five toggleable category layers with per-layer counts; clicking a dot opens the narrative card and eases the view in (skipped under reduced motion); clicks get 12px of hit slop with nearest-dot wins, because small dots and fingers miss.

data: `assets/bay/places.json` is a geojson feature array — bay area places with real coordinates, a category (startup, office, housing, sports, tour) and a first-person note (what it is, why it matters, what happened there). no bare pins: a place without a note fails `scripts/check.mjs`. `content/city.json` stays as the seed material `places.json` was curated from; the old canvas city (repos as buildings, github vans, weather) is retired, and `/api/github` + `/api/weather` still serve the terminal.

## /graph (assets/map.js)

the older orbit + timeline view of the repos, still linked from the terminal.

## /build (api/build.js, assets/build.js, content/playbook.json)

owner mode, the default when `PUTER_AUTH_TOKEN` is set:

1. client posts `{ prompt, prev? }`. the handler checks the word blocklist, the per-ip limit (`BUILD_PER_HOUR`) and the daily cap (`BUILD_DAILY_CAP`).
2. plan call: one json object with an issue (title, acceptance, out of scope), a one-line restatement, the ponytail ladder verdict, a commit message and a pr body. shape enforced by `PLAN_SYSTEM`.
3. write call: streams one self-contained `index.html` under the house style and voice rules from `playbook.json`. the result must start with `<!doctype html>` and pass a regex that rejects any network access.
4. publish: `puter.fs.write` into `ayaan-builds/<slug>` and `puter.hosting.create(slug)` → `https://<slug>.puter.site`.
5. every stage is emitted as an ndjson `step` event whose name is a real skill from my agentos pipeline (`ticket-create`, `ponytail`, `code-style`, `check`, `commit-structure`, `pr-create`, `publish`), so the terminal shows how i actually build.

a follow-up (`prev` present) skips planning, runs an edit call with the previous html, and rewrites the same file so the url stays. visitor mode moves all of this into the browser on the visitor's own puter account. `BUILD_MODE=off` or `BUILD_KILL=1` disables it.

## /call (assets/call.js, api/tts.js)

browser `SpeechRecognition` (continuous, interim results) hears the visitor. final transcripts go through the same `/api/chat` stream; each completed sentence is posted to `/api/tts`, which calls puter's `txt2speech` (`TTS_VOICE`) and returns mp3 bytes played in order. interim speech while audio is playing aborts the stream and clears the queue, which is what makes interruption feel natural. if the mic is blocked the call stays up in typed mode. browsers without speech recognition fall back to `speechSynthesis` for output and typing for input.

## blog (blog/, posts/, drafts/, scripts/publish.mjs)

posts are markdown with front matter, rendered in the browser. `scripts/publish.mjs` turns anything in `drafts/` into a finished post using `voice.md` and the knowledge file (puter first, anthropic if configured), then rebuilds `posts/index.json`, `feed.xml` and the blog entries in `content/billboards.json`. `.github/workflows/publish.yml` runs it on push and commits the result; railway redeploys from that commit.

## bay data (api/_baydata.js, scripts/ingest.mjs, data/seed/)

`/bay` renders events and places from two json stores (`data/events.json`, `data/places.json`), rebuilt by `scripts/ingest.mjs` from three sources: the committed seed (`data/seed/`), luma's public discovery api (no key), and an eventbrite stub (its public search api closed in 2019; a tokened path slots in behind the same source interface). every record carries `source`, `fetchedAt` and a stable id; re-runs merge in place, never duplicate, and keep the earliest `firstSeenAt`. expiry is serve-time: events leave the api at `endsAt` (or `startsAt` when no end is listed) + a 24h grace, places stay until removed — the file keeps the full history, nothing is silently deleted. the server refreshes its own store on a timer (`INGEST_ENABLED`, default on in production, every `INGEST_INTERVAL_HOURS`) because a railway cron service runs in its own container and cannot write files the web service would see; the cron-service path returns once the store moves to shared storage.

## limits and known gaps

- rate limits and the daily cap are in memory: one instance only.
- `/api/github` without `GITHUB_TOKEN` sees about 90 days of public events; with a token it gets the full contribution calendar.
- the persona's fence is prompt-level. it is tight, but it is a prompt.
- `/call` is browser speech, not a realtime voice model. the upgrade path (openai realtime, an anam avatar, or a livekit worker) keeps `assets/call.js`'s card and swaps the transport.
- the bay store is two json files in one container: no cross-instance sharing and no history beyond the current merge window. the libsql/turso migration path is open but not built.
- luma coverage is the sf public calendar paged to 75 events per run; a source that is down tonight simply contributes nothing rather than failing the run.
