# Live application-lane execution checklist

This is the executor-facing entry point for the #116 / #117 / #118 experiment packet.

Read [`live-application-lane-benchmark.md`](live-application-lane-benchmark.md) before collecting data. The runbook defines the measurement semantics, workload fixtures, plateau rule, attention trial, fidelity gates, and claim boundaries. This checklist defines the exact handoff sequence and artifact layout.

## Packet files

- `docs/live-application-lane-benchmark.md` — full method and analysis contract.
- `benchmarks/schema/live-application-lane-plan-v1.schema.json` — pre-registered resource-session plan.
- `benchmarks/schema/live-application-lane-run-v1.schema.json` — one physical resource/attention subrun.
- `benchmarks/schema/live-application-lane-projection-v1.schema.json` — logical-lane versus browser-projection identity plus signal confidence/freshness.
- `scripts/create-live-application-lane-plan.mjs` — canonical resource-plan generator.
- `scripts/verify-live-application-lane-plan.mjs` — rejects a rewritten plan.
- `scripts/check-live-application-lane-session.mjs` — final resource-session readiness gate.

The generated resource plan contains exactly 112 physical subruns:

- ChatGPT single-lane: 5 blocks × 8 physical subruns = 40;
- ChatGPT 8-lane switching: 3 × 8 = 24;
- Google Docs single-lane: 3 × 8 = 24;
- Google Docs 8-lane switching: 3 × 8 = 24.

Each block has four stock physical subruns and two Elatura conditions with passive + managed subruns. The Elatura subrun order alternates by block.

The attention-routing trial remains a separate later gate because it intentionally compares different inspection policies. Keep its artifacts outside the 112-run resource-session `final/` directory.

## 1. Prepare the repository once

```sh
npm ci --ignore-scripts
npm run check
```

Use the exact repository/Elatura revision that will remain frozen through the session.

## 2. Freeze browser identities

Record before creating the plan:

- Edge version and build token;
- Chrome version and build token;
- Chromium version and build token;
- Firefox version and build token;
- Elatura revision token;
- Firefox managed-intervention token;
- Chromium managed-intervention token.

A token is a content-free bounded identifier. Use the actual installed build/version identity; avoid labels such as `latest`.

## 3. Create the plan

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
  --out artifacts/live-application-lane/session-plan.json
```

The output path must be new. The generator refuses to overwrite an existing plan.

Immediately verify it:

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

Store the plan unchanged. Regenerating produces a new session UUID and timestamp; runs from the earlier session stay with the earlier plan.

## 4. Freeze logical lane identities before each stage

Assign opaque local tokens before opening the compared browsers.

Examples:

```text
chatgpt-pathological-a lane 1 -> lane-cg-a-01
chatgpt-switch-8 lane 1       -> lane-cg-s-01
...
chatgpt-switch-8 lane 8       -> lane-cg-s-08
gdocs-single lane 1           -> lane-gd-a-01
gdocs-switch-8 lane 1         -> lane-gd-s-01
...
gdocs-switch-8 lane 8         -> lane-gd-s-08
```

These are Elatura-local benchmark identities. Do not derive them from a raw conversation/document URL, browser tab id, CDP target id, profile id, process id, title, or content hash.

The same logical lane token follows the same application target through every browser condition and every ephemeral browser projection in that stage. The readiness checker rejects token drift across compared runs.

## 5. Artifact layout

Keep the session plan and readiness output outside the final input directory.

```text
artifacts/live-application-lane/
  session-plan.json
  final/
    001__chatgpt-single__b01__ES__none.run.json
    001__chatgpt-single__b01__ES__none.projection.json
    ...
  attempts-archive/
  attention/
  readiness.json
```

`final/` contains exactly:

- one `live-application-lane-run` JSON for every planned physical subrun;
- one `live-application-lane-projection-ledger` JSON linked by `runId` for every physical subrun.

The full resource session therefore has 224 final JSON files. Failed/superseded attempts live in `attempts-archive/`.

The readiness checker accepts regular JSON files only, at most 256 files, at most 8 MiB per file, and at most 256 MiB total. Keep output files outside `final/`.

## 6. Execute one planned physical subrun

Use the next plan slot only. Follow the stage protocol in the full runbook.

Before start:

- canonical dedicated profile restored;
- target browser and Elatura broker fully exited;
- machine identity and AC-power requirement satisfied;
- exact browser/build matches the plan;
- exact Elatura revision/intervention matches the plan;
- workload lane set matches the stage;
- no unrelated heavyweight workload runs on the measurement host.

During the run:

- external OS sampler emits a sample every 2 seconds;
- primary resource intervals run with browser DevTools closed;
- every switch/background return is recorded, including timeouts and reload/discard evidence;
- the prescribed neutral input action is used unchanged;
- no private content enters the run/projection JSON;
- no automatic application effect occurs.

After the primary sampler stops:

- collect optional DOM/runtime state with the prescribed method;
- perform the restart-recovery probe;
- write the run manifest;
- write the linked projection ledger;
- write `recordedAt` immediately at completion.

Then wait the plan's 60-second between-subrun interval before the next physical subrun.

## 7. Required switching evidence

For every `switch-8` physical subrun, the final switch ledger contains exactly:

- 16 warm-up activations: 2 rotations × 8 lanes;
- 96 recorded activations: 12 × 8;
- 8 long-background returns after the 300-second all-background interval.

Warm-up entries remain in the raw ledger and are excluded from the plateau calculation.

For every `single-lane` physical subrun, the final switch ledger contains exactly 10 `single-background-return` probes.

The readiness checker rejects missing counts.

## 8. Projection ledger rules

Create one projection ledger per physical subrun.

For every logical lane record:

- fixed opaque logical lane token;
- lane ordinal;
- application class;
- opaque locator class only;
- projection generation number;
- projection state;
- freshness;
- recovery state;
- intervention level.

Projection generation increments when the current browser realization is reacquired after discard, crash, restart, or equivalent replacement. Raw browser projection identifiers never enter the shared artifact.

Every emitted signal records:

- signal class;
- confidence class;
- freshness class;
- source class;
- whether it caused an inspection.

A stale or unknown-confidence signal must not cause an inspection in the final comparison set. The readiness checker rejects that pairing.

## 9. Stage order and stop gates

Run stages in this order:

1. ChatGPT single-lane — 5 blocks;
2. ChatGPT switch-8 — 3 blocks;
3. attention-routing trial after the switch stage is interpretable;
4. Google Docs single-lane — 3 blocks;
5. Google Docs switch-8 — 3 blocks;
6. optional Google Docs attention trial;
7. optional mixed workload evidence.

A decisive negative at an earlier gate can stop later product investment. Preserve the completed negative evidence and the plan. The remaining unexecuted slots are simply unexecuted; they never become a partial “win.”

For a claim about the full planned resource session, all 112 slots and 112 projection ledgers must pass readiness.

## 10. Attention-routing artifacts

The attention trial uses the fixed protocol from the full runbook:

- 8 lanes;
- producer permutation `2,5,1,7,4,8,3,6`;
- producer event spacing 90 seconds;
- stock round-robin inspection every 30 seconds;
- Elatura signal-first inspection with 300-second per-lane watchdog;
- missed-change threshold 120 seconds;
- read ladder: signal -> bounded read -> screenshot -> full activation.

Store these under `attention/`, never `final/`.

For each six-condition attention block use:

- `ES`, `CS`, `CRS`, `FS`: `round-robin` policy;
- `FE managed`, `CRE managed`: `signal-first` policy.

Keep the producer device/operator separate from the measurement host. Record actual producer event start/end times because provider propagation can drift from the 90-second schedule.

Report total inspections, useless inspections, false-positive wakeups, missed changes, false completions, bounded reads, screenshots, full activations, watchdog activations, signal-to-inspection latency, and change-to-useful-attention latency independently.

## 11. Preflight the final resource session

Run plan verification again before readiness:

```sh
npm run live-lane:verify-plan -- \
  artifacts/live-application-lane/session-plan.json
```

Then check the final bundle:

```sh
npm run live-lane:check -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/final \
  --out artifacts/live-application-lane/readiness.json
```

`ready: true` means the final bundle contains the complete canonical plan, exactly one run and linked projection ledger per slot, matching browser/Elatura/workload identities, monotonic completion order, complete switching counts, sampler continuity, passing fidelity/recovery gates, stable logical-lane tokens, and clean privacy flags according to the checker.

A readiness failure stays visible as fixed issue codes. Repair the collection protocol or repeat the affected whole block under the runbook rules. Do not delete an inconvenient metric or edit the plan.

## 12. Analysis handoff

Only after the relevant stage is complete:

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
