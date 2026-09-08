# adr 0003: one server file, vercel-shaped handlers

date: 2026-09-08 · status: accepted

## context

the handlers in `api/` were written for vercel's node runtime (`module.exports = (req, res) => …`). the site now deploys to railway as a long-running process, and the same handlers should keep working on either host.

## decision

`scripts/server.mjs` is the only server, used unchanged in dev and prod. it serves an allow-list of public folders, applies security headers, caps request bodies, and dispatches `/api/<name>` to `api/<name>.js`. handlers keep the `(req, res)` signature and a pre-parsed `req.body`, so `vercel.json` still deploys the same folder if railway ever goes away.

rate limits live in process memory. that is correct for one instance and wrong for two; if the site ever scales out, `api/_ratelimit.js` keeps its interface and moves to redis.

## consequences

- `NODE_ENV=production` disables per-request handler reload; dev keeps it so edits to `api/` apply without a restart.
- `/api/health` is the railway healthcheck and reports which features are wired, never secrets.
- files that start with `_` in `api/` are helpers, not routes; the server refuses them.
