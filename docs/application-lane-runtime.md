# Application lane runtime

Tracking: #116  
Protocol: `@elatura/core/application-lane` from #127  
Client reply fence: `@elatura/core/application-lane-client` from #134

`ApplicationLaneRuntimeV1` is the bounded in-memory ownership layer between the consumer-neutral application-lane protocol and browser/application transports.

Its job is narrow:

> once a logical lane moves to a newer generation, old browser-projection events and operation replies can no longer repopulate current lane state.

## Why generation ownership exists

A logical lane can survive projection churn:

```text
laneRef = elatura:lane:chat-a

generation 7
  browser projection A
  observe request A1 in flight
        ↓
  projection disappears / browser restarts
        ↓
generation 8
  browser projection B
```

The generation-7 reply may still arrive after generation 8 becomes current. The runtime clears generation-7 pending ownership when the generation-8 descriptor is installed and refuses later generation-7 events/replies as stale.

Browser profile/session/tab/window/target/process identifiers never enter this runtime.

## Retained state

Per lane the runtime retains only:

- the current parsed `ApplicationLaneDescriptorV1`;
- one latest admitted `ApplicationLaneEventV1`;
- a bounded ring of recent event ids for duplicate suppression;
- bounded parsed requests while they are pending.

The runtime retains zero completed observation content, screenshot bytes, activation receipts, DOM nodes/selectors, browser-native handles, URLs, credentials, project memory, or work scheduling state.

## Descriptor rules

A descriptor enters through the canonical #127 parser.

- a new `laneRef` consumes one bounded lane slot;
- lower generations are stale;
- a higher generation replaces current volatile ownership;
- replacement clears pending requests, the last event, and recent event-id history;
- adapter identity/version and capabilities remain descriptor facts rather than runtime-owned identity policy;
- same-generation descriptors advance by `observedAt`;
- contradictory same-generation facts at the same observation time are refused.

A recovered lane can therefore adopt a newly selected adapter or capability set while generation ownership remains unambiguous.

## Event rules

Events keep the zero-work-authority fence from #127. The runtime additionally requires a known lane, the exact current generation, the `events` capability, monotonic observation time, and an event id outside the bounded recent-id ring.

Old-generation events increment a content-free stale-event counter and cannot change current state.

## Request / reply ownership

`beginRequest()` retains the canonical parsed request until completion or cancellation. Global and per-lane pending counts are bounded.

`acceptResponse()` first checks the response lane generation against current runtime ownership. For current-generation replies it delegates exact request binding and observation-budget remeasurement to #134's `matchApplicationLaneResponseV1`.

That gives the stack two independent fences:

```text
runtime generation ownership
        ↓
#134 exact request/lane/generation/operation binding
        ↓
#134 observation-budget remeasurement
        ↓
status semantic coherence / monotonic state update
```

Identity/operation mismatches leave the pending request available for a later correct reply. An observation that exceeds the caller's requested budget is consumed and refused as `response-budget-exceeded`; its body never becomes runtime state.

For successful `status` replies, the runtime additionally requires the nested descriptor to agree with the outer response on lane ref, generation, state, and observation time.

A correct but older same-generation reply completes its request without regressing current state. Contradictory equal-time state is refused.

`cancelRequest()` drops pending ownership explicitly for timeout/cancellation paths. A later reply for that request becomes `unknown-request`.

## Bounds and cleanup

Default bounds:

- 64 lanes;
- 256 pending requests globally;
- 16 pending requests per lane;
- 32 recent event ids per lane.

All configurable limits have a fixed ceiling of 4096.

`releaseLane()`, `clear()`, and generation replacement remove pending ownership. A 100-generation churn test requires old pending state to return to zero each cycle.

Snapshots expose current bounded usage plus content-free counters for generation replacements, cleared pending requests, stale events/replies, duplicate events/requests, and rejected observation budgets.

## Relationship to neighboring work

This runtime leaves neighboring ownership intact:

- **#127 / `application-lane`** — consumer-facing protocol and authority-free operations/events.
- **#134 / `application-lane-client`** — exact request/reply correlation and caller observation-budget enforcement.
- **#132 / `application-lane-lifecycle`** — requested residency posture and generation-bound browser-resource planning.
- **#136 / Chromium projection host** — ephemeral browser projection handles and explicit operator browser actions.
- **#139 / Chromium Keep warm** — browser auto-discard protection/background reload as an explicit operator action.
- **#124** — separate lane-governor/discard/lease experiment.
- **#125** — preregistered live-browser experiment design and result validation.
- **browser transports** — native projection reconciliation and real browser effects.
- **Stensibly** — work authority, scheduling, dispatch, wake routing, and continuation.

The runtime only decides which protocol generation currently owns volatile Elatura lane state.
