# the wingmic client contract

How the map product consumes wingmic. The map never touches wingmic's database, it talks
to the boundary in `api/_wingmic.js`, which has two implementations:

| impl | status | selected by |
|---|---|---|
| `MockWingmicClient` | live | `WINGMIC_MOCK=on` (tests, local demos) |
| `RealWingmicClient` | not built, lands with wingmic PR #180 (public REST v1) | `makeWingmicClient` wiring below |

## the interface

```js
// the boundary both implementations honor. scoring degrades, never fails, on client errors.
const client = {
  // the signed-in viewer's profile. token = the viewer's own scoped wingmic key
  // ("sign in with wingmic" magic link → wk_live_…). null when it does not resolve.
  async getProfile(token) → { kind: "wingmic", name?, headline?, roles[], topics[], goals[], links{} } | null,

  // people from the viewer's own network connected to the event's world. [] on any failure.
  async networkOverlap(token, { event: { title, category, venue, note }, k }) → [{ who, why, starter? }],
};
```

## the v1 reality

Wingmic's public REST v1 (PR #180, `docs/api.md` on that branch) authenticates
`Authorization: Bearer wk_live_…` with server-side scopes `graph:read`, `capture:write`,
`search:read`, and serves `GET /api/v1/recall?q=<query>&limit=<k>` for network lookup.
It has **no self-profile read yet**, an API key can search the network but cannot fetch
its own owner's profile. Consequences, baked into the boundary:

- `networkOverlap` maps cleanly: `recall?q=<event words>` → entity results → `{ who, why, starter? }`
  (name, why from entity context, starter null, the explain stage writes starters when the
  network returns real people).
- `getProfile` returns `null` on real v1, so the signed-in path scores on `networkOverlap`
  plus the goal, and the UI keeps the ask available. The mock returns a fixture profile so
  the flow stays testable. When wingmic ships a self-profile endpoint, only the real adapter
  changes; nothing else in the pipeline notices.

## the adapter to write when PR #180 merges

```js
class RealWingmicClient {
  constructor({ baseUrl }) {}                       // e.g. https://wingmic.xyz
  async getProfile(token) {
    return null;                                    // v1 has no self-profile read
  }
  async networkOverlap(token, { event, k = 3 }) {
    const q = [event.title, event.category, event.venue].filter(Boolean).join(" ");
    const r = await fetch(`${this.baseUrl}/api/v1/recall?q=${encodeURIComponent(q)}&limit=${k}`,
      { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) return [];
    if (!r.ok) throw new Error("wingmic recall: " + r.status);
    const j = await r.json();
    return (j.results || []).slice(0, k).map((x) => ({
      who: x.name || x.title,
      why: x.summary || (x.kind ? `in your network (${x.kind})` : "in your network"),
      starter: null,                                // the explain stage writes starters
    }));
  }
}
```

Notes: 401/403/429/5xx degrade to `[]` (expired or unscored key, rate limit, outage:
scoring must not break because wingmic did); other non-ok statuses throw so bugs surface.
`api/score.js` already wraps every client call in `overlapSafely`, so the adapter only
needs to be honest about what it throws.

Wiring: in `api/_wingmic.js`, extend `makeWingmicClient(ENV)`:

```js
if (ENV.wingmicBaseUrl) return new RealWingmicClient({ baseUrl: ENV.wingmicBaseUrl });
if (ENV.wingmicMock === "on") return new MockWingmicClient();
return null;
```

plus `wingmicBaseUrl: str("WINGMIC_BASE_URL", "")` in `api/_env.js`. No handler change.

## token flow on the map

"Sign in with wingmic" (deferred until the real adapter lands) will trade the magic-link
session for a scoped token and hand it to `/api/score` as `wingmicToken`. Until then:
anonymous visitors paste a profile or linkedin url (throwaway path), and `WINGMIC_MOCK=on`
deployments expose the demo path, clearly labeled in the UI.
