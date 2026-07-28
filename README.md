# Elatura

Elatura is an experimental, local-first **adaptive browser sidecar for oversized interactive applications**.

It keeps the authenticated website and browser session as the source of truth, but aims to prevent an application from eagerly parsing, hydrating, and rendering far more state than the user currently needs. ChatGPT conversations large enough to freeze or crash a normal browser are the first workload, not the permanent product boundary.

## Status

Elatura is in **M0: evidence and observation**. The current code does not modify ChatGPT responses. It provides:

- an observe-only Firefox extension that passes response bytes through unchanged
- local, content-free request and readiness measurements
- generic adapter and validation contracts
- a conservative ChatGPT graph-shape inspector
- synthetic graph fixtures and tests
- a benchmark report schema

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

The extension records only local diagnostics such as redacted request paths, byte counts, durations, and page-readiness timings. It does not record response bodies, message text, cookies, authorization headers, or query strings.

## Repository map

```text
extension/firefox/        observe-only Firefox transport
packages/core/            generic runtime contracts and structural fingerprints
packages/adapter-chatgpt/ ChatGPT-specific graph inspection
benchmarks/               local report types and aggregation
fixtures/                 generated or redacted structural fixtures (later)
docs/                     architecture, privacy, and measurement decisions
```

## License

Source code is licensed under the Mozilla Public License 2.0. The Elatura name and branding are not granted under that software license.
