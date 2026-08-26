# ChatGPT application-lane activity sentinel

Status: v1 current-state transition-safety contract  
Continuity prerequisite: `@elatura/adapter-chatgpt/lane-witness`  
Canonical lifecycle policy: `@elatura/core/application-lane-lifecycle`  
Benchmark gate: #116

## Purpose

The ChatGPT continuity witness can verify that a recovered application graph still belongs to the same exact lane generation. Transition safety requires a second, fresher fact:

> what transient ChatGPT activity exists right now that should block suspension or reclamation?

`@elatura/adapter-chatgpt/lane-activity` defines the content-free observation and assessment contract for that question.

This packet defines admission and lifecycle interpretation only. A physical live producer must be separately reviewed before it can claim `source: "reviewed-live-sentinel"`.

## Observation contract

One observation is bound to exact `laneRef + laneGeneration` and contains only fixed activity tokens:

- observation time;
- confidence: `exact | probable | unknown`;
- generation: `active | inactive | unknown`;
- composer: `clean | dirty | unknown`;
- composition/IME: `active | inactive | unknown`;
- modal interaction: `active | inactive | unknown`;
- media/device activity: `active | inactive | unknown`;
- download activity: `active | inactive | unknown`;
- other transient application state: `active | inactive | unknown`;
- zero work and dispatch authority.

The record carries no transcript text, prompt text, generated answer, title, URL, account identity, DOM selector, browser handle, cookie, request body, or credential.

The parser accepts exact own data properties only. Accessors and decorated records are rejected before application state can influence lifecycle permission.

## Freshness

The default maximum observation age is 5 seconds. The configurable ceiling is 60 seconds.

A stale observation yields unknown lifecycle eligibility. A future-dated observation also yields unknown eligibility. The caller must obtain a fresh current-state sample before relying on the sentinel again.

## Blocker mapping

Current activity maps into the canonical application-lane blocker vocabulary:

| ChatGPT activity | Canonical blocker |
| --- | --- |
| generation active | `active_generation` |
| dirty composer | `unsaved_interaction` |
| IME/composition active | `composition_active` |
| modal interaction active | `modal_interaction` |
| media/device active | `media_or_device_active` |
| download active | `download_active` |
| other transient active | `application_unknown` |

Any active blocker sets both freeze and discard eligibility to `blocked` for the observation.

Probable confidence or any unknown activity dimension yields `application_unknown` with both eligibilities `unknown`.

## V1 permission ceiling

After conversation continuity is already verified, one **exact, fresh, fully idle** observation may emit:

```text
recovery = verified
freezeEligibility = allowed
discardEligibility = unknown
blockers = []
```

This earns only the resident-suspension side of the lifecycle contract.

V1 never upgrades ChatGPT destructive discard eligibility to `allowed`.

A quiet current UI plus graph continuity still leaves questions about reload fidelity and transient application behavior after a true page discard. Reclamation permission therefore stays closed until physical evidence and a separately reviewed contract earn it.

## Why freeze can advance first

The canonical lifecycle model separates `suspended` from `reclaimable`.

A resident freeze preserves the page/process realization and is the safer next experiment once the application is current, verified, and idle. Destructive discard crosses a stronger recovery boundary and deserves its own evidence.

Chromium's current ordinary extension host has no reviewed force-freeze actuator. The sentinel can still establish truthful freeze eligibility for browser families/transports that expose an earned resident-suspension mechanism, and it gives #116 a stable application-fidelity signal for evaluating whether such a mechanism is worth adding.

## Relationship to attention/completion events

Completion hints, `changed`, or `possible_completion` events may justify inspection or a warmer residency request. They never grant transition safety.

The activity sentinel answers a different question: whether current application state permits a lifecycle transition at the time the transition is being planned.

## Producer boundary

A future live producer should emit only the fixed observation fields above and should keep application-specific detection local to the reviewed adapter/transport seam.

Before promotion, the producer should demonstrate:

- exact lane-generation binding;
- deterministic mapping of active/idle/unknown states;
- freshness enforcement;
- no text/content leakage;
- fail-closed behavior under application drift;
- stable behavior across foreground/background and Keep warm recovery;
- zero work/dispatch authority.

The producer should remain separate from the Chromium projection service worker unless measured evidence justifies page-access capability there.

## Next gate

The next useful step is physical dogfood against the frozen #116 protocol: collect content-free activity observations during ChatGPT generation, composer edits, idle background residency, Keep warm reload, and recovery.

Only after those observations demonstrate reliable current-state classification should Elatura consider a reclaim-fidelity packet or a deeper browser intervention.
