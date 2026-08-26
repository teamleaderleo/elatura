# Application lane runtime

Tracking: #116  
Protocol: `@elatura/core/application-lane` from PR #127

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

The generation-7 response may still arrive after generation 8 becomes current. The runtime clears generation-7 pending ownership when the generation-8 descriptor is installed and refuses later generation-7 events/responses as stale.

Browser profile/session/tab/window/target/process identifiers never enter this runtime.

## Retained state

Per lane the runtime retains only:

- the current parsed `ApplicationLaneDescriptorV1`;
- one latest admitted `ApplicationLaneEventV1`;
- a bounded ring of recent event ids for duplicate suppression;
- pending request ids plus lane/generation/operation metadata.

The runtime does **not** retain:

- observation response content;
- screenshot bytes or image receipts after response delivery;
- activation receipts after response delivery;
- DOM nodes or selectors;
- browser-native handles;
- URLs;
- credentials, cookies, authorization material, or profile state;
- work/agent scheduling information.

Successful operation responses are returned to the caller and then leave runtime ownership. The caller/transport decides their shorter-lived consumption policy.

## Descriptor rules

A descriptor is parsed through the canonical PR #127 protocol parser before admission.

- a new `laneRef` consumes one bounded lane slot;
- lower generations are stale;
- a higher generation replaces the current volatile projection ownership;
- replacement clears pending requests, the last event, and recent event-id history;
- adapter identity/version and capabilities remain descriptor facts rather than runtime-owned identity policy;
- same-generation descriptors move forward by `observedAt`;
- contradictory same-generation descriptors at the same observation time are refused.

This lets a recovered lane adopt a newly selected adapter or capability set while generation ownership remains unambiguous.

## Event rules

Events are parsed through `parseApplicationLaneEventV1` and therefore keep the zero-work-authority contract from PR #127.

The runtime additionally requires:

- a known lane;
- the exact current lane generation;
- the `events` capability;
- an event time at least as current as the descriptor and last retained event;
- an event id outside the bounded recent-id ring.

Old-generation events increment a content-free stale-event counter and cannot change lane state.

## Request / response ownership

`beginRequest()` claims one bounded request before a transport dispatches it.

- `status` is always protocol-valid for a known current lane;
- `observe`, `activate`, and `screenshot` require their declared lane capability;
- request ids are unique while pending;
- global and per-lane pending counts are bounded.

`acceptResponse()` requires an exact pending tuple:

```text
requestId
laneRef
laneGeneration
operation
```

A generation replacement removes the tuple first, so a late response from the previous browser projection cannot regain ownership.

For successful `status` responses, the runtime also requires the nested descriptor to agree with the outer response on lane ref, generation, state, and observation time.

A correct same-generation response older than the latest descriptor completes its request but does not regress current descriptor state.

## Bounds and cleanup

Default bounds:

- 64 lanes;
- 256 pending requests globally;
- 16 pending requests per lane;
- 32 recent event ids per lane.

All limits are configurable downward/upward to a fixed safe ceiling of 4096.

`releaseLane()` and `clear()` drop pending ownership. Repeated generation replacement returns old pending state to zero rather than building a history store.

The snapshot exposes current bounded usage plus content-free counters for generation replacements, cleared pending requests, stale events/responses, and duplicate events/requests.

## Relationship to neighboring work

This runtime deliberately leaves other ownership intact:

- **PR #127 / `application-lane`** owns the consumer-facing protocol, authority flags, observation envelope, activation receipt, and screenshot receipt.
- **PR #124 / lane governor work** owns resource/discard/wake advice and human/agent lease policy.
- **PR #125** owns preregistered live-browser experiment design and result validation.
- **browser transports** own tab/target/process reconciliation and real browser effects.
- **Stensibly** owns work authority, scheduling, dispatch, wake routing, and continuation.

The runtime only decides which protocol generation currently owns volatile Elatura lane state.
