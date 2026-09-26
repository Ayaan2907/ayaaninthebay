# adr 0002: puter as the ai, storage and hosting provider

date: 2026-09-08 · status: superseded 2026-09-26 by [adr 0004](0004-deployment-retired.md) — wingmic runs its own model providers

## context

three features need a model: the chat persona, `/build`, and `/call`'s speech. `/build` also needs somewhere to host the generated page. options were anthropic direct (paid per token), openrouter (paid), a self-hosted model, or puter, which gives free access to gpt-4.1-class models, a filesystem, static hosting and text-to-speech on a free account.

## decision

puter, in "owner mode": the server uses my token via `@heyputer/puter.js`, so visitors never sign in and i carry the (currently zero) cost. anthropic stays as an optional chat provider behind `CHAT_PROVIDER=anthropic` for when quality matters more than cost. models are pinned by env (`CHAT_MODEL`, `BUILD_MODEL`, default `gpt-4.1`).

what was tested and rejected: puter's openai-compatible rest endpoint (needs a paid subscription, 402) and claude models through puter (need credits, 402).

## consequences

- one secret (`PUTER_AUTH_TOKEN`) powers chat, build, tts and the blog publisher. rotating it at puter.com is the whole incident response.
- per-ip rate limits and a daily build cap protect the account; `BUILD_KILL=1` switches builds off without a deploy.
- if puter's free tier changes, `CHAT_PROVIDER=anthropic` keeps chat alive and `BUILD_MODE=visitor` moves build cost to the visitor's own account.
