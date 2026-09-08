# contributing

this is a personal site, so most prs come from me or an agent i am driving. outside fixes are welcome; keep them small.

## setup

```
npm ci
cp .env.example .env.local     # PUTER_AUTH_TOKEN optional. without it the ai is offline, which is a supported mode.
npm run dev                    # http://localhost:3000
```

node 22.9 or newer (the dev script uses `--env-file-if-exists`).

## branches and commits

branch from `main` as `kind/short-name`: `feat/call-interrupt`, `fix/map-fog`, `docs/deploy-runbook`, `chore/ci-node-22`, `content/sf-coffee-post`.

commits are conventional with a scope and a lowercase imperative summary:

```
feat(call): interrupt playback when the visitor starts talking
fix(server): serve /blog without a trailing slash
docs(deploy): add token rotation steps
```

scopes in use: `terminal`, `chat`, `map`, `build`, `call`, `blog`, `content`, `server`, `env`, `ci`, `deploy`, `docs`.

one concern per commit. stage files by name (`git add api/chat.js tests/chat.test.mjs`), not `-A`. no ai co-author trailers of any kind.

## before a pr

```
npm run check     # syntax, json shapes, secret scan, env docs, banned words
npm test
```

then fill the pr template: what, why, how to verify. one change per pr. visual changes get a screenshot.

## voice

copy in the ui, commits and docs is lowercase and direct. no em dashes, no "delve / robust / seamless / leverage / comprehensive". `content/voice.md` has the full spec and samples.

## what not to change without asking

- the ai persona's hard rules in `api/chat.js` (what it declines, how it describes muvik and advanceiq)
- `content/knowledge.js` facts (they are about a real person)
- the dependency count (see `docs/adr/0001-zero-dependencies.md`)
