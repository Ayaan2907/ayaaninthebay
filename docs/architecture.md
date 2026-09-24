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

## the bay surface (bay.html, assets/bay/city.js, content/city.json, api/github.js, api/weather.js)

its own entry point at `/bay`, its own css and bundle; loads nothing from the terminal. the terminal links out to it and `/map` redirects there. a building card deep-links back with `/?q=<question>`, which the terminal pre-asks.

data: `city.json` places districts (chapters of my life), landmarks, billboards and `match`/`overrides` rules that assign repos to districts. `/api/github` returns non-fork repos with size, stars and last push; each becomes a building, height from size and stars, lit windows if pushed in the last month. the last events become vans driving from their repo to the shipping dock. `/api/weather` (open-meteo, cached 30 min) drives fog and rain; the clock drives day and night.

renderer: perspective projection of axis-aligned boxes, painter's sort, flat shading, distance fog, all on a 2d canvas. no library. the scene is data in, boxes out, so swapping in three.js means replacing `drawBox` and the loop.

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

## limits and known gaps

- rate limits and the daily cap are in memory: one instance only.
- `/api/github` without `GITHUB_TOKEN` sees about 90 days of public events; with a token it gets the full contribution calendar.
- the persona's fence is prompt-level. it is tight, but it is a prompt.
- `/call` is browser speech, not a realtime voice model. the upgrade path (openai realtime, an anam avatar, or a livekit worker) keeps `assets/call.js`'s card and swaps the transport.
