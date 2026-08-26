# Elatura

Elatura is an experimental, local-first **adaptive access layer for heavyweight authenticated web applications**.

It keeps the genuine signed-in application authoritative while managing how much browser/application state stays resident and how much a human or computer-using agent needs to inspect before acting. ChatGPT conversations large enough to freeze or crash an ordinary browser remain the first pathological workload, while the product boundary now reaches the broader live-application working-set problem.

An **Elatura application lane** is a consumer-neutral managed live view of one useful application target:

```text
heavyweight authenticated application
            ↓
Elatura application lane
            ↓
bounded working set
change/lifecycle signals
bounded DOM/accessibility observation
screenshots when useful
full genuine-application interaction when necessary
            ↓
      human or agent
```

Browser tab, target, window, and process ids are current projections of a lane. They can be reacquired after navigation, discard, crash, restart, or host migration. Work scheduling, mission, responsibility, and dispatch stay outside Elatura; Stensibly owns those portfolio concerns.

See [`docs/application-lanes.md`](docs/application-lanes.md) for the product model and [`docs/developer-workflow.md`](docs/developer-workflow.md) for the current repository workflow.

## Status

Elatura is in **active prototype and dogfood**. Current work centers on the application-lane question: how many authenticated application targets can remain truthfully useful on one machine while only a smaller working set consumes full live-browser cost?

Current implementation includes:

- a canonical `application-lane/v1` identity/event/observe/activate/screenshot contract with generation-safe runtime ownership;
- `responsive | suspended | reclaimable` residency intent with application/browser eligibility and blocker checks;
- a thin zero-content Chromium projection host using browser-native Keep warm, discard, reload, and foreground activation primitives;
- generation/projection/currentness/anti-replay fences around managed Chromium effects;
- a ChatGPT continuity witness and current-state lifecycle sentinel contract;
- a Firefox ChatGPT blocker producer with exact lane targeting, private document/route projection epochs, and stale-projection refusal;
- a volatile Firefox operator bind/sample panel plus canonical content-free diagnostic export and offline admission;
- a locked, fail-open Firefox slim-mode laboratory with bounded DOM discovery, render suppression, latest-window planning, restoration, and drift handling;
- deterministic oversized synthetic fixtures, malformed graph families, and adapter conformance coverage;
- bounded companion/browser working-set and plateau accounting;
- Google Docs generated workload and human/lifecycle fidelity contracts;
- a preregistered live application-lane benchmark with strict schema/privacy/timing admission and a machine-readable next-run helper;
- a negative bounded-agent-viewport result showing ordinary local search wins when a clean local representation already exists.

The primary product evidence gate is #116. It compares stock browser behavior with Elatura-managed lanes using whole-browser resource cost, recovery latency/fidelity, and useful authenticated lane count. #118 owns the Google Docs human-first replication.

The browser-native result is allowed to win. Elatura earns product value through better application-aware eligibility, recovery truth, attention routing, and human/agent handoff when those improve the real working set.

Elatura remains experimental software. Preserve recovery paths and the authoritative application while testing it.

## Browser roles

### Chromium

Chromium is the primary lifecycle/resource host. The current extension stays deliberately thin:

- Manifest V3 / Chrome 132+;
- zero requested permissions and host permissions;
- browser ids remain private projections;
- durable lane identity stays outside the service worker;
- browser-native reload/discard/focus primitives perform reviewed physical effects;
- deeper CDP/custom-browser capability remains evidence-gated.

### Firefox

Firefox remains Elatura's strongest application-observation and DOM-intervention laboratory. It supplies the current ChatGPT blocker producer and diagnostic operator path, while the older response-transform/slim-mode work remains separately gated and fail-open.

## Development

Recommended runtime: Node 22, matching hosted CI.

```bash
nvm use
npm ci --ignore-scripts
```

For the ordinary TypeScript/test inner loop:

```bash
npm run check:code
```

For one focused test:

```bash
npm test -- path/to/file.test.ts
```

Before merge, run the complete repository gate:

```bash
npm run check
```

The complete gate covers security/capability checks, TypeScript, all tests, Firefox build/lint, build-manifest generation, and the unsigned release-candidate smoke path.

For Firefox development:

```bash
npm run run:firefox
```

See [`docs/developer-workflow.md`](docs/developer-workflow.md) for the command map and contribution loop. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for review expectations.

## Live application-lane experiment

Read [`docs/live-application-lane-benchmark.md`](docs/live-application-lane-benchmark.md) and [`docs/live-application-lane-execution-checklist.md`](docs/live-application-lane-execution-checklist.md) before physical collection.

The operator loop is:

```text
live-lane:plan
  -> live-lane:verify-plan
  -> live-lane:next
  -> execute the reported physical subrun
  -> add run + projection pair
  -> repeat
  -> live-lane:check at the stage boundary
```

Typical commands:

```bash
npm run live-lane:verify-plan -- artifacts/live-application-lane/session-plan.json
npm run live-lane:next -- <plan.json> <stage-final-dir> --stage chatgpt-single
npm run live-lane:check -- <plan.json> <stage-final-dir> --stage chatgpt-single
```

`live-lane:next` provides progress/cooldown guidance. `live-lane:check` owns stage/full evidence readiness.

Firefox ChatGPT supplemental blocker diagnostics can be admitted offline with:

```bash
npm run benchmark:chatgpt-activity -- <diagnostic.json>
```

Those diagnostics stay outside resource-stage `final/` directories and outside the primary resource sampling interval.

## Synthetic and offline work

Repository work can continue before private/authenticated browser collection:

```bash
npm run generate:fixture -- --turns 5000 --branches-every 20 --out artifacts/fixture.json
npm run analyze:reports -- benchmarks/reports --out artifacts/summary.json
npm run benchmark:synthetic-materialization -- --turns 10000 --branches-every 20
```

See [`docs/offline-development.md`](docs/offline-development.md) for the boundary between synthetic work and live-application evidence.

## Contract documentation

- [`docs/application-lanes.md`](docs/application-lanes.md) — product model, ownership boundary, observation/intervention ladders, and experiment sequence
- [`docs/developer-workflow.md`](docs/developer-workflow.md) — developer setup, repository map, browser workflow, and benchmark commands
- [`docs/adapter-contracts.md`](docs/adapter-contracts.md) — capability declarations, staged methods, conformance, schema drift, and version compatibility
- [`docs/chatgpt-lane-activity-sentinel.md`](docs/chatgpt-lane-activity-sentinel.md) — ChatGPT transition-safety facts and permission ceiling
- [`docs/firefox-chatgpt-lane-activity-diagnostic.md`](docs/firefox-chatgpt-lane-activity-diagnostic.md) — physical Firefox blocker-diagnostic procedure
- [`docs/live-application-lane-operator-progress.md`](docs/live-application-lane-operator-progress.md) — next-run/cooldown helper semantics
- [`docs/cache-and-provenance.md`](docs/cache-and-provenance.md) — cache envelopes, isolation, freshness, retention, recovery, and provenance
- [`docs/fail-open-pipeline.md`](docs/fail-open-pipeline.md) — local transformation pipeline, resource budgets, diagnostics, and synthetic materialization
- [`docs/transform-safety.md`](docs/transform-safety.md) — disabled-by-default transform controls and authorization boundaries

## Repository map

```text
extension/firefox/        Firefox observation, activity probes, slim-mode, reports, and safety controls
extension/chromium/       thin Chromium projection/lifecycle host
packages/core/            generic lane/runtime/lifecycle, adapter, cache, representation, and companion contracts
packages/adapter-chatgpt/ ChatGPT graph, continuity, activity, transformation, and representation work
packages/companion-web/   bounded synthetic browser/view consumer and lifecycle accounting
packages/fixtures/        deterministic synthetic and malformed graph workloads
benchmarks/               live/synthetic evidence contracts, schemas, fixtures, and analysis
scripts/                  security, release, benchmark, operator, fixture, and evidence tooling
docs/                     product contracts, privacy, measurement, runbooks, and development decisions
```

## Coordination

Issue #12 is the current execution board. #116 is the primary browser/resource evidence gate. #117 tracks browser lifecycle capability. #118 owns the Google Docs human-first control.

## License

Source code is licensed under the Mozilla Public License 2.0. The Elatura name and branding are not granted under that software license.
