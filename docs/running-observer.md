# Running the M0 observer

The observer is intentionally inactive until a benchmark run is started from the extension popup. Use Elatura Observer 0.0.6 or later for schema-3 reports with content-independent path classes and active-stream integrity counters.

## Install and launch

```bash
npm ci --ignore-scripts
npm run check
npm run run:firefox
```

Use a dedicated Firefox profile for benchmark work. Sign in to ChatGPT normally inside that profile; do not copy cookies or tokens into Elatura.

## One observation run

1. Open the Elatura popup.
2. Choose **Start new run**. This clears previous local measurements and enables byte-for-byte response observation.
3. Open or hard-reload the target conversation.
4. Wait until the newest useful content is visible and the composer can accept input, or record that the page failed.
5. Open the popup and choose **Export JSON** after `activeRequestCount` reaches zero.
6. Choose **Clear and stop** before ordinary browsing.

The schema-3 report contains aggregated content-independent path classes, counts, observed bytes, request durations, errors, browser and extension versions, page readiness marks, and an `integrity` section. It does not contain response bodies, message text, query strings, cookies, authorization headers, raw conversation identifiers, filenames, slugs, or literal URL path segments.

The analyzer reads historical schema-2 exports. Analyze schema-2 and schema-3 reports separately because their path-template keys use different redaction semantics.

### Integrity fields

- `totalsComplete` is false if local persistence failed, capture continuity was interrupted, a response was still active at export, or observation capacity was exhausted.
- `pathBreakdownComplete` is false when totals are incomplete or the redacted path-class limit was exceeded.
- `overflowRequestCount` reports how many completed requests entered the explicit `/:elatura-overflow` path bucket.
- `persistenceErrorCount` reports failed local state writes observed by the active background session.
- `captureInterruptionCount` increments when Firefox recreates the extension background context while a run remains active.
- `activeRequestCount` reports response streams that were still open at export.
- `activeRequestLimit` is the maximum number of response filters held concurrently. The current policy is 128.
- `unobservedRequestCount` reports requests that continued normally after filter attachment failed or the active-request limit was reached.
- `bodySizeWarningThresholdBytes` is the numeric response-size warning threshold. The current policy is 64 MiB.
- `oversizedResponseCount` reports completed responses above that threshold. Their full byte totals remain counted and their chunks remain direct pass-through.
- Aggregate request totals are no longer limited to the most recent 200 requests.

Check the integrity section before comparing or publishing a report. A report with complete totals and an incomplete path breakdown remains useful for total byte and timing comparisons. A report with active or unobserved requests describes completed aggregates only and cannot support a complete-run total.

For benchmark runs, export after `activeRequestCount` reaches zero, then clear before quitting Firefox or reloading the extension. Start a fresh run after any browser or extension restart.

## Baseline matrix

Use the same private conversation and comparable clean profiles:

- Edge stable without Elatura
- Firefox stable without Elatura
- Firefox with Elatura observe mode

Record at least five cold opens and ten hard reloads per mode. Keep individual runs and compare medians plus worst cases. A cold open should begin after a full browser quit and relaunch. Start the Elatura observation run only after Firefox relaunches, so the deliberate cold-start boundary does not interrupt an active run. A hard reload should use the same signed-in profile without clearing application data between every run.

Record each run with the strict content-free manifest and compare cohorts using the workflow in [`benchmark-manifests.md`](benchmark-manifests.md). Observe-mode manifests use the same UUID and readiness timings as their exported observer report.

## Memory

Until Elatura gains native process instrumentation, record numeric peak memory separately with macOS Activity Monitor or a documented command-line procedure. Do not attach screenshots containing private page content. Store bounded process classes and numeric byte peaks in the run manifest instead of raw process names or command lines.

## Interpretation

"Bytes observed" means bytes delivered through Firefox's extension response filter. It is not automatically equivalent to compressed transfer size on the wire. The observer itself may add overhead, which is why stock Firefox and observe-mode Firefox must both be measured.
