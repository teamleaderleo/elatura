# Elatura

Elatura is an experimental, local-first **adaptive browser sidecar for oversized interactive applications**.

It keeps the authenticated website and browser session as the source of truth, but aims to prevent an application from eagerly parsing, hydrating, and rendering far more state than the user currently needs. ChatGPT conversations large enough to freeze or crash a normal browser are the first workload, not the permanent product boundary.

## Status

Elatura is in **M0: evidence and observation**. The current code does not modify ChatGPT responses. It provides:

- an observe-only Firefox extension that passes response bytes through unchanged
- explicit benchmark runs with content-free JSON export
- lossless run totals, bounded redacted path aggregation, and report integrity flags
- capability-driven generic adapter contracts
- a reusable staged adapter conformance runner
- explicit schema-drift and adapter-version compatibility rules
- a conservative ChatGPT graph-shape inspector
- deterministic oversized synthetic fixtures and malformed graph families
- generic active-path selection planning without response materialization
- identifier-free, bounded structural fingerprints
- a versioned synthetic-only in-memory cache with isolation, expiry, invalidation, retention, deletion, and corruption recovery
- provenance and read-only representation contracts for search, timelines, branch navigation, code extraction, and jump-back
- a synthetic-only ChatGPT alternate representation
- privacy-validating batch analysis for observation reports
- property and compatibility tests

Private transcript persistence, private alternate-surface bridging, and live response transformation remain disabled behind the project gates.

Do not rely on Elatura for data recovery or production browsing yet.

## Why Firefox first?

Firefox exposes `webRequest.filterResponseData()`, which lets an extension monitor and eventually replace response bytes before a page consumes them. That is the first interception point we need to test. Firefox is the initial transport, not necessarily Elatura's final user interface.

## Development

Requirements:

- Node.js 22 or newer
- Firefox Developer Edition or Firefox Nightly recommended for temporary extension loading

```bash
npm install
npm run check
npm run run:firefox
```

Open the extension popup and choose **Start new run** before loading the test conversation. Ordinary browsing is not observed while the extension is idle. After the run, use **Export JSON**, then **Clear and stop**. See `docs/running-observer.md` for the comparison protocol.

The report contains aggregated redacted request paths, byte counts, durations, outcomes, browser/version information, page-readiness timings, and explicit integrity metadata. It does not contain response bodies, message text, cookies, authorization headers, query strings, or raw conversation identifiers.

Offline work does not need to stop while the private baseline is unavailable:

```bash
npm run generate:fixture -- --turns 5000 --branches-every 20 --out artifacts/fixture.json
npm run analyze:reports -- benchmarks/reports --out artifacts/summary.json
```

See `docs/offline-development.md` for the boundary between safe synthetic work and live-schema-dependent work.

## Contract documentation

- `docs/adapter-contracts.md` — capability declarations, staged methods, conformance, schema drift, and version compatibility
- `docs/cache-and-provenance.md` — cache envelopes, isolation, content identity, freshness, retention, recovery, provenance, and protection hooks
- `docs/second-workload-rubric.md` — evidence-based selection criteria for the second real adapter

## Repository map

```text
extension/firefox/        observe-only Firefox transport and tested report export
packages/core/            generic runtime, adapter, cache, provenance, representation, fingerprint, and selection contracts
packages/adapter-chatgpt/ ChatGPT-specific graph inspection and synthetic representation
packages/fixtures/        deterministic synthetic and malformed graph workloads
benchmarks/               report privacy validation, parsing, integrity, and batch analysis
docs/                     architecture, privacy, contracts, measurement, and development decisions
```

## License

Source code is licensed under the Mozilla Public License 2.0. The Elatura name and branding are not granted under that software license.
