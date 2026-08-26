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

See [`docs/application-lanes.md`](docs/application-lanes.md) for the current product model and experiment sequence.

## Status

Elatura is in **active prototype and dogfood**. The project has moved beyond its original M0 observation-only phase: live/browser and physical-device work now feed the next implementation choices directly.

Current work includes:

- an observe-only Firefox transport and content-free benchmark/reporting path
- a locked, fail-open Firefox slim mode with bounded live DOM discovery, render suppression, latest-window planning, placeholders, restoration, and drift handling
- a preflighted DOM executor for the latest-window path
- a local-only Android ChatGPT notification sensor, guided diagnostics, richer content-free notification metadata, and a completion-signal inbox
- stable-signing work for repeatable in-place Android test builds
- capability-driven generic adapter contracts and a reusable staged adapter conformance runner
- explicit schema-drift and adapter-version compatibility rules
- deterministic oversized synthetic fixtures and malformed graph families
- a pure fail-open response-binding/controller path with independent output validation
- identifier-free bounded fingerprints, cache/provenance contracts, and read-only representations
- a bounded synthetic companion/browser surface with lifecycle and plateau accounting
- locked transform emergency controls and non-authorizing session-local opt-in intent
- a negative bounded-agent-viewport result showing ordinary local search wins when a clean local representation already exists
- live application-lane, Chromium-transport, and Google Docs human-first experiments tracked in #116, #117, and #118

The default Firefox response path still preserves authoritative response bytes, and higher-authority live transformation remains separately gated. The immediate product test is whether an Elatura-managed live application lane can preserve ordinary human interaction and genuine computer-use access while reducing resident browser cost and unnecessary observation compared with fully loaded stock-browser sessions.

Elatura remains experimental software. Keep recovery paths and the authoritative application available while testing it.

## Why Firefox still matters

Firefox exposes `webRequest.filterResponseData()`, which gives a WebExtension control over response bytes before a page consumes them. The repository has also earned Firefox-specific bounded DOM discovery, render suppression/window planning, drift handling, content-free measurements, and a preflighted destructive executor.

Firefox therefore remains Elatura's strongest current response/DOM intervention laboratory and a first-class product transport. Chromium is being evaluated separately for target lifecycle, DOM/accessibility observation, screenshots, input, process control, and broad application compatibility. A Chromium fork remains evidence-gated.

## Development

Requirements:

- Node.js 22 or newer
- Firefox Developer Edition or Firefox Nightly recommended for temporary extension loading

Install exactly the frozen dependency graph and run the full repository gate:

```bash
npm ci --ignore-scripts
npm run check
npm run run:firefox
```

Open the extension popup and choose **Start new run** before loading the test conversation. Ordinary browsing is not observed while the extension is idle. After the run, use **Export JSON**, then **Clear and stop**. See `docs/running-observer.md` for the comparison protocol.

The report contains aggregated redacted request paths, byte counts, durations, outcomes, browser/version information, page-readiness timings, and explicit integrity metadata. It does not contain response bodies, message text, cookies, authorization headers, query strings, or raw conversation identifiers.

Offline work can continue while a private/live experiment is unavailable:

```bash
npm run generate:fixture -- --turns 5000 --branches-every 20 --out artifacts/fixture.json
npm run analyze:reports -- benchmarks/reports --out artifacts/summary.json
```

See `docs/offline-development.md` for the boundary between safe synthetic work and live-schema-dependent work.

## Contract documentation

- `docs/application-lanes.md` — current product model, ownership boundary, observation/intervention ladders, and experiment sequence
- `docs/adapter-contracts.md` — capability declarations, staged methods, conformance, schema drift, and version compatibility
- `docs/cache-and-provenance.md` — cache envelopes, isolation, content identity, freshness, retention, recovery, provenance, and protection hooks
- `docs/fail-open-pipeline.md` — local transformation pipeline, resource budgets, diagnostics, and synthetic materialization
- `docs/second-workload-rubric.md` — evidence-based selection criteria for a second real live-application workload
- `docs/transform-safety.md` — disabled-by-default transform controls and authorization boundaries
- `docs/live-baseline-runbook.md` — the original content-free M0 evidence protocol

## Repository map

```text
extension/firefox/        Firefox observation, slim-mode, reports, and locked safety controls
packages/core/            generic runtime, adapter, working-set, cache, provenance, representation, fingerprint, and pipeline contracts
packages/companion-web/   bounded synthetic browser/view consumer and lifecycle accounting
packages/adapter-chatgpt/ ChatGPT-specific graph inspection, synthetic transformation, and representation work
packages/fixtures/        deterministic synthetic and malformed graph workloads
benchmarks/               report validation, integrity, cohort analysis, session planning, and readiness
scripts/                  security, release, benchmark, fixture, and evidence tooling
docs/                     architecture, privacy, contracts, measurement, release, experiments, and development decisions
```

## License

Source code is licensed under the Mozilla Public License 2.0. The Elatura name and branding are not granted under that software license.
