# Content-free benchmark run manifests

Issue #3 compares Edge stock, Firefox stock, and Firefox with Elatura observe mode. Each individual cold open or hard reload receives one benchmark-run manifest. Observe-mode runs also retain the extension's content-free observation report with the same run UUID.

The manifest schema deliberately contains no workload label, conversation name, URL, note, screenshot reference, process command line, or free-form failure text. It accepts only bounded enums, UUIDs, canonical UTC timestamps, browser versions, plan/slot identity, and numeric measurements.

`recordedAt` is the completion timestamp for that exact planned slot. It must use canonical ISO-8601 UTC form with millisecond precision, occur after the plan's `generatedAt`, and increase strictly in plan-slot order. Localized dates, timezone offsets, timestamps without milliseconds, reused session data, and reordered execution are rejected by readiness.

## Required sample matrix

For each mode:

- five `cold-open` runs
- ten `hard-reload` runs

`client-navigation` remains optional for issue #3. When recorded, it needs at least five runs per compared mode before the tool emits deltas. Smaller client-navigation cohorts remain visible as descriptive distributions with a `small-sample` warning and null comparison metrics.

## Session plan and readiness

Generate a content-free, version-locked run order before collecting data:

```bash
npm run baseline:plan -- \
  --edge-version 126.0 \
  --firefox-version 140.0 \
  --memory-method activity-monitor
```

The default plan contains 45 round-robin slots. Add `--client-navigation` for a 60-slot plan.

Every final manifest used by `baseline:check` must use schema 3 and copy these values from the plan and current slot exactly:

- `session.planSchemaVersion` from `plan.schemaVersion`
- `session.sessionId` from `plan.sessionId`
- `session.planGeneratedAt` from `plan.generatedAt`
- `session.slotOrdinal` from `slot.ordinal`
- `session.slotKey` from `slot.key`

Schema 2 remains accepted by the generic comparison analyzer for historical data. It cannot satisfy strict live-session readiness.

After collecting the final manifests and observe reports, verify them against the plan:

```bash
npm run baseline:check -- \
  artifacts/live-baseline/session-plan.json \
  artifacts/live-baseline/final \
  --out artifacts/live-baseline/readiness.json
```

The readiness report blocks conclusions when a slot is missing or unexpected, a manifest belongs to another session, plan creation metadata differs, ordinals are duplicated or mismatched, completion timestamps precede the plan or break canonical order, identities drift, an observe report is missing or mismatched, the matrix emits any warning, or a planned cohort is not comparison-eligible. It contains only the session UUID, counts, slot/cohort keys, and fixed issue codes.

The supplied final directory is also checked as a strict bounded bundle. Symbolic links, special entries, non-JSON files, more than four nested directory levels, more than 16 directories, more than 128 entries in one directory, more than 96 JSON files, JSON files above 1 MiB, and bundles above 16 MiB are rejected. `--out` must remain outside every scanned directory. Rejection messages contain fixed codes and entry numbers rather than arbitrary filenames or document values.

Follow [`live-baseline-runbook.md`](live-baseline-runbook.md) for the exact cold-open, hard-reload, client-navigation, retry, archive, order, and privacy protocol.

## Schema 3 example

```json
{
  "schemaVersion": 3,
  "session": {
    "planSchemaVersion": 1,
    "sessionId": "00000000-0000-4000-8000-000000000055",
    "planGeneratedAt": "2026-07-29T19:00:00.000Z",
    "slotOrdinal": 2,
    "slotKey": "firefox-stock|cold-open|1"
  },
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

An observe cohort also reports the distinct observer extension versions and observation report schema versions it contains. More than one extension version emits `mixed-observer-extension-versions`; more than one report schema emits `mixed-observer-report-schemas`. Both are critical errors and prevent cohort deltas. Re-run the cohort with one observer implementation rather than comparing across instrumentation changes.

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

Inputs may mix schema 2 historical manifests, schema 3 session-bound manifests, and exported observer reports. The default baseline is `firefox-stock`; select another with `--baseline edge-stock` or `--baseline firefox-observe`.

The output groups by mode and navigation, reports distributions, observer extension/schema identities, and machine-readable warnings. Percentage deltas remain null until both cohorts meet the required sample count and have usable, internally consistent measurements from comparable observer implementations. An interrupted or persistence-incomplete observer report remains visible in the output and is excluded from complete cohort comparisons.
