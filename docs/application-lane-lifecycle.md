# Application-lane residency policy

Status: first executable browser-resource policy for #116/#117  
Base protocol: `@elatura/core/application-lane` from #127

## Purpose

The consumer-facing application-lane protocol exposes durable lane identity, events, bounded observation, screenshot receipts, and activation. The lifecycle module adds one separate question:

> How available should this lane remain while it is outside full foreground interaction?

An external work system or human-facing controller chooses the requested posture. Elatura evaluates current application/browser fidelity and proposes the browser-resource action. Scheduling and work priority remain outside Elatura.

## Requested postures

- `responsive` — keep the lane loaded and runnable without requiring foreground focus. This is the initial **warm lane** primitive.
- `suspended` — keep a resident lane while permitting an earned browser freeze. A discarded lane is colder than this posture and must wake before it can satisfy the request.
- `reclaimable` — permit the page to be discarded when reload fidelity has been proven. Missing/discarded projections may remain cheap until a warmer request arrives.

These are desired availability postures. They do not replace current browser facts such as foreground, background, frozen, discarded, reloading, or missing.

## Eligibility

Freeze and discard eligibility are independent fixed facts supplied by the application/browser fidelity probe:

```text
allowed | blocked | unknown
```

Explanatory blocker classes are bounded and content-free, including active generation, unsaved interaction, save in progress, composition, modal interaction, collaboration, media/device use, downloads, unknown application state, and manual protection.

Unknown eligibility never authorizes an aggressive transition.

Attention events such as `changed` or `possible_completion` do not participate in lifecycle permission. They may cause a consumer to request a warmer posture; only current lifecycle eligibility permits freeze or discard.

## Planner actions

The pure planner can return:

```text
none
wake
freeze
discard
recover_projection
wait
attention_required
```

It performs no browser effects. Transport-specific Firefox/Chromium code executes a selected action through its own reviewed permissions, failure handling, and recovery path.

Every request and fact set is bound to the exact `laneRef + laneGeneration`. A stale consumer decision or stale browser projection cannot act on a newer lane generation.

The foreground lane is protected from freeze/discard. Drift, unavailable state, or recovery-needed state surfaces attention. A missing reclaimable lane remains cheap; a responsive/suspended request may recover its projection when recovery is available.

## Browser mapping

The first transport experiments should map native browser behavior before adding deeper intervention:

- Chromium: background, native frozen state where compatible, explicit/native discard, reload/recovery;
- Firefox: background plus discard/unload first;
- #95 slim residency only where native discard loses useful interaction state and measured whole-browser memory proves a resident middle mode valuable.

The capacity benchmark in #116 remains the judge: useful authenticated lanes versus whole-browser resident cost and recovery latency.
