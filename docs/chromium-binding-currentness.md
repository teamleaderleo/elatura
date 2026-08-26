# Chromium binding currentness

Status: pure volatile authority packet  
Tracking: #145  
Pure binding planner: #144  
Browser-local effect executor: #147  
Canonical lane identity/runtime: #127 / #142  
Residency policy: #132

## Purpose

`ChromiumLaneBindingV1` from #144 is an immutable value that proves one exact lane generation matched one Chromium projection when the value was created. Browser resource effects need one additional local fact: whether that binding is still the current binding after lane generations and browser projections change.

`ChromiumBindingRuntime` owns only that currentness fact.

It does not create another residency planner. It reuses #144 `createChromiumLaneBindingV1()` and `planBoundChromiumResidencyV1()`. #147 remains the browser-local executor that re-fetches the projection and applies a correlation-bound `keep_warm` or `discard` request.

## Volatile authority

The runtime keeps, in memory:

```text
laneRef
  -> highest generation seen in this worker lifetime
  -> current ChromiumLaneBindingV1 or unbound tombstone
```

Projection refs are also one-to-one with lane refs while bound.

The default maximum is 64 tracked lane refs, with a hard implementation ceiling of 256. Capacity refusal is explicit; generation history is never silently evicted.

MV3 worker/runtime restart clears this state. Managed planning then fails with `binding-missing` until explicit local rebind. The first packet therefore gains zero storage permission and makes zero browser-restart recovery claim.

## Generation rules

- a descriptor older than the highest generation retained for that lane is stale;
- seeing a higher generation immediately removes the older projection binding;
- a higher generation remains retained even when its replacement projection collides or is absent;
- observing an unbound lane still records its highest generation as an unbound tombstone;
- same-generation projection replacement requires the exact old projection ref;
- generation change through the replacement API intentionally leaves the lane unbound; the new generation must use a fresh explicit bind.

An immutable historical binding object can remain in another caller's memory, but `planCurrent()` never accepts binding objects from callers. It resolves the runtime's retained current binding internally before invoking #144.

## Current-plan and effect path

The managed path becomes:

```text
current canonical lane descriptor
        +
current fresh Chromium projection
        +
generation-bound residency request
        +
application fidelity facts
        ↓
ChromiumBindingRuntime currentness check
        ↓
#144 planBoundChromiumResidencyV1
        ↓
generation-bound content-free plan
        ↓
#147 browser-local effect request
        ↓
fresh service-worker projection revalidation/preflight
        ↓
physical Keep warm / discard
        ↓
correlation-bound browser receipt
```

The currentness runtime itself performs zero browser mutation. #147 still re-reads the target tab immediately before acting.

## Authority boundary

Every runtime receipt pins:

```text
grantsWorkAuthority: false
authorizesWorkDispatch: false
```

The runtime does not decide mission, work selection, requested residency posture, or application/provider authority. It only prevents stale browser bindings from becoming resource-effect authority.

## Capability boundary

The repository Chromium gate scans `binding-runtime.ts` and requires:

- reuse of `planBoundChromiumResidencyV1()`;
- explicit generation-advance tombstones;
- one-to-one projection ownership;
- zero work/dispatch authority;
- zero `chrome.*` calls;
- zero local/session/IndexedDB persistence;
- the existing extension-wide network, logging, sensitive-tab-field, and dynamic-code prohibitions.
