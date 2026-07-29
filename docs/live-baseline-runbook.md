# Live baseline operator runbook

This runbook executes issue #3 against one private pathological conversation without recording the conversation title, URL, message text, screenshots, notes, query strings, cookies, credentials, process command lines, or raw response bodies.

The benchmark artifacts are content-free, but they still belong on the local test machine unless deliberately reviewed for publication.

## 1. Freeze the test identities

Use clean, dedicated test profiles for:

- Edge stable
- Firefox stable without Elatura
- Firefox stable with the exact Elatura observe build under test

Record the exact Edge and Firefox version tokens before the first run. Use one memory measurement method for every slot. Do not update either browser, reload a different extension build, or change the memory method during a session.

Build and verify the repository before creating the plan:

```sh
npm ci --ignore-scripts
npm run check
```

Generate the required 45-slot plan:

```sh
npm run baseline:plan -- \
  --edge-version 126.0 \
  --firefox-version 140.0 \
  --memory-method activity-monitor
```

Add `--client-navigation` only when committing to five client-navigation runs per mode. That produces a 60-slot plan.

The generated plan records only a UUID, canonical timestamp, bounded version tokens, memory method, fixed privacy flags, and ordered slot keys.

## 2. Directory layout

Keep the final checker input separate from failed or superseded attempts:

```text
artifacts/live-baseline/
  session-plan.json
  final/
    manifests/
    observations/
  attempts-archive/
  readiness.json
  benchmark-summary.json
```

The `final` directory must contain exactly one manifest for each planned slot and exactly one linked observation report for each `firefox-observe` slot. Preserve failed and superseded attempts in `attempts-archive`, which must not be passed to the readiness checker.

The checker treats every supplied input directory as a strict bounded bundle. It rejects symbolic links, special filesystem entries, every non-JSON file, nesting deeper than four directory levels, more than 16 directories, more than 128 entries in one directory, more than 96 JSON files, any JSON file larger than 1 MiB, or more than 16 MiB of JSON in total. The required 45-slot plan uses 60 final JSON files; the optional 60-slot plan uses 80. Remove incidental files such as `.DS_Store` before preflight.

Use content-free filenames based on the slot key, for example:

```text
edge-stock__cold-open__01.json
firefox-observe__hard-reload__07.manifest.json
firefox-observe__hard-reload__07.observation.json
```

Do not put the conversation title, URL, account name, project name, or free-form notes in a filename.

## 3. Follow the plan order

Run slots in the exact order listed in `session-plan.json`. The order rotates the three modes to reduce systematic drift from temperature, memory pressure, network conditions, and operator fatigue.

Do not regroup all Edge runs, then all Firefox runs, unless the entire plan is regenerated under a documented later protocol revision.

## 4. Navigation definitions

### Cold open

1. Fully quit the target browser.
2. Confirm its browser and content processes have exited.
3. Launch the clean test profile.
4. Open the private target conversation directly.
5. Record readiness and peak memory for that one open.
6. Quit the browser before the next cold-open slot.

A window close with browser processes still alive is not a cold open.

### Hard reload

1. Begin with the target conversation already loaded in the clean profile.
2. Trigger the browser's hard reload once.
3. Do not navigate to another page between measurement start and composer readiness.
4. Record readiness and peak memory for that reload.

Use the same hard-reload action throughout the session.

### Client navigation

This category is optional.

1. Begin on the same neutral ChatGPT page in the clean profile.
2. Navigate to the target conversation through the ordinary site UI.
3. Do not refresh or paste the private URL.
4. Record readiness and peak memory for that navigation.

Use the same neutral starting page and UI path for every client-navigation slot.

## 5. Observe-mode slots

For each `firefox-observe` slot:

1. Confirm the popup reports transforms as locked.
2. Start a new observation run immediately before the planned navigation or reload.
3. Perform exactly one planned action.
4. Wait until the composer is usable and request activity has settled.
5. Export the content-free observation JSON.
6. Create the matching benchmark manifest.
7. Copy the observation report's run UUID into both `runId` and `observerReportRunId`.
8. Set `timings.source` to `observer-report`.
9. Copy `domContentLoadedMs` and `composerReadyMs` exactly from the observation report.

Do not edit the observation report. An incomplete integrity result occupies no final slot; repeat that slot and keep the incomplete attempt only in `attempts-archive`.

## 6. Stock-browser slots

For Edge stock and Firefox stock:

- use `timings.source: manual`;
- use `observerReportRunId: null`;
- record the same readiness definitions used by observe mode;
- record numeric memory peaks with the session's single declared memory method;
- include no notes or free-form failure text.

A failed attempt may be recorded with a fixed failure code for audit, but the final readiness directory must contain one usable replacement for the slot. Move the failed attempt outside `final` before checking the session.

## 7. Abort and restart rules

Regenerate the entire session plan and restart the matrix when any locked identity changes:

- Edge version
- Firefox version
- Elatura extension version
- observation report schema version
- memory measurement method

Repeat only the affected slot when:

- the operator performs the wrong navigation action;
- an observer export is incomplete;
- the browser crashes;
- the composer timing cannot be measured;
- the memory measurement is missing;
- unrelated browsing occurs during the run.

Keep superseded attempts outside the final checker directory.

## 8. Preflight the completed matrix

Run the readiness checker against only the final manifests and observation reports:

```sh
npm run baseline:check -- \
  artifacts/live-baseline/session-plan.json \
  artifacts/live-baseline/final \
  --out artifacts/live-baseline/readiness.json
```

Keep `--out` outside every scanned input directory. The checker rejects an output path inside `final`, so a completed readiness file cannot become an input on the next run. Input rejection messages use fixed codes and entry numbers rather than arbitrary filenames or JSON values.

Exit code `0` and `ready: true` mean:

- every planned slot is present exactly once;
- no unexpected slot is present;
- browser, memory, extension, and report-schema identities match the plan;
- observe reports are linked and internally consistent;
- the benchmark matrix has no warning;
- every planned cohort is comparison-eligible.

Exit code `2` means the matrix is valid enough to inspect but not ready for conclusions. Fix the machine-readable issue codes rather than deleting warnings.

## 9. Produce the comparison

After readiness is true:

```sh
npm run compare:benchmarks -- \
  artifacts/live-baseline/final \
  --baseline firefox-stock \
  --out artifacts/live-baseline/benchmark-summary.json
```

Use medians, p95/worst cases, failure counts, observer integrity, and peak browser-total memory. Do not claim statistical significance from this matrix.

## 10. Issue #3 decision record

The issue #3 handoff should state only content-free conclusions:

- which redacted request path classes dominate bytes and duration;
- stock Firefox versus observe overhead;
- Edge versus Firefox readiness and memory distributions;
- whether client navigation materially differs, when measured;
- whether the visible conversation stayed unchanged in observe mode;
- the safest redacted response class for later adapter inspection.

Do not attach the conversation URL, title, screenshots, message content, raw network exports, or browser-profile data.
