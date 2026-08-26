# Application-lane runtime contract

Status: first executable contract for `docs/application-lanes.md`  
Primary experiment: #116  
Browser comparison: #117  
Human-first fidelity workload: #118

## Purpose

`packages/core/src/application-lanes.ts` turns the application-lane product model into a small pure contract that browser transports and external consumers can share without moving scheduling authority into Elatura.

The module performs no browser effects. It accepts content-minimized current facts plus an explicit consumer request and returns a proposed next browser or observation action. Firefox/Chromium transports remain responsible for executing effects through their own reviewed permission, authorization, failure, and recovery paths.

## Separate axes

A lane snapshot keeps these facts independent:

- logical `laneKey` and `generation`;
- current browser projection residency and recovery state;
- current content-free attention signal and confidence;
- current intervention level;
- application-specific freeze/discard eligibility and fixed blocker classes.

A completion/change signal never grants lifecycle permission. The application/browser fidelity probe supplies freeze/discard eligibility separately.

Generation-bound lifecycle requests prevent an old consumer decision from acting on a newer browser projection.

## Residency intent

Consumers may request one of four resource postures:

- `interactive` — foreground genuine-application interaction is wanted;
- `responsive` — keep the lane loaded and runnable without requiring focus; this is the initial warm-lane primitive;
- `suspended` — a resident browser freeze is acceptable when the workload explicitly admits it;
- `reclaimable` — browser discard is acceptable when reload fidelity has been proven.

These are requested postures, not permanent product states. Current browser residency is reported separately as foreground/background/frozen/discarded/reloading/missing.

The planner never freezes or discards the current foreground lane. If discard is unavailable or blocked while a background lane explicitly admits freeze, `reclaimable` may fall back to freeze. Unknown eligibility produces no aggressive transition.

A missing projection stays cheap while the consumer still requests `reclaimable`. A warmer request can propose projection recovery when the current lane is marked recoverable.

## Observation ladder

The observation planner implements the existing escalation order:

```text
signal
  -> bounded-view
  -> screenshot
  -> activation
```

A fresh bounded view wins before pixels. A stale bounded view is returned only when the consumer explicitly admits stale state. If semantic state is unavailable, the planner may escalate to a screenshot for a resident page and then to genuine application activation.

Recovery/drift failures return `attention-required`; the planner never manufactures semantic state to satisfy an observation request.

## Contract boundary

Snapshots admit fixed enums, bounded opaque tokens, safe integers, and at most 16 fixed lifecycle blocker tokens. Unknown fields are rejected, so transcript text, URLs, cookies, credentials, browser-storage payloads, screenshots, free-form notes, and application bodies have no field in this contract.

The module owns no:

- work priority or scheduling;
- agent dispatch or continuation;
- provider request submission;
- browser navigation authority;
- credential/session export;
- persistent lane database;
- automatic browser action.

Stensibly or a human-facing controller can request a posture or observation rung. Elatura can propose the browser/application operation justified by current local facts.

## Next transport work

Keep browser integration evidence-gated:

1. #116 consumes the contract in a content-free lane-capacity experiment.
2. #117 maps Chromium tab lifecycle observations and explicit lifecycle effects into this contract without a permanent CDP attachment.
3. Firefox maps its discard/unload support first; #95 slim residency remains a separately measured middle intervention.
4. #118 supplies Google Docs freeze/discard eligibility evidence for saved, editing, collaboration, and offline cases.

Do not add app-specific lifecycle blockers or transport capabilities until a workload demonstrates that the fixed current vocabulary cannot express a real decision.
