# deploy runbook

railway runs one service from this repo. push to `main` deploys. this is the operator doc: first setup, secrets, rotation, rollback, and what to look at when it breaks.

## first setup (once)

1. railway → new project → deploy from github repo → `Ayaan2907/ayaan-site`, branch `main`.
2. builder: railpack is picked up from `railway.json`. no build command; start command is `npm start`. healthcheck `/api/health`, 30 s.
3. variables tab, minimum:

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

logs are json lines; railway's log filter takes `event:chat.model` style queries.

## local parity

`npm run dev` runs the same `scripts/server.mjs` with `.env.local`. the only prod differences are `NODE_ENV=production` (no per-request handler reload, hsts header) and the port.

## vercel, if ever needed

`vercel.json` and the `api/` handler signature still work there unchanged. set the same variables. rate limits become per-lambda-instance, which is looser.
