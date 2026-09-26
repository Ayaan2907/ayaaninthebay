# deploy — retired 2026-09-26

this repo no longer deploys anything. the /bay map lives in
[Ayaan2907/wingmic](https://github.com/Ayaan2907/wingmic) and serves from the one
railway service behind app.wingmic.xyz — that repo's `docs/deploy.md` is the live
runbook, and [adr 0004](adr/0004-deployment-retired.md) records the decision.

the former runbook (the ayaan-site railway service: deploys, secrets, cron, domain)
retired with the deployment. what is left here is history: the terminal code, the /bay
code, and the probes below, taken on 2026-09-26 while the service was still up. the
uptime and the score answer together show the running image predates every /bay PR —
the /bay product never served traffic from here, so nothing needed migrating.

| probe | result (2026-09-26) |
| --- | --- |
| `GET https://ayaan-site-production.up.railway.app/api/health` | 200, `{"status":"ok","chat":true,"build":"owner","call":true,"voice":"mine","uptime":986195}` |
| `GET https://ayaan-site-production.up.railway.app/api/score` | `no such function` — no bay api in the deployed image |
| `https://ayaan.sh` | `ENOTFOUND` — no dns resolution |

## operator cleanup (outside this repo)

- delete the `ayaan-site` service (railway project `ab5ef996-9c8f-4b3a-8ca6-3366e081946c`)
  and its environment variables.
- remove the `ayaan.sh` dns records at the registrar.
