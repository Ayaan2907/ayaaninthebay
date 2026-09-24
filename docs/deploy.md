# deploy runbook

railway runs one service from this repo. push to `main` deploys. this is the operator doc: first setup, secrets, rotation, rollback, and what to look at when it breaks.

## where it is

- github: <https://github.com/Ayaan2907/ayaan-site>, branch `main`
- railway project `ayaan-site` (id `ab5ef996-9c8f-4b3a-8ca6-3366e081946c`), service `ayaan-site`, environment `production`
- url until the custom domain lands: <https://ayaan-site-production.up.railway.app>

the first deploy went up with `railway up` from the laptop (cli 5.x, `railway link` picks the project). auto-deploy from github needs the railway github app to see the repo once: railway dashboard → service → settings → source → connect repo → `Ayaan2907/ayaan-site`. after that, every push to `main` deploys and `railway up` is only for emergencies.

## first setup (once)

1. railway → new project → deploy from github repo → `Ayaan2907/ayaan-site`, branch `main`. (done; see above.)
2. builder: railpack is picked up from `railway.json`. no build command; start command is `npm start`. healthcheck `/api/health`, 30 s.
3. variables tab, minimum (set):

   | var | value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PUTER_AUTH_TOKEN` | from puter.com → settings → api token |
   | `SITE_URL` | `https://ayaan.sh` |

   everything else has a default in `api/_env.js`. `PORT` is injected by railway.
4. settings → networking → generate domain, then add the custom domain `ayaan.sh` and point dns (cname for `www`, the alias/ALIAS or railway's ip for the apex, per railway's instructions).
5. open `https://<domain>/api/health`. expected: `{"status":"ok","chat":true,"build":"owner","call":true,...}`.

## github actions secrets

the publish workflow needs, in repo → settings → secrets and variables → actions:

- secret `PUTER_AUTH_TOKEN` (same token) or `ANTHROPIC_API_KEY`
- optional vars `CHAT_MODEL`, `SITE_URL`

`ci.yml` needs nothing.

## variables you may want later

| var | why |
|---|---|
| `GITHUB_TOKEN` | full-year contribution calendar in `/activity` and the map. any classic token with no scopes. |
| `CHAT_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | better prose from the persona at a cost per message |
| `CHAT_MODEL`, `BUILD_MODEL` | swap puter models. free list is in `.env.example` |
| `CHAT_PER_HOUR`, `BUILD_PER_HOUR`, `BUILD_DAILY_CAP`, `TTS_PER_HOUR` | tighten if someone is hammering it |
| `BUILD_KILL=1` | stop `/build` right now, no deploy needed (railway restarts the service on variable change) |
| `LOG_LEVEL=debug` | log every request with timing |

## rotate the puter token

the token was pasted in a chat once, so treat it as rotatable on demand.

1. puter.com → settings → api token → regenerate.
2. railway → variables → replace `PUTER_AUTH_TOKEN`. the service restarts.
3. github → secrets → replace `PUTER_AUTH_TOKEN`.
4. `.env.local` on the laptop.
5. `curl -s https://ayaan.sh/api/health` shows `chat: true`; send one message in the terminal.

nothing else references the token.

## rollback

railway → deployments → pick the previous green deployment → redeploy. or `git revert` the commit and push; the deploy is under a minute.

## cli cheatsheet

```
railway link                      # once per clone: picks project ayaan-site
railway status                    # service state + url
railway logs --service ayaan-site # runtime logs (json lines)
railway variables --service ayaan-site --set BUILD_KILL=1   # emergency stop for /build
railway up --service ayaan-site   # deploy the working tree without github
railway domain                    # generate or list domains
```

## when it breaks

| symptom | look at |
|---|---|
| deploy fails at healthcheck | logs for `env X: expected …`. `_env.js` refuses bad values at boot on purpose. |
| status bar says `ai: local` in prod | `/api/health` → `chat: false`. token missing or `CHAT_PROVIDER` set wrong. |
| chat answers `(model error: …)` | puter side. logs have `chat.model` with the message. try another `CHAT_MODEL` from the free list. |
| `/build` says "builds are switched off" | `BUILD_KILL` or `BUILD_MODE=off` is set. |
| `/build` says "hosting didn't go through" | puter hosting quota or a bad slug. logs: `build.publish`. the page still shows inline. |
| `/call` has no voice | `/api/tts` 503 means no token; 502 means puter tts failed, logs: `tts`. the client falls back to the browser voice. |
| map has no buildings | `/api/github` 502 (rate limited without a token). the client uses `content/repos.fallback.json`. |
| 429s in logs | someone hit a per-ip limit. raise the cap or leave it. |
| `/bay` has no events | logs: `ingest.run` shows per-source errors. `npm run ingest:dry` reproduces without writing. |

logs are json lines; railway's log filter takes `event:chat.model` style queries.

## bay data (events + places)

`/bay` serves events and places from two json files (`data/events.json`, `data/places.json`), rebuilt by `scripts/ingest.mjs` from three sources:

| source | what | key |
|---|---|---|
| `seed` | committed curated launch data in `data/seed/` | none |
| `luma` | public discovery api, sf calendar paging (74 events at validation) | none |
| `eventbrite` | stub — public search closed in 2019; a tokened v3 path slots in behind the same source interface | n/a |

every record carries `source`, `fetchedAt` and a stable id; re-runs merge in place (never duplicates) and keep the earliest `firstSeenAt`. events expire from the read api at `endsAt` (or `startsAt` when no end is listed) + a 24h grace; places stay until removed. the store keeps full history — expiry is serve-time, nothing is deleted.

### refresh

the web service refreshes its own store on a timer: `INGEST_ENABLED` defaults to `on` in production and `off` in dev, every `INGEST_INTERVAL_HOURS` (default 6).

why a timer instead of a cron service: a railway cron is a separate service that runs and exits, and railway volumes cannot attach to two services — a cron-run ingest would write to a container the web service never sees. once the store moves to shared storage (libsql/turso), switch to the nightly cron and drop the timer:

1. railway → project → **+ new** → **cron service**
2. start command: `npm run ingest` (append `-- --source=luma` to scope it)
3. schedule: `0 3 * * *` (nightly, utc)

### ops

```
npm run ingest                          # all sources, writes the store
npm run ingest:dry                      # dry-run: reports what would change, writes nothing
npm run ingest -- --source=luma         # one source only
```

a failing source logs its errors into the `ingest.run` line and the other sources still merge; the cli exits non-zero when any source errored, so a cron can alert on exit code. `data/events.json` + `data/places.json` are gitignored runtime state; `data/seed/` is tracked, so a fresh deploy serves the seed until the first ingest lands.

## local parity

`npm run dev` runs the same `scripts/server.mjs` with `.env.local`. the only prod differences are `NODE_ENV=production` (no per-request handler reload, hsts header) and the port.

## vercel, if ever needed

`vercel.json` and the `api/` handler signature still work there unchanged. set the same variables. rate limits become per-lambda-instance, which is looser.
