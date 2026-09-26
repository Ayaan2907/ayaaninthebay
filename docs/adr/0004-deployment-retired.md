# adr 0004: the /bay deployment retires; the map lives in wingmic

date: 2026-09-26 · status: accepted

## context

the merged product decision (the wingmic + ayaan-in-the-bay spec, 2026-09-25:
https://app.obvious.ai/p/prj_No2HsQ15?blueprint=art_9Ii0l0LU) moves the /bay map into
Ayaan2907/wingmic as one authenticated app: one auth, one graph, one deploy on
app.wingmic.xyz. the wingmic side has landed (PRs #192–#198; the in-app map, ask and
claim surface merged 2026-09-26 as PR #198).

production evidence from the migration inventory: this repo's railway container predates
every /bay PR, so the /bay product never served traffic from here; ayaan.sh no longer
resolves. there is no data to migrate and no traffic to cut over.

## decision

retire the deployment machinery from this repo: `railway.json`, `railpack.json`,
`vercel.json`, `scripts/server.mjs` with its in-process ingest timer, and the bay-only
env surface (`WINGMIC_*`, `INGEST_*`, `SCORE_PER_HOUR`, `DATA_DIR`). the ingest now runs
in the wingmic monorepo on a nightly railway cron, writing turso through drizzle.

the terminal and the /bay code stay as the historical record. this supersedes
[adr 0001](0001-zero-dependencies.md) (zero dependencies — the merged product is a typed
monorepo), [adr 0002](0002-puter-for-ai.md) (puter for ai — wingmic runs its own model
providers) and [adr 0003](0003-one-server-file.md) (one server file — next.js owns
serving in wingmic).

## consequences

- what still runs from a checkout: `npm run check`, `npm test`, the publish scripts, and
  the historical ingest (`npm run ingest:dry`) against the committed seed.
- operator cleanup outside the repo: delete the ayaan-site railway service and remove
  the ayaan.sh dns records (the PR body carries the checklist).
