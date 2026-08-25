# Synthetic companion browser benchmark packet

Content-free measurement packet for the synthetic companion browser surface
(#83). It records bounded numbers and fixed tokens only — no conversation
content, titles, URLs, screenshots, transcripts, cookies, or notes.

**Claim boundary:** this packet defines how to measure. No physical desktop or
mobile browser measurements have been recorded in this repository yet, and no
performance, memory, or mobile-usability conclusion is claimed. Conclusions
require completed manifests from the matrix below.

## Fixed schema

`benchmarks/schema/benchmark-companion-browser-run-v1.schema.json` accepts:

- fixture identity from a fixed id enum plus entry/text/code counts;
- client revision token and protocol version (`1`);
- platform class (`desktop`/`mobile`), browser class (`chromium`/`gecko`/`webkit`),
  bounded version token;
- initial usable, page older/newer, and search latencies (numbers or `null`);
- peak process bytes when the platform exposes them (otherwise `null`);
- resident companion counts; retained client record counts; rendered rows,
  DOM nodes (when measurable), and artifact bytes;
- browser request/cache ledger counters;
- two probe sample arrays (≤32 samples each) of eight working-set counters;
- integrity: observed diagnostic state tokens and failure counters;
- privacy flags pinned to exactly `false`.

The parser/validator lives in `benchmarks/src/companion-browser-manifest.ts`
and is exercised by `benchmarks/test/companion-browser-manifest.test.ts`.

## Plateau rule

A manifest passes only when **both** required probes reach a bounded plateau:

- every tracked counter stays within its hard bound (mirroring the merged
  companion/client/render/ledger defaults);
- the second half of each probe's samples never exceeds the first half.

A monotonic retained-state, rendered-row, artifact-byte, or cache trend fails
with fixed codes (`monotonic-growth`, `over-hard-bound`,
`insufficient-samples`) per field. Trends are never narrated away.

## Desktop runbook

1. Build once so the served vendor modules exist:
   ```bash
   npm ci --ignore-scripts
   npm run build
   ```
2. Start one loopback server per fixture class (fresh terminal each):
   ```bash
   node scripts/run-synthetic-companion-loopback.mjs \
     --host 127.0.0.1 --port 4173 --conversation synthetic-10000
   ```
   The server prints its exact loopback URL. Record nothing else from it.
3. Open the printed URL in a clean browser profile (no extensions, empty
   cache). Note the browser version token.
4. In order, using only the page controls:
   - refresh list; open the conversation; note time-to-first-mounted-window
     as `initialUsableMs`;
   - press Older/Newer at least twice each; record median `pageOlderMs` /
     `pageNewerMs`;
   - search a short synthetic token; record `searchMs`;
   - run "Run switch probe" three times; transcribe the final
     `plateau-ok/failed` line's maxima into the switch probe samples;
   - run "Run open/close probe" three times; transcribe likewise;
   - exercise close/revoke once each and record final counters.
5. Capture memory only via an external process monitor reading the whole
   browser process class; record the peak as `peakProcessBytes` or omit with
   `null`.
6. Write one JSON manifest per run under a scratch directory outside the
   repository, then validate:
   ```bash
   npm run build # once, if dist is missing
   npm run benchmark:companion-browser -- /path/to/run-01.json
   ```

Repeat for `synthetic-100000` and any other fixture id. At least five runs per
fixture class are required before comparing distributions.

## Mobile runbook

Same steps on a phone with the desktop machine tethered on a private network
is **not supported**: the server refuses every non-loopback connection by
design. For mobile, use an on-device loopback (for example a local development
shell that runs Node on the device itself) or treat mobile as unmeasured. Any
future mobile path must keep the same zero-non-loopback guarantee.

Record `platformClass: "mobile"` only when the browser actually ran on the
phone against an on-device loopback. Otherwise do not record a mobile
manifest.

## What this packet does not claim

- no physical measurements are committed here;
- no comparison against ChatGPT or any production application;
- no statement about real conversations, real accounts, or private content;
- no iOS/Android support claim;
- no conclusion until valid manifests exist and pass the plateau evaluator.
