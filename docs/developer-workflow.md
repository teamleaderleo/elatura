# Developer workflow

This is the short path for repository work before browser/application measurements are required.

The coordination owner is issue #12. Product direction lives in #1 / merged #119. The current live application-lane evidence gate is #116.

## Runtime and install

Use Node 22 for the same runtime line as hosted CI. The repository includes `.nvmrc`:

```sh
nvm use
```

`package.json` accepts Node 22 or newer, while Node 22 is the recommended development and CI line.

Install the committed dependency graph without lifecycle scripts:

```sh
npm ci --ignore-scripts
```

Do not repair dependency drift with an ad hoc install before understanding the lockfile change. Direct imports belong in direct package dependencies or dev dependencies; issue #178 tracks the current root AJV declaration cleanup.

## Iteration versus merge gate

For ordinary TypeScript/test iteration:

```sh
npm run check:code
```

That runs the TypeScript project build check and all Vitest tests. For one focused test file during editing:

```sh
npm test -- path/to/file.test.ts
```

Use watch mode when useful:

```sh
npm run test:watch -- path/to/file.test.ts
```

Before a pull request is treated as mergeable, run the complete gate:

```sh
npm run check
```

The complete gate includes security/capability checks, TypeScript, all tests, Firefox build/lint, build-manifest generation, and the unsigned release-candidate smoke path. A focused test or `check:code` result is iteration evidence only.

## Repository map

- `packages/core/` — provider-neutral contracts, lane/runtime/lifecycle policy, companion contracts.
- `packages/adapter-chatgpt/` — ChatGPT-specific validated application facts and fidelity contracts.
- `packages/companion-web/` — bounded local companion implementation.
- `extension/firefox/` — Firefox observation/slim-mode/browser integration.
- `extension/chromium/` — thin Chromium projection/lifecycle host.
- `benchmarks/` — benchmark contracts, schemas, fixtures, and benchmark-side code.
- `scripts/` — executable gates, benchmark operators, release checks, and local tools.
- `docs/` — product contracts, experiment methods, operator runbooks, and decisions.

Keep application-specific assumptions out of generic core. Keep browser IDs private to browser-host code. Keep work/dispatch authority outside Elatura.

## Browser-extension iteration

Build both TypeScript and extension assets with:

```sh
npm run build
```

Run the Firefox extension from the built directory with:

```sh
npm run run:firefox
```

Run Firefox package lint with:

```sh
npm run lint:extension
```

Create the reviewed unsigned local candidate path with:

```sh
npm run release:candidate:unsigned -- --channel=unlisted
```

Ordinary development CI creates no signed/published release.

## Live application-lane benchmark workflow

The frozen #116 resource experiment has four machine-admitted stages. Read `docs/live-application-lane-benchmark.md` and `docs/live-application-lane-execution-checklist.md` before physical collection.

The operator loop is:

```text
live-lane:plan
  -> live-lane:verify-plan
  -> live-lane:next
  -> execute the reported physical subrun
  -> add the run + projection pair
  -> live-lane:next
  -> repeat
  -> live-lane:check at the stage boundary
```

`live-lane:next` is progress guidance only. `live-lane:check` owns stage/full evidence readiness.

Useful commands:

```sh
npm run live-lane:plan -- ...
npm run live-lane:verify-plan -- artifacts/live-application-lane/session-plan.json
npm run live-lane:next -- <plan.json> <stage-final-dir> --stage chatgpt-single
npm run live-lane:check -- <plan.json> <stage-final-dir> --stage chatgpt-single
```

Firefox ChatGPT blocker diagnostics from the supplemental physical probe can be admitted offline with:

```sh
npm run benchmark:chatgpt-activity -- <diagnostic.json>
```

Keep those diagnostics outside every resource-stage `final/` directory. They supplement application-fidelity analysis and do not extend the frozen resource schema.

## Working on benchmark code before physical collection

Prefer synthetic fixtures and content-free admission tests for repository work. Physical authenticated measurements are a separate evidence gate.

When changing benchmark tooling:

1. preserve the preregistered plan/schema semantics unless the owning issue explicitly reopens them;
2. make malformed/extra/decorated input fail closed with fixed error tokens;
3. keep private content and browser projection identifiers out of committed evidence;
4. reuse shared validators/order/timestamp helpers instead of adding a second parser;
5. keep progress/operator helpers separate from final readiness authority.

A benchmark result can be negative. Tooling should make a negative result easy to preserve, inspect, and stop on.

## Pull-request packet

Keep one semantic owner and one narrow claim per PR. Include:

- the measured or observed problem;
- the exact behavior added or changed;
- failure/currentness/privacy boundaries;
- tests and the exact-head CI result;
- the issue or experiment that consumes the result.

When `main` moves under a branch that depends on current contracts, restack/revalidate the exact combined head before merge. Delete or close superseded alternate implementations instead of maintaining two owners for the same fact.
