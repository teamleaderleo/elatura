# Live application-lane operator progress helper

`live-lane:next` is a content-free operator convenience for the frozen #116 benchmark packet.

It answers one narrow question during physical collection:

> Which preregistered physical subrun comes next, and has the required cooldown elapsed?

It does **not** replace `live-lane:check`. Stage/full readiness remains the evidence authority.

## Usage

```sh
npm run live-lane:next -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/stages/chatgpt-single/final \
  --stage chatgpt-single
```

For deterministic testing or an external operator clock, `--now` accepts one canonical UTC timestamp:

```sh
npm run live-lane:next -- \
  artifacts/live-application-lane/session-plan.json \
  artifacts/live-application-lane/stages/chatgpt-single/final \
  --stage chatgpt-single \
  --now 2026-08-27T01:00:00.000Z
```

Valid stages are exactly:

- `chatgpt-single`
- `chatgpt-switch-8`
- `gdocs-single`
- `gdocs-switch-8`

## Output

The command emits one JSON object with:

- selected stage;
- `authority: "progress-only"`;
- expected/completed/remaining physical-subrun counts;
- state: `ready`, `cooldown`, or `complete`;
- the next exact plan slot when one remains;
- browser product/version/build from the frozen plan;
- Elatura passive/managed mode, transport, revision, and intervention token where applicable;
- workload token/pattern/lane count;
- preregistered cooldown duration, eligibility timestamp, and remaining milliseconds.

It never needs a browser tab id, profile id, target id, URL, title, application content, credential, or private document/conversation identifier.

## What counts as completed progress

A slot is counted only when the selected `final/` directory contains:

1. one strict-schema-valid `live-application-lane-run` for the exact planned slot;
2. one strict-schema-valid `live-application-lane-projection-ledger` for that run id;
3. the expected frozen browser/condition/Elatura mode and workload identity;
4. a projection lane count/application class compatible with that plan slot.

The helper refuses:

- malformed JSON or schema-invalid artifacts;
- duplicate run slots or run ids;
- duplicate projection ledgers;
- run/projection pairs missing one side;
- artifacts from an unexpected plan slot;
- plan/condition/workload mismatches;
- a later completed slot appearing after an earlier missing planned slot.

This keeps the operator from accidentally skipping ahead because a file happened to exist.

## Cooldown behavior

When the next slot has an immediately preceding completed slot, `live-lane:next` computes:

```text
eligibleAt = previous recordedAt + plan.protocol.betweenPhysicalSubrunsMs
```

Before `eligibleAt`, state is `cooldown` and `remainingMs` is positive. At or after the boundary, state is `ready`.

The final timing admission still rechecks canonical `startedAt` / `recordedAt` ordering and the full preregistered cooldown. The helper is guidance, not a waiver.

## Recommended loop

```text
live-lane:verify-plan
  -> live-lane:next
  -> execute exactly that physical subrun
  -> write run + projection pair to the stage final directory
  -> live-lane:next
  -> repeat
  -> live-lane:check when the stage is complete
```

Failed/superseded attempts remain in `attempts-archive/`, outside the `final/` directory, exactly as the frozen execution checklist requires.

The helper does not open browsers, mutate application state, run lifecycle effects, capture private content, or authorize work/dispatch.
