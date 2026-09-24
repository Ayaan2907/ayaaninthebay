---
name: local-dev
---

# local-dev

how this sandbox was brought up during onboarding (2026-09-24).

## gotchas

- the sandbox image ships node 20.20.2, but this repo needs node >=22.9 — `npm run dev`
  uses `--env-file-if-exists`, a node 22 flag. node 22.20.0 was installed (tarball from
  nodejs.org) at `~/opt/node22`. prefix every command with
  `export PATH=~/opt/node22/bin:$PATH`.
- `node_modules/` was pre-created root-owned by the image; `npm ci` fails with EACCES
  until you `sudo chown -R user:user node_modules`. deps were already complete, so a
  fresh `npm ci` after chown is optional. passwordless sudo is available.
- package manager is npm (package-lock.json is tracked). an untracked `bun.lock` was in
  the fresh checkout; ignore it. TODO(confirm) its fate.

## procedure

1. `export PATH=~/opt/node22/bin:$PATH`
2. `npm ci` (after chown) — one runtime dep, fast.
3. `cp .env.example .env.local` — nothing is required for boot; without
   `PUTER_AUTH_TOKEN` the site runs offline (`ai: local`).
4. `npm run dev` under tmux: `tmux new-session -d -s dev 'npm run dev 2>&1 | tee /tmp/dev.log'`
5. confirm the `{"event":"listen","url":"http://localhost:3000",...}` line in
   `/tmp/dev.log`; the port field is authoritative (3000).
6. verify: `curl localhost:3000/api/health` → 200 `{"status":"ok",...}`.
7. `npm run check && npm test` → both green (12/12).

## api shape (verified live)

- GET `/` 200; GET `/api/health` 200; GET `/api/weather` real open-meteo data;
  GET `/api/github` 200 (public, no token needed for basic events/repos);
  POST `/api/chat` without a token → `{"error":"no_api_key"}` — expected; the browser
  falls back to `content/knowledge.js` locally.
