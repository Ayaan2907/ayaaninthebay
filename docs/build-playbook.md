# /build playbook: how the theater maps to how ayaan builds

`/build <ask>` on the site plays out ayaan's real pipeline and ships a real app. This doc is the handoff for whoever extends it (a person or an agent).

## sources of truth

- `content/playbook.json` is what the site reads. hand-maintained. it is a condensed, public-safe copy of:
  - `~/Developer/AgentOS/AGENTS.md` (global agent instructions, non-negotiables, operating persona)
  - `~/Developer/AgentOS/CODE-STYLE.md` (TypeScript house style, extracted from advanceIQ.ai and wingmic)
  - `~/Developer/AgentOS/UNSLOP.md` (prose rules, always in effect)
  - `~/Developer/AgentOS/skills/personal/*/SKILL.md` (ticket-create, ticket-resolve, commit-structure, pr-create, persona, graphify)
- rule for what goes in: skill names and one-line descriptions are public and printed in the terminal. style and voice rules go into the model prompt only and are never printed. nothing from advanceIQ.ai internals, nothing from `PROFILE.md`, nothing from `agents-active`.

## how a build runs (owner mode, `api/build.js`)

1. `Bash(git checkout -b feat/<slug>)`, cosmetic, sets the scene.
2. plan call (json): `issue` {title, acceptance[3], out_of_scope}, `restate` (ticket-resolve's "restate the criteria in one message"), `ladder` (ponytail's verdict + line estimate), `commit` (conventional, scoped), `pr` {title, what, why, verify}.
3. steps printed from the plan: `Skill(ticket-create)`, `Skill(ticket-resolve)`, `Plugin(ponytail)`, `Read(AgentOS/CODE-STYLE.md)`.
4. write call (streamed): the html, with `playbook.style` and `playbook.voice` in the system prompt and the issue as the spec.
5. `Bash(bun run check)`: doctype, size, no-network scan, a11y presence. real checks, not theater.
6. `Skill(commit-structure)` and `Skill(pr-create)` print the plan's commit message and pr body.
7. `Bash(puter hosting create)`: publish on ayaan's puter account via `@heyputer/puter.js`; falls back to inline preview.

visitor mode (`assets/build.js`) runs the same steps in the browser with the visitor's puter account. keep the two in sync when you change the pipeline.

## how to extend

- add a step: append to `pipeline` in `playbook.json` with `skill`, `show` (what the terminal prints, `Name(args)`), `desc`, `emits`. then emit it from `api/build.js` with `step("<skill>", out)` and mirror in `assets/build.js`.
- change the style rules: edit `playbook.style`. keep each line a rule that applies to a single html/js file. things that only make sense in a TS monorepo (barrels, RSC, zod at boundaries) are intentionally left out.
- change the voice: edit `playbook.voice`. the banned word list mirrors AGENTS.md non-negotiable #8 and UNSLOP.md #7.
- personas (`/build --as <persona> ...`): not built yet. plan: read `agents-library/<category>/<name>.md` frontmatter into `content/personas.json` (public repo), pass the chosen persona's system prompt into the plan call as the reviewer voice, print `Skill(persona: <name>)` as a step.
- later automation: `scripts/sync-agentos.mjs` can regenerate `playbook.json` from AgentOS (frontmatter `name` and `description` from each SKILL.md; style and voice stay hand-condensed). not written yet on purpose; ayaan asked to hardcode for now.

## non-negotiables that also apply to this feature

- no ai co-author trailers anywhere a build produces text (commit messages, pr bodies). the plan prompt says so.
- simplest thing that works: one file, under 250 lines, no unrequested abstractions.
- a11y is not traded for brevity.
- evidence over vibes: the check step runs real checks and prints what it found.
