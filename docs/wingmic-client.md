# the wingmic client contract

How the map product consumes wingmic. The map never touches wingmic's database, it talks
to the boundary in `api/_wingmic.js`, which has two implementations:

| impl | status | selected by |
|---|---|---|
| `MockWingmicClient` | live | `WINGMIC_MOCK=on` (tests, local demos) |
| `RealWingmicClient` | live (wingmic PR #180 merged) | `WINGMIC_BASE_URL=https://app.wingmic.xyz` |

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

## the real client, as built

The interface grew two methods when the real client landed: `verify(token)` (one scoped
probe that sorts a dead key from a scoped-out one from infra trouble, used by `/api/link`)
and `capture(token, { text, id })` (best-effort claim capture, scope `capture:write`), plus
a `selfProfile` flag (mock true, real false) so `api/score.js` never mistakes a valid real
key for a failed lookup.

```js
class RealWingmicClient {
  constructor({ baseUrl }) {}                       // e.g. https://app.wingmic.xyz
  async getProfile(token) {
    return null;                                    // v1 has no self-profile read
  }
  async networkOverlap(token, { event, k = 3 }) {
    const q = [event.title, event.category, event.venue, event.note].filter(Boolean).join(" ");
    const r = await fetch(`${this.baseUrl}/api/v1/recall?q=${encodeURIComponent(q)}&limit=${k}`,
      { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401) throw new WingmicAuthError();   // dead key — the handler answers 401
    if (r.status === 403 || r.status === 429 || r.status >= 500) return []; // degrade
    if (!r.ok) throw new Error("wingmic recall: " + r.status);
    const j = await r.json();
    return (j.entities || []).slice(0, k).map((e) => ({
      who: e.name,
      why: contextWords(e).length                    // company + topic names
        ? `moves in the ${contextWords(e).join(", ")} circle`
        : "in your network",
      starter: null,                                 // the explain stage writes starters
    }));
  }
}
```

Notes: v1 recall returns **entities** (name, companies, topics), not the `results` sketch
this doc once assumed — the adapter maps those. 403/429/5xx degrade to `[]` (missing
scope, rate limit, outage: scoring must not break because wingmic did); a **401 throws**
`WingmicAuthError` so a dead key surfaces as 401 instead of scoring a silently empty
network; fetch failures degrade too. `api/score.js` wraps every client call in
`overlapSafely`, so the adapter only needs to be honest about what it throws.

Wiring, in place since the real client landed:

```js
if (ENV.wingmicBaseUrl) return new RealWingmicClient({ baseUrl: ENV.wingmicBaseUrl });
if (ENV.wingmicMock === "on") return new MockWingmicClient();
return null;
```

plus `wingmicBaseUrl: str("WINGMIC_BASE_URL", "")` in `api/_env.js`.

## token flow on the map

Wingmic v1 has no third-party token-issuance endpoint — a visitor's magic-link session
lives in wingmic's own app and the dashboard issues the scoped keys. So "sign in with
wingmic" on the map is honest about its shape: the visitor pastes a `wk_live_…` key, the
map probes it once against the real api (`POST /api/link`, which also pushes the throwaway
profile text into their graph via capture when they claimed one), then keeps the key in
`sessionStorage` for the session and rides network overlap on every score. The key never
touches the map server's storage or logs. Anonymous visitors keep the paste path, and
`WINGMIC_MOCK=on` deployments expose the demo path, clearly labeled in the UI.
