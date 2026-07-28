# Content-free benchmark run manifests

Issue #3 compares Edge stock, Firefox stock, and Firefox with Elatura observe mode. Each individual cold open or hard reload receives one benchmark-run manifest. Observe-mode runs also retain the extension's content-free observation report with the same run UUID.

The manifest schema deliberately contains no workload label, conversation name, URL, note, screenshot reference, process command line, or free-form failure text. It accepts only bounded enums, a UUID, timestamps, browser versions, and numeric measurements.

## Required sample matrix

For each mode:

- five `cold-open` runs
- ten `hard-reload` runs

The comparison tool emits `small-sample` warnings for missing runs. `client-navigation` manifests are accepted without a minimum count.

## Example

```json
{
  "schemaVersion": 2,
  "runId": "00000000-0000-4000-8000-000000000001",
  "recordedAt": "2026-07-29T20:00:00.000Z",
  "mode": "firefox-stock",
  "navigation": "cold-open",
  "sequence": 1,
  "browser": {
    "name": "Firefox",
    "version": "140.0",
    "profile": "clean-test"
  },
  "timings": {
    "source": "manual",
    "domContentLoadedMs": 520,
    "composerReadyMs": 1420
  },
  "memory": {
    "method": "activity-monitor",
    "peaks": [
      {
        "processClass": "browser-total",
        "peakBytes": 2147483648
      }
    ]
  },
  "outcome": {
    "status": "usable",
    "failureCode": null
  },
  "observerReportRunId": null,
  "privacy": {
    "contentCaptured": false,
    "urlsCaptured": false,
    "notesCaptured": false,
    "processCommandLinesCaptured": false
  }
}
```

For `firefox-observe`, copy the observer report's run UUID into both `runId` and `observerReportRunId`, set `timings.source` to `observer-report`, and copy the report's DOM/composer timings exactly. The analyzer checks the linkage, browser version, timing values, and integrity flags.

## Memory classes

Use bounded process classes instead of raw process names:

- `browser-total`
- `browser-main`
- `content-total`
- `content-peak`
- `gpu`
- `extension`

`browser-total` is the comparison metric. Additional classes preserve a numeric breakdown. Supported methods are `activity-monitor`, `task-manager`, and `ps`.

## Outcomes

A usable run has `failureCode: null`. Failed or cancelled runs use one of these content-free codes:

- `browser-crash`
- `navigation-error`
- `composer-unavailable`
- `timeout`
- `operator-cancelled`

## Compare cohorts

```bash
npm run compare:benchmarks -- benchmark-runs --out artifacts/benchmark-summary.json
```

Inputs may mix manifests and exported observer reports. The default baseline is `firefox-stock`; select another with `--baseline edge-stock` or `--baseline firefox-observe`.

The output groups by mode and navigation, reports distributions, and emits machine-readable warnings. Percentage deltas remain null until both cohorts meet the required sample count and have usable, internally consistent measurements. An interrupted or persistence-incomplete observer report remains visible in the output and is excluded from complete cohort comparisons.
