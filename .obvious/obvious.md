# ayaan-site — agent guidance

Personal site of ayaan (ayaan.sh): an agent-session terminal, /map (canvas 3d of sf),
/build (ships small web apps live), /call (voice). Node 22, one process, no build step,
one runtime dependency (@heyputer/puter.js). Deployed on Railway (`npm start`,
healthcheck `/api/health`).

## commands

| what | command |
|---|---|
| install | `npm ci` |
| dev | `npm run dev` — http://localhost:3000, hot-reloads api/, restarts on change |
| start (prod) | `npm start` |
| ci gate | `npm run check` — syntax, json shapes, secret scan, env docs in sync |
| tests | `npm test` — node:test, 12 tests (env validation, rate limiter, server e2e) |
| publish | `npm run publish` — drafts/ → posts/, rebuilds index + rss + billboards |

## stack

- runtime: node >=22.9 (`.node-version` pins 22). the sandbox image ships node 20, which
  cannot run `npm run dev` (`--env-file-if-exists` is node 22+). node 22.20.0 was installed
  to `~/opt/node22` during onboarding — prefix commands with
  `export PATH=~/opt/node22/bin:$PATH`.
- package manager: npm (package-lock.json). a stray untracked `bun.lock` was present at
  onboarding; it is not canonical. TODO(confirm) whether to delete or commit it.
- no database, no docker, no external service required to boot.

## local dev

1. `npm ci`
2. `cp .env.example .env.local` — every var is optional locally; without a token the site
   runs offline (`ai: local` in the status bar, /build in visitor mode, /call off).
3. `npm run dev` → parse the port from the `{"event":"listen",...}` log line (default 3000).

env vars are read in exactly one place: `api/_env.js`, validated at boot. `npm run check`
fails if `.env.example` and the env docs drift.

## local verification

- `npm run check` → 68 files, no problems (verified 2026-09-24).
- `npm test` → 12/12 pass (verified 2026-09-24).
- primary flows hit live: GET `/` (200), GET `/api/health` (200,
  `{"status":"ok",...}`), GET `/api/weather` (real open-meteo data), GET `/api/github`
  (200), POST `/api/chat` (correctly answers `{"error":"no_api_key"}` with no token —
  the client falls back to `content/knowledge.js` per README).

## codebase map

see [codebase-map.md](codebase-map.md). deeper docs live in `docs/architecture.md`,
`docs/deploy.md`, `docs/build-playbook.md`, `docs/adr/`.

## sandbox snapshot

- snapshot id: `w0vxtlgy5b8itcv7ja7i:default`
- captured: 2026-09-24T18:39:24.918Z
- state: node 22.20.0 at `~/opt/node22`, deps installed, `.env.local` created from the
  example, dev server validated on port 3000.

## repo rules (from AGENTS.md / CLAUDE.md / CONTRIBUTING.md)

conventional commits with a scope, no ai co-author trailers, `process.env` only in
`api/_env.js`, tests with behaviour changes, `npm run check && npm test` green,
lowercase voice with no ai vocabulary. read CLAUDE.md before changing anything.
