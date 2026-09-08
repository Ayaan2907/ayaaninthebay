# adr 0001: one runtime dependency, no build step

date: 2026-09-08 · status: accepted

## context

the site started as a prototype in a sandbox with no access to npm or any cdn. that forced plain html, css and js from the first commit. when the constraint lifted, the question was whether to move to a framework (next, astro, vite) and three.js for the map.

## decision

stay at plain files. `scripts/server.mjs` on `node:http` serves everything and runs the `api/` handlers. the map is a hand-rolled canvas projection. the only runtime dependency is `@heyputer/puter.js`, because reimplementing puter's auth, fs and hosting calls is more code than the sdk.

## consequences

- `npm ci` takes seconds, railway builds take under a minute, cold start is instant.
- no typescript. the boundary code (`api/_env.js`, handler body parsing) does its own validation, and `scripts/check.mjs` replaces a linter.
- the map's renderer is about 400 lines and easy to replace with three.js later: the scene is boxes and the data (`content/city.json`, `/api/github`) does not change.
- adding a second dependency needs a new adr saying what it replaces.
