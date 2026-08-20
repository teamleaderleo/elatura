# Elatura

Elatura is an experimental, local-first **adaptive browser sidecar for oversized interactive applications**.

It keeps the authenticated website and browser session as the source of truth, but aims to prevent an application from eagerly parsing, hydrating, and rendering far more state than the user currently needs. ChatGPT conversations large enough to freeze or crash a normal browser are the first workload, not the permanent product boundary.

## Status

Elatura is in **active prototype and dogfood**. The project has moved beyond its original M0 observation-only phase: live/browser and physical-device work now feed the next implementation choices directly.

Current work includes:

- an observe-only Firefox transport and content-free benchmark/reporting path
- a locked, fail-open Firefox slim mode with bounded live DOM discovery, render suppression, latest-window planning, placeholders, restoration, and drift handling
- a preflighted DOM executor and browser host for the latest-window path
- a local-only Android ChatGPT notification sensor, guided diagnostics, OriginOS/iQOO setup, richer content-free notification metadata, and a completion-signal inbox
- stable-signing work for repeatable in-place Android test builds
- capability-driven generic adapter contracts and a reusable staged adapter conformance runner
- explicit schema-drift and adapter-version compatibility rules
- deterministic oversized synthetic fixtures and malformed graph families
- a pure fail-open response-binding/controller path with independent output validation
- identifier-free bounded fingerprints, cache/provenance contracts, and read-only representations
- locked transform emergency controls and non-authorizing session-local opt-in intent
- property, compatibility, adversarial, production-path, and physical-use-driven follow-up tests
- broader resource/offload experiments for heavyweight authenticated applications, including device-offload comparisons

The default Firefox response path still preserves authoritative response bytes, and high-authority live transformation remains separately gated. The active product question is now which intervention layer earns its complexity in real use: suppress or window live page state, use a cheaper local representation, or move execution elsewhere while preserving the native service experience.

Elatura remains experimental software. Keep recovery paths and the authoritative application available while testing it.

## Why Firefox first?

Firefox exposes `webRequest.filterResponseData()`, which lets an extension monitor and eventually replace response bytes before a page consumes them. That is the first interception point we need to test. Firefox is the initial transport, not necessarily Elatura's final user interface.

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

Offline work does not need to stop while a private/live experiment is unavailable:

```bash
npm run generate:fixture -- --turns 5000 --branches-every 20 --out artifacts/fixture.json
npm run analyze:reports -- benchmarks/reports --out artifacts/summary.json
```

See `docs/offline-development.md` for the boundary between safe synthetic work and live-schema-dependent work.

## Contract documentation

- `docs/adapter-contracts.md` — capability declarations, staged methods, conformance, schema drift, and version compatibility
- `docs/cache-and-provenance.md` — cache envelopes, isolation, content identity, freshness, retention, recovery, provenance, and protection hooks
- `docs/fail-open-pipeline.md` — pure orchestration, resource budgets, diagnostics, and synthetic materialization
- `docs/second-workload-rubric.md` — evidence-based selection criteria for the second real adapter
- `docs/transform-safety.md` — disabled-by-default transform controls and authorization boundaries
- `docs/live-baseline-runbook.md` — the original content-free M0 evidence protocol

## Repository map

```text
extension/firefox/        Firefox observation, slim-mode, reports, and locked safety controls
android/                  local completion-hint sensor and phone-side experiments where present
packages/core/            generic runtime, orchestration, adapter, cache, provenance, representation, fingerprint, and selection contracts
packages/adapter-chatgpt/ ChatGPT-specific graph inspection, synthetic transformation, and representation work
packages/fixtures/        deterministic synthetic and malformed graph workloads
benchmarks/               report validation, integrity, cohort analysis, session planning, and readiness
scripts/                  security, release, benchmark, fixture, and evidence tooling
docs/                     architecture, privacy, contracts, measurement, release, experiments, and development decisions
```

## License

Source code is licensed under the Mozilla Public License 2.0. The Elatura name and branding are not granted under that software license.
