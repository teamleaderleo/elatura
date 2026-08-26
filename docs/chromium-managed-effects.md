# Chromium managed residency effects

Status: pure volatile transaction packet  
Tracking: #152  
Current binding authority: #145 / PR #148  
Pure binding/residency planner: #144 / #132  
Browser-local effect executor: #147

## Purpose

A browser-local effect receipt can prove that Chromium applied or refused one exact `requestRef + projectionRef + tabId + effect`. Managed application-lane evidence needs one additional fact: the effect request was issued while the same durable lane generation and browser projection were current, and that currentness still held when the receipt was admitted.

`ChromiumManagedEffectRuntime` owns that in-flight correlation window.

It performs no browser action and creates no second residency planner. It composes:

1. #148 `ChromiumBindingRuntime.planCurrent()`;
2. #144's generation-bound plan retained inside that result;
3. #147 `createChromiumEffectRequestV1()`;
4. #147 receipt parsing/matching;
5. #148 current binding revalidation before receipt admission.

## Pending record

One issued managed effect retains only bounded content-free state:

```text
laneRef + laneGeneration
projectionRef + tabId
BoundChromiumResidencyPlanV1
ChromiumEffectRequestV1
```

At most one managed residency effect may be pending for one lane. The default global pending limit is 64, with a hard ceiling of 256.

The browser service worker still receives only #147's browser-local request. Durable lane identity remains outside that boundary.

## Begin

`begin()` first validates the canonical descriptor and bounded request reference. It then calls the current-binding runtime.

A request is issued only when:

- the supplied descriptor/projection is the retained current binding;
- #144 returns a matched generation-bound plan;
- the plan has one currently executable browser-local effect (`keep_warm` or `discard`);
- the lane has no other current effect in flight;
- global pending and request-reference history bounds admit the operation.

A stale pending effect from an older projection is removed only after `planCurrent()` proves the new descriptor/projection is current. A stale caller therefore cannot cancel a valid current pending operation.

## Request-reference anti-replay

Issued `requestRef` values stay claimed for the lifetime of the runtime even after receipt admission, cancellation, or `clear()`.

This is deliberate. Reusing a completed request reference could make a late old browser receipt indistinguishable from a later request with the same projection and effect.

The default claimed-reference limit is 4,096 with a hard ceiling of 65,536. When that session-local anti-replay table is full, new effects are refused explicitly. A fresh runtime session should use fresh correlation references.

`clear()` cancels pending operations but keeps claimed references inside the same runtime object.

## Receipt admission

`acceptReceipt()` parses the browser-local receipt before touching pending state.

A malformed or request-mismatched receipt therefore leaves the legitimate pending operation intact.

For an exact request match, admission then requires:

1. the supplied canonical descriptor names the pending lane;
2. it is not older than the pending generation;
3. #148 still recognizes that exact generation as current;
4. the current binding still points to the pending projection and tab.

A newer generation makes the pending operation stale even if browser execution already happened. A same-generation projection replacement does the same.

The browser receipt remains truthful browser evidence, but it loses authority as evidence for the old managed lane generation.

## Browser outcomes

After exact current correlation, all #147 outcomes remain meaningful as browser outcomes:

- `applied`;
- `refused`;
- `stale_projection`;
- `browser_error`.

The transaction runtime does not reinterpret a browser refusal/error as success and does not infer application readiness from a successful Keep warm reload request.

## Cleanup

- `cancel(requestRef)` removes one pending effect;
- `clear()` removes all pending effects;
- stale pending state is removed when a later current plan proves the lane's projection changed;
- claimed request references remain reserved for the runtime lifetime.

No timer or background cleanup loop exists in v1. Bounded pending count, one-per-lane ownership, explicit cancellation, and currentness checks keep the state finite and deterministic.

## Authority boundary

Every public transaction result pins:

```text
grantsWorkAuthority: false
authorizesWorkDispatch: false
```

An accepted receipt proves browser execution for one exact currently bound application-lane generation. It grants no provider/application authority, work selection, mission completion, scheduling, dispatch, or interaction lease.

## Capability boundary

The Chromium repository gate requires this module to reuse the #148/#147 seams and rejects:

- browser API calls;
- network clients;
- sensitive tab fields;
- dynamic code;
- content logging;
- local/session/IndexedDB persistence.

The module adds no extension permission and no service-worker identity surface.
