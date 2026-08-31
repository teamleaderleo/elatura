# Elatura agent hot path

Elatura is a local-first management layer around heavyweight authenticated web applications. The
genuine signed-in application stays authoritative; local observation and projections never become
application or work authority.

## Always

- Preserve `laneRef + generation` as the durable lane identity. Browser tab, window, process, CDP
  target, document projection, and profile identifiers are private ephemeral projections.
- Revalidate generation and current projection around asynchronous reads and immediately before a
  physical effect. Old generations never affect newer lane state.
- Observation grants neither work nor dispatch authority; Stensibly owns scheduling. Treat unknown
  lifecycle eligibility conservatively and fail open to the genuine application.
- Keep private application content, credentials, authenticated URLs, browser/profile identifiers,
  screenshots, raw DOM/accessibility text, and provider payloads out of committed evidence unless a
  separately reviewed contract explicitly admits that artifact class. Prefer bounded opaque tokens.
- Browser capability, permission, CDP/debugger, content access, storage, and intervention expansion
  must answer a measured missing primitive. Keep generic core provider-neutral.

## Load by task

If **Always** decides the question, do not expand a route. Otherwise load only the matching owner:

| Task | Read |
| --- | --- |
| `packages/core` lane generation, projection, or currentness | `docs/application-lane-runtime.md`; stay out of browser-specific contracts unless the change crosses that seam |
| Product boundary or broad application-lane behavior | `docs/application-lanes.md`, then one named contract only if an uncertainty remains |
| Setup, repository map, or extension loop | `docs/developer-workflow.md`; `CONTRIBUTING.md` before PR/merge |
| Privacy, evidence, or browser capability | `docs/privacy.md` and the relevant Firefox/Chromium contract |
| Live benchmark code or evidence | Query the current owning issue, then `docs/live-application-lane-benchmark.md` and `docs/live-application-lane-execution-checklist.md` |
| Physical authenticated-browser work | `docs/codex-physical-handoff.md`; stop when only the owner machine can answer the remaining fact |
| Current priority or experiment status | Query the owning issue/current repository state; do not infer it from this file |

Use `README.md` only for broad orientation when the task owner is unclear. Search headings before
opening a long contract. Do not enumerate `docs/` or `packages/` to choose a route.

## Verify and finish

- Iterate with `npm run check:code` and the closest existing `npm test -- path/to/test.ts`; report
  the exact focused-test path when the change maps to one.
- Run `npm run check` before treating a branch as mergeable; focused results are iteration evidence.
- Keep one semantic owner and narrow claim per PR. Search current work before adding another API or
  validator, inspect the complete diff, and record the exact behavior, safety/currentness boundary,
  checks, and remaining physical unknowns.
