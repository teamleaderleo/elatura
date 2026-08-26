# Live application-lane execution checklist

This is the executor-facing entry point for the #116 / #117 / #118 experiment packet.

Read [`live-application-lane-benchmark.md`](live-application-lane-benchmark.md) before collecting data. The runbook defines the measurement semantics, workload fixtures, plateau rule, attention trial, fidelity gates, and claim boundaries. This checklist defines the exact handoff sequence and artifact layout.

## Packet files

- `docs/live-application-lane-benchmark.md` — full method and analysis contract.
- `benchmarks/schema/live-application-lane-plan-v1.schema.json` — pre-registered resource-session plan.
- `benchmarks/schema/live-application-lane-run-v1.schema.json` — one physical resource/attention subrun.
- `benchmarks/schema/live-application-lane-projection-v1.schema.json` — cross-browser benchmark pairing, Elatura lane identity, browser projection generation, and canonical content-free lane events.
- `scripts/create-live-application-lane-plan.mjs` — canonical resource-plan generator.
- `scripts/verify-live-application-lane-plan.mjs` — rejects a rewritten plan.
- `scripts/check-live-application-lane-session.mjs` — stage or full-session readiness gate.
- `scripts/generate-google-docs-workload.mjs` — canonical #122 Google Docs fixture generator.

The generated resource plan contains exactly 112 physical subruns:

- ChatGPT single-lane: 5 blocks × 8 physical subruns = 40;
- ChatGPT 8-lane switching: 3 × 8 = 24;
- Google Docs single-lane: 3 × 8 = 24;
- Google Docs 8-lane switching: 3 × 8 = 24.

Each block has four stock physical subruns and two Elatura conditions with passive + managed subruns. The Elatura subrun order alternates by block.

**The four resource stages are independent evidence gates.** A valid stage receipt never requires later stages to be run. The 112-run plan is the maximum pre-registered envelope, not a requirement to spend operator time after an earlier stage has already produced a decisive negative.

The attention-routing trial remains a separate later gate because it intentionally compares different inspection policies. Keep its artifacts outside the resource-stage `final/` directories.

## 1. Prepare the repository once

```sh
npm ci --ignore-scripts
npm run check
```

Use the exact repository/Elatura revision that will remain frozen through the session.

## 2. Freeze browser and transport identities

Record before creating the plan:

- Edge version and build token;
- Chrome version and build token;
- Chromium version and build token;
- Firefox version and build token;
- Elatura revision token;
- Firefox managed-intervention token;
- Chromium managed-intervention token;
- Chromium Elatura transport: exactly `extension-only` or `extension-cdp`.

A token is a content-free bounded identifier. Use the actual installed build/version identity; avoid labels such as `latest`.

The selected Chromium transport is part of the pre-registration. Both Chromium+Elatura passive and managed subruns use that same transport. This keeps debugger/CDP attachment cost inside the passive-overhead measurement whenever the managed intervention requires it, and keeps CDP completely absent when the selected experiment is extension-only.

## 3. Generate the canonical Google Docs fixtures

Before creating the session plan, generate #122's exact deterministic workload packet into a fresh directory:

```sh
node scripts/generate-google-docs-workload.mjs \
  --out artifacts/live-application-lane/google-docs-fixtures
```

The directory must contain the canonical generator manifest plus these deterministic workloads:

- `docs-large-text-v1`: one 4,800-paragraph / 772,800-code-unit document;
- `docs-switch-8-v1`: eight 1,800-paragraph / 289,800-code-unit documents, 2,318,400 code units total.

Do not edit the generated files or `manifest.json`. The live-lane plan generator reads the manifest, checks its generator identity, filename/order/count metadata, requires the exact #122 SHA-256 digest for every generated document, re-reads the sibling fixture bytes, and recomputes length plus SHA-256 before creating the plan. A same-name fixture with different bytes is rejected.

Keep this fixture directory unchanged for every Google Docs browser condition in the session. Import the generated text into operator-owned Google Docs test documents according to #122's workload runbook; record no private document content in the live-lane artifacts.

## 4. Create the full pre-registration plan

Example:

```sh
npm run live-lane:plan -- \
  --edge-version 140.0 --edge-build 140.0.3485.54 \
  --chrome-version 140.0 --chrome-build 140.0.7339.81 \
  --chromium-version 140.0 --chromium-build 140.0.7339.0 \
  --firefox-version 142.0 --firefox-build 20260826000000 \
  --elatura-revision abc1234 \
  --firefox-intervention latest3-v1 \
  --chromium-intervention parking-v1 \
  --chromium-transport extension-only \
  --gdocs-manifest artifacts/live-application-lane/google-docs-fixtures/manifest.json \
  --out artifacts/live-application-lane/session-plan.json
```

Use `--chromium-transport extension-cdp` only when the selected managed intervention actually requires the CDP-attached transport. The output path must be new. The generator refuses to overwrite an existing plan.

The plan freezes the verified Google Docs generator identity, the raw generated-manifest SHA-256, document counts, total text code units, and per-document text code units. Every Google Docs run later echoes that frozen identity, and readiness rejects a mismatch.

Immediately verify the plan:

```sh
npm run live-lane:verify-plan -- \
  artifacts/live-application-lane/session-plan.json
```

Expected result:

```json
{
  "kind": "live-application-lane-plan-verification",
  "valid": true,
  "physicalRunCount": 112,
  "issues": []
}
```

Store the plan unchanged. Regenerating produces a new session UUID and timestamp; runs from the earlier session stay with the earlier plan. Stage-scoped readiness filters this one canonical plan; it never generates a convenient smaller replacement plan after results are visible.

## 5. Freeze benchmark lane pairing identities before each stage

Assign opaque local tokens before opening the compared browsers.

Examples:

```text
chatgpt-pathological-a lane 1 -> lane-cg-a-01
chatgpt-switch-8 lane 1       -> lane-cg-s-01
...
chatgpt-switch-8 lane 8       -> lane-cg-s-08
docs-large-text-v1 lane 1     -> lane-gd-a-01
docs-switch-8-v1 lane 1       -> lane-gd-s-01
...
docs-switch-8-v1 lane 8       -> lane-gd-s-08
```

These are content-free **benchmark pairing identities**. Do not derive them from a raw conversation/document URL, browser tab id, CDP target id, profile id, process id, title, or content hash. They exist so the same workload target can be matched across browser conditions; actual Elatura lane references and generations remain separate runtime identities when Elatura is present.

The same pairing token follows the same application target through every browser condition and every ephemeral browser projection in that stage. The readiness checker rejects pairing-token drift across compared runs.

## 6. Artifact layout

Keep the session plan and readiness outputs outside every final input directory.

```text
artifacts/live-application-lane/
  google-docs-fixtures/
    manifest.json
    docs-large-text-v1.txt
    docs-switch-8-v1-01.txt
    ...
    docs-switch-8-v1-08.txt
  session-plan.json
  stages/
    chatgpt-single/
      final/
      attempts-archive/
      readiness.json
    chatgpt-switch-8/
      final/
      attempts-archive/
      readiness.json
    gdocs-single/
      final/
      attempts-archive/
      readiness.json
    gdocs-switch-8/
      final/
      attempts-archive/
      readiness.json
  full-final/                 # optional; only after all four stages pass
  full-readiness.json         # optional
  attention/
```

The generated fixture directory stays outside every readiness input directory. It is source material whose identity is frozen into `session-plan.json`, not a final benchmark-result bundle.

Each stage `final/` contains exactly:

- one `live-application-lane-run` JSON for every planned physical subrun in that stage;
- one `live-application-lane-projection-ledger` JSON linked by `runId` for every physical subrun in that stage.

Stage sizes are therefore:

- `chatgpt-single`: 40 runs + 40 projection ledgers = 80 JSON files;
- each other resource stage: 24 + 24 = 48 JSON files.

Failed/superseded attempts live only in that stage's `attempts-archive/`.

The readiness checker accepts regular JSON files only, at most 256 files, at most 8 MiB per file, and at most 256 MiB total. Keep output files outside each scanned `final/` directory.

If all four stages eventually pass, copy the 224 accepted JSON artifacts into `full-final/` and run the full checker once. Do not use symlinks; the checker rejects them.

## 7. Execute one planned physical subrun

Use the next plan slot for the active stage only. Follow the stage protocol in the full runbook.

Before start:

- canonical dedicated profile restored;
- target browser and Elatura broker fully exited;
- machine identity and AC-power requirement satisfied;
- exact browser/build matches the plan;
- exact Elatura revision/intervention and Chromium transport match the plan;
- workload lane set matches the stage;
- for Google Docs, the run's fixture identity is copied from the plan-frozen #122 fixture record;
- no unrelated heavyweight workload runs on the measurement host;
- for the first physical subrun in the selected stage, the plan has already been generated; for every later adjacent subrun, at least `betweenPhysicalSubrunsMs` has elapsed since the previous run's `recordedAt`.

At the physical-run boundary, write canonical UTC `startedAt` immediately before starting the external sampler. This timestamp marks the beginning of the measured subrun; it is content-free and belongs in the run manifest.

During the run:

- external OS sampler emits a sample every 2 seconds;
- primary resource intervals run with browser DevTools closed unless the preregistered Chromium transport itself requires bounded CDP attachment;
- every switch/background return is recorded, including timeouts and reload/discard evidence;
- the prescribed neutral input action is used unchanged;
- no private content enters the run/projection JSON;
- no automatic application effect occurs.

After the primary sampler stops:

- collect optional DOM/runtime state with the prescribed method;
- perform the restart-recovery probe;
- write the run manifest;
- write the linked projection ledger;
- write canonical UTC `recordedAt` immediately after the physical subrun and its required recovery evidence are complete.

`recordedAt` is the conservative completion boundary for carryover control. The next adjacent planned run's `startedAt` must be at least the plan's `betweenPhysicalSubrunsMs` after this timestamp. Readiness rejects shorter gaps, a start at/before plan generation, or a `recordedAt` that does not follow its own `startedAt`.

## 8. Required switching evidence

For every ChatGPT `switch-8` physical subrun, the final switch ledger contains exactly:

- 16 warm-up activations: 2 rotations × 8 lanes;
- 96 recorded activations: 12 × 8;
- 8 long-background returns after the 300-second all-background interval.

Warm-up entries remain in the raw ledger and are excluded from the plateau calculation.

For every single-lane physical subrun, the final switch ledger contains exactly 10 `single-background-return` probes.

Google Docs consumes #122's exact deterministic fixtures while retaining this packet's shared cross-browser switching schedule: 2 warm-up rotations + 12 recorded rotations over the eight `docs-switch-8-v1` documents, followed by the same 300-second all-background return pass. This intentionally differs from #122's standalone four-warm-up/eight-recorded packet; #122 explicitly permits #125 to retain the shared cross-browser schedule when it consumes the exact fixture digest. Keep the #122 human editing/fidelity action recipe unchanged.

The readiness checker rejects missing counts and any Google Docs run whose generator, manifest digest, document count, total text code units, or per-document text code units differ from the frozen plan.

## 9. Projection ledger rules

Create one projection ledger per physical subrun. Three identities stay separate.

### Benchmark pairing identity

Every lane record carries:

- fixed opaque `benchmarkLaneToken`;
- lane ordinal;
- application class;
- opaque locator class only.

This identity exists only to match the same workload target across the six browser conditions. It has no application authority.

### Browser projection identity

Every lane record carries a numeric `browserProjectionGeneration` plus projection/freshness/recovery state. The projection generation increments when the current browser realization is reacquired after discard, crash, restart, or equivalent replacement. Raw tab, target, process, profile, and window identifiers never enter the shared artifact.

### Elatura application-lane identity

Stock conditions carry `elaturaLane: null` and `interventionLevel: stock`.

Firefox+Elatura and Chromium+Elatura carry the canonical application-lane identity separately:

```text
laneRef + laneGeneration + lane state
```

The readiness checker requires the same `laneRef` for the same stage/lane/Elatura browser condition across compared subruns and permits generation to advance as recovery/rebinding occurs. A browser projection id or benchmark pairing token is never substituted for the Elatura lane reference.

Canonical Elatura events record:

- lane ordinal and lane generation;
- event type from the merged application-lane vocabulary;
- confidence: `exact`, `probable`, or `unknown`;
- freshness: `fresh`, `stale`, or `unknown`;
- content-free source class;
- whether the event caused an inspection;
- `grantsWorkAuthority: false`;
- `authorizesWorkDispatch: false`.

Stock resource runs carry no Elatura events. A stale event or unknown-confidence event must not cause an inspection in the final comparison set. The readiness checker rejects that pairing and rejects any event claiming work or dispatch authority.

## 10. Stage order and machine-checked stop gates

Run stages in this order:

1. ChatGPT single-lane — 5 blocks;
2. ChatGPT switch-8 — 3 blocks;
3. attention-routing trial after the switch stage is interpretable;
4. Google Docs single-lane — 3 blocks;
5. Google Docs switch-8 — 3 blocks;
6. optional Google Docs attention trial;
7. optional mixed workload evidence.

After each resource stage, verify the unchanged 112-run plan again and run stage readiness against only that stage's final bundle.

Example for stage one:

```sh
npm run live-lane:verify-plan -- \
  artifacts/live-application-lane/session-plan.json

npm run live-lane:check -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/stages/chatgpt-single/final \
  --stage chatgpt-single \
  --out artifacts/live-application-lane/stages/chatgpt-single/readiness.json
```

Valid stage scopes are exactly:

```text
chatgpt-single
chatgpt-switch-8
gdocs-single
gdocs-switch-8
```

An invented subset is rejected. The checker reports both `fullPlannedRunCount: 112` and the selected `expectedRunCount`, so a stage receipt cannot masquerade as completion of the full plan.

A decisive negative at an earlier gate can stop later product investment. Preserve the completed negative evidence, its stage readiness receipt, and the unchanged full plan. Remaining later slots stay explicitly unexecuted. A completed stage remains usable evidence without being renamed a full-session result.

## 11. Attention-routing artifacts

The attention trial uses the fixed protocol from the full runbook:

- 8 lanes;
- producer permutation `2,5,1,7,4,8,3,6`;
- producer event spacing 90 seconds;
- stock round-robin inspection every 30 seconds;
- Elatura signal-first inspection with 300-second per-lane watchdog;
- missed-change threshold 120 seconds;
- read ladder: signal -> bounded read -> screenshot -> full activation.

Store these under `attention/`, never a resource-stage `final/` directory.

For each six-condition attention block use:

- `ES`, `CS`, `CRS`, `FS`: `round-robin` policy;
- `FE managed`, `CRE managed`: `signal-first` policy.

Keep the producer device/operator separate from the measurement host. Record actual producer event start/end times because provider propagation can drift from the 90-second schedule.

Report total inspections, useless inspections, false-positive wakeups, missed changes, false completions, bounded reads, screenshots, full activations, watchdog activations, signal-to-inspection latency, and change-to-useful-attention latency independently.

## 12. Optional full-session receipt

Only after all four resource stages already have `ready: true`, place copies of their accepted run/projection JSON into `full-final/` and run:

```sh
npm run live-lane:verify-plan -- \
  artifacts/live-application-lane/session-plan.json

npm run live-lane:check -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/full-final \
  --out artifacts/live-application-lane/full-readiness.json
```

With no `--stage`, `ready: true` means the bundle contains the complete canonical 112-subrun plan: exactly one run and linked projection ledger per slot, matching browser/Elatura/workload identities, machine-checked start/completion ordering and inter-run cooldowns, complete switching counts, sampler continuity, passing fidelity/recovery gates, stable benchmark pairing tokens, generation-bound Elatura lane identity where applicable, and clean privacy flags according to the checker.

A readiness failure stays visible as fixed issue codes. Repair the collection protocol or repeat the affected whole block under the runbook rules. Do not delete an inconvenient metric or edit the plan.

## 13. Analysis handoff

After the relevant stage is ready:

- preserve raw per-run values and resource time series;
- compute the predeclared paired deltas from the full runbook;
- report cold-process and steady-state separately;
- report passive Elatura overhead beside managed savings;
- label any memory plateau that depends on discard/reload as `plateau-with-discard`;
- keep recovery cost beside the resource result;
- keep DOM/runtime unsupported values as `null`;
- keep Firefox-vs-Chromium as a browser-family comparison because product and engine differ together;
- keep Edge/Chrome/Chromium differences as product/build differences within Blink/V8;
- keep ChatGPT and Google Docs effects separate before discussing cross-application transfer;
- keep PR #115's local-JSONL/`rg` negative result intact for the question it tested.

No composite score is produced anywhere in the packet.
