# Codex / computer-use handoff for the first live application-lane stage

This is the launch checklist for the first physical #116 evidence stage once a worker has access to the owner machine, authenticated browser profiles, and OS process measurements.

It is intentionally shorter than the frozen method. The authoritative experiment semantics remain:

- `docs/live-application-lane-benchmark.md`
- `docs/live-application-lane-execution-checklist.md`
- the generated `session-plan.json`
- `live-lane:check`

Use this file to start the physical work cleanly, then follow those sources when a detail differs.

## Goal of the first handoff

Run only the preregistered `chatgpt-single` resource stage first.

The question is:

> For one pathological authenticated ChatGPT conversation, what whole-browser resource cost and return/recovery cost do the matched stock and Elatura conditions produce while the application remains truthfully usable?

A decisive negative at this stage is a useful result and can stop later resource stages.

## 1. Start from a clean repository

Record the exact commit used for collection. Begin with current `main` and require a green repository gate:

```sh
nvm use
npm ci --ignore-scripts
npm run check
```

Keep that Elatura revision frozen through the session.

If the repository changed after the plan was generated, regenerate a new session plan instead of mixing revisions inside one session.

## 2. Confirm the machine/browser prerequisites

Before generating the session plan, identify and record the exact installed identities required by the frozen plan generator:

- Edge version + build token;
- Chrome version + build token;
- Chromium version + build token;
- Firefox version + build token;
- Elatura revision;
- Firefox managed-intervention token;
- Chromium managed-intervention token;
- Chromium transport: `extension-only` or `extension-cdp`.

Use the dedicated benchmark browser profiles and the same authenticated ChatGPT workload target across matched conditions. Keep raw profile ids, raw conversation URLs, titles, cookies, credentials, and provider identifiers outside committed evidence.

The measurement host should satisfy the frozen AC-power and unrelated-heavy-workload requirements before each physical subrun.

## 3. Generate the full preregistration once

The canonical plan includes all four potential stages even though collection begins with ChatGPT single-lane.

Generate the deterministic Google Docs fixture packet first because its identity is frozen into the full session plan:

```sh
node scripts/generate-google-docs-workload.mjs \
  --out artifacts/live-application-lane/google-docs-fixtures
```

Create the plan with the actual installed browser/build identities:

```sh
npm run live-lane:plan -- \
  --edge-version <edge-version> \
  --edge-build <edge-build> \
  --chrome-version <chrome-version> \
  --chrome-build <chrome-build> \
  --chromium-version <chromium-version> \
  --chromium-build <chromium-build> \
  --firefox-version <firefox-version> \
  --firefox-build <firefox-build> \
  --elatura-revision <elatura-revision> \
  --firefox-intervention <firefox-intervention-token> \
  --chromium-intervention <chromium-intervention-token> \
  --chromium-transport <extension-only-or-extension-cdp> \
  --gdocs-manifest artifacts/live-application-lane/google-docs-fixtures/manifest.json \
  --out artifacts/live-application-lane/session-plan.json
```

Verify immediately:

```sh
npm run live-lane:verify-plan -- \
  artifacts/live-application-lane/session-plan.json
```

Keep that plan unchanged.

## 4. Prepare the first-stage artifact directories

Use the canonical layout:

```text
artifacts/live-application-lane/stages/chatgpt-single/
  final/
  attempts-archive/
  readiness.json
```

Only accepted final run/projection pairs belong in `final/`.

Failed, interrupted, superseded, exploratory, diagnostic, screenshot, and operator-helper artifacts stay outside `final/`.

## 5. Ask the repository for the next exact physical slot

Before every subrun:

```sh
npm run live-lane:next -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/stages/chatgpt-single/final \
  --stage chatgpt-single
```

Treat its JSON output as progress/cooldown guidance. It identifies:

- next block / condition / physical-subrun ordinal;
- browser product/version/build;
- stock/passive/managed Elatura state;
- Elatura transport/revision/intervention token when present;
- workload token and lane count;
- cooldown eligibility and remaining milliseconds.

If it reports `cooldown`, wait until its `eligibleAt` boundary before starting the next planned subrun.

If it reports an artifact mismatch or out-of-order state, repair/archive the attempted artifact rather than skipping ahead.

`live-lane:check` remains the final evidence authority.

## 6. Reset the selected browser condition

Follow the frozen checklist before writing `startedAt`:

- restore the canonical dedicated profile snapshot for this condition;
- fully exit the target browser and Elatura broker/extension host as required by the plan;
- confirm browser/build and Elatura revision/intervention/transport match the plan;
- load the correct single ChatGPT workload target in the authenticated profile according to the runbook;
- keep DevTools closed during primary resource sampling unless the preregistered Chromium transport explicitly requires bounded CDP attachment;
- keep unrelated heavyweight workloads off the measurement host.

Use the same neutral input/application action specified by the frozen method for every matched condition.

## 7. Begin the physical subrun

Immediately before the external OS sampler starts, record canonical UTC `startedAt` for the run manifest.

Start the external sampler at the frozen 2-second interval. Whole-browser process-tree memory/CPU is the primary resource account; per-process/tab measurements are diagnostics.

During the measured interval:

- follow the exact ChatGPT single-lane timing/background-return schedule from the frozen plan/runbook;
- record every return, timeout, reload/discard, and recovery event required by the run manifest;
- preserve genuine signed-in application behavior;
- allow zero automatic application effect beyond the intervention explicitly defined by this planned condition;
- keep private content out of run/projection artifacts.

Do not open the Firefox diagnostic popup during the primary resource interval merely to collect supplemental state. Its activity sample belongs after primary sampling.

## 8. Finish resource sampling and perform recovery/fidelity checks

After the primary OS sampler stops:

- collect the optional DOM/runtime diagnostic permitted by the runbook;
- perform the prescribed restart-recovery probe;
- verify application identity/current region and ordinary interaction fidelity;
- record reload/recovery evidence and any manual attention required;
- classify failures truthfully; a failed recovery remains valid evidence.

For Firefox+Elatura ChatGPT conditions, the supplemental blocker diagnostic may now be collected.

## 9. Firefox ChatGPT supplemental diagnostic

Use the merged Firefox operator path only after primary resource sampling:

1. open the intended ChatGPT page;
2. enter the canonical Elatura `laneRef` and current generation shown by the lane runtime/benchmark pairing process;
3. select **Bind active page**;
4. select **Sample state** when an on-screen check is useful;
5. select **Export diagnostic** for a fresh canonical content-free observation.

The exported record includes the producer observation timestamp and fixed activity enums. It excludes tab id and private document/route projection identity.

Store the file outside every resource-stage `final/` directory, for example:

```text
artifacts/live-application-lane/stages/chatgpt-single/diagnostics/
```

Admit it offline:

```sh
npm run benchmark:chatgpt-activity -- \
  artifacts/live-application-lane/stages/chatgpt-single/diagnostics/<file>.json
```

Interpret the current v1 producer conservatively:

- directly observed generation/composer/IME/modal/media blockers can block a lifecycle transition;
- quiet state may remain `probable` because some transient dimensions are unknown;
- destructive ChatGPT discard eligibility remains unearned.

This diagnostic supplements fidelity analysis. It does not add a field to the frozen resource result schema and does not authorize a browser effect.

## 10. Write the accepted run/projection pair

After all required physical/recovery evidence is complete:

- write one strict `live-application-lane-run` JSON for the exact planned slot;
- write one linked `live-application-lane-projection-ledger` JSON with the same `runId`;
- write canonical UTC `recordedAt` immediately after the required evidence is complete;
- place both files in `chatgpt-single/final/` only when they are the accepted attempt.

Three identities remain separate in the projection ledger:

```text
benchmarkLaneToken
Elatura laneRef + laneGeneration   // Elatura conditions only
browserProjectionGeneration
```

Raw browser projection identifiers stay private.

Then run `live-lane:next` again. Its cooldown starts from the previous accepted run's `recordedAt`.

## 11. Stage readiness

When `live-lane:next` reports the `chatgpt-single` stage complete, reverify the unchanged plan and run the authoritative stage checker:

```sh
npm run live-lane:verify-plan -- \
  artifacts/live-application-lane/session-plan.json

npm run live-lane:check -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/stages/chatgpt-single/final \
  --stage chatgpt-single \
  --out artifacts/live-application-lane/stages/chatgpt-single/readiness.json
```

Require `ready: true` before analysis treats the stage as admitted evidence.

Keep `readiness.json` outside `final/`.

## 12. Interpret before investing further

Analyze the admitted stage before starting `chatgpt-switch-8`.

The first-stage comparison should keep these outcomes separate:

- whole-browser resident/resource cost;
- wake/return/recovery cost;
- application fidelity / attention-required outcomes;
- passive Elatura overhead;
- managed intervention effect.

Credit browser-native behavior to the browser.

A useful early negative can stop deeper intervention work. Examples:

- stock lifecycle behavior already reaches comparable resource/recovery behavior;
- Elatura observer overhead erases the measured gain;
- the managed intervention harms ordinary application fidelity;
- the application already manages its own resident state effectively.

A useful positive should identify the exact Elatura contribution, such as application-aware warm selection, safer reclaim eligibility, cleaner recovery truth, or reduced unnecessary attention.

Do not start the eight-lane or Google Docs resource stages solely because the plan contains those slots.

## 13. What to return from the computer-use handoff

The worker should return:

- exact repository revision and plan verification result;
- the admitted `chatgpt-single` `final/` run + projection bundle;
- stage `readiness.json`;
- content-free analysis outputs derived from admitted evidence;
- supplemental Firefox activity diagnostics kept separately;
- a concise account of any interrupted attempts kept in `attempts-archive/`;
- whether the first-stage evidence says continue, revise a measured capability, or stop deeper resource work.

If the authenticated application or measurement host prevents a valid run, return the exact blocked step and preserve the repository/evidence state. Do not fabricate replacement measurements.
