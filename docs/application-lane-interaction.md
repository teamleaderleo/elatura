# Application-lane interaction leases

Issue #138 defines a small generation-bound exclusion contract for future human/agent computer use over one authoritative application lane.

This contract is separate from application-lane residency planning. `@elatura/core/application-lane-lifecycle` decides browser-resource transitions from generation-bound fidelity facts. Interaction leases only coordinate who may attempt mutation/input on the current application-lane generation.

## Identity

Every operation consumes a canonical application-lane descriptor and is therefore bound to:

```text
laneRef + laneGeneration
```

A ledger remembers the highest generation it has accepted for each tracked lane reference. Seeing a newer generation invalidates any older-generation interaction lease. A later stale descriptor is refused and cannot roll the ledger back or delete the newer lease.

This remembered generation is an anti-replay fence. Generation records are never silently evicted to make room for another lane because that would allow a previously stale generation to become current again inside the same interaction session.

## Lease

A lease contains:

- exact lane reference and generation;
- bounded lease reference;
- owner: `human | agent`;
- issue and expiry times;
- `grantsWorkAuthority: false`;
- `authorizesWorkDispatch: false`.

The authority fields are invariant. A lease only coordinates application interaction. It does not choose work, grant provider rights, authorize submission, schedule agents, or change browser residency.

## Ownership rules

- passive observation requires no interaction lease;
- one tracked lane generation has at most one current mutation owner;
- same owner + same lease reference passed to `acquire` is intentional idempotent renewal in protocol v1;
- renewal preserves the original issue time, extends expiry from the supplied current time, and rejects a regressed clock;
- same owner + different lease reference conflicts;
- a human acquisition preempts an agent lease immediately;
- an agent cannot replace a current human lease;
- direct human activity revokes an agent lease immediately;
- direct human activity leaves an existing human lease intact;
- explicit revocation requires the current lease reference;
- expired leases are removed deterministically during valid ledger operations.

A later computer-use transport can require a current agent lease before keyboard, pointer, navigation, or submission effects while still applying its own provider/application authorization checks.

## Generation behavior

The ledger tracks a bounded number of lane references in addition to a separate active-lease bound.

When generation `N+1` is accepted for a lane reference:

1. the remembered generation advances;
2. any generation-`N` lease is removed;
3. the new generation begins with no inherited mutation owner unless the current valid operation acquires one.

A generation lower than the remembered generation returns `stale_generation` and performs no state change.

Requests must also match the exact descriptor supplied to `acquire`. A request with another lane reference, older generation, or future generation is refused before the ledger tracks or mutates that lane.

For a previously unseen lane, active-lease capacity is checked before its generation enters the anti-replay table. Repeated valid acquisitions denied only by `lease_capacity` therefore consume no tracked-lane capacity. Once capacity is available and the lane is actually admitted, its generation becomes remembered.

## Session lifetime

Generation memory is deliberately session-scoped.

`resetSession()` clears both leases and remembered generations. `clear()` is an alias for the same full reset. This is a canonical runtime/session boundary, not ordinary per-lane cleanup: resetting the generation table intentionally discards the stale-generation replay fence.

There is no automatic generation-record eviction in v1. A long-running owner that needs more tracked lane references than its configured bound must begin a new reviewed interaction session or a future exact retirement contract must define when replay history can safely disappear.

## Parser containment

Public request/lease/options inspection is descriptor-based and accessor-free.

- unknown fields are rejected;
- symbol decoration is rejected;
- accessors are rejected without invocation;
- `getPrototypeOf`, `ownKeys`, and `getOwnPropertyDescriptor` failures become fixed `inspection failed` errors;
- arbitrary text thrown from hostile Proxy traps is never surfaced;
- malformed acquisition requests are fully parsed before any generation tracking, expiry cleanup, or lease mutation.

That last ordering is deliberate: an invalid request cannot mutate the ledger merely by causing an expired lease to be cleaned up.

## Resource limits

Defaults are deliberately small and configurable within hard ceilings:

- 64 active leases;
- 256 tracked lane references;
- 15-minute maximum lease TTL.

The tracked-lane bound must be at least the active-lease bound. Active-lease and tracked-generation capacity are independent: a denied acquisition does not fill the generation table merely because active leases are full.

## Browser boundary

This module imports no browser API and contains no browser projection id, provider operation, credential, page content, scheduler, or residency decision.

The likely first consumer is a later Chromium/Firefox computer-use actuator. The zero-content Chromium projection host from #136 can remain unbound until an exact canonical lane generation is reconciled; once bound, interaction authority and lifecycle/resource authority remain separate checks.
