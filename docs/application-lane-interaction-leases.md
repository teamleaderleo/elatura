# Application-lane interaction leases

Status: pure coordination contract  
Tracking: #138  
Canonical lane identity: #127  
Residency planning: #132

## Purpose

Elatura can manage one genuine authenticated application lane for both a human and a computer-using agent. Once browser input is added, those two consumers need a small local exclusion rule so they cannot type, click, navigate, or submit through the same lane concurrently.

The interaction lease is that rule.

It coordinates **temporary mutation/input ownership for one exact `laneRef + laneGeneration`**. It carries no browser handle, provider operation, mission, task, hierarchy, scheduling decision, account capability, or reusable credential.

Passive observation requires no lease.

## Authority boundary

Every admitted lease and every result carries:

```text
grantsWorkAuthority: false
authorizesWorkDispatch: false
```

A lease means only that an Elatura interaction host may treat one local human or agent as the current mutation owner for that exact lane generation. The later actuator still needs its own reviewed operation/application authority.

Stensibly remains the owner of work selection, mission, dispatch, hierarchy, and continuation.

## Exact-generation target

The lease ledger does not keep a second durable lane-generation registry. Its caller supplies the current canonical target on every operation:

```ts
{
  version: 1,
  laneRef,
  laneGeneration
}
```

The target should come from the current #127 application-lane descriptor/runtime.

A stored lease from a lower generation is cleared when a valid current-generation operation arrives. A target older than a stored lease is refused as stale. Requests older/newer than the supplied current target are refused before the ledger mutates anything.

Generation replacement therefore never transfers an old mutation lease automatically. The new generation requires a fresh acquisition.

## Lease semantics

One lane has at most one active mutation owner.

- `acquire` creates a new lease when the lane is free;
- human acquisition immediately preempts an agent lease;
- agent acquisition cannot replace a human lease;
- same-owner/same-reference acquisition returns `renew-required` so renewal stays explicit;
- `renew` requires exact lane generation, lease reference, and owner;
- `revoke` requires exact current lane generation and lease reference;
- direct `humanActivity` immediately removes an agent lease and retains a human lease;
- expired leases are removed deterministically during valid operations;
- `clear` drops all volatile interaction ownership.

The default cap is 64 active leases and the default maximum TTL is 15 minutes. Both are bounded configuration values for the local coordination layer, not product timing claims.

## Parser and mutation safety

Public record parsers inspect only own data descriptors and exact allowlisted keys. Accessors are rejected without invocation. `getPrototypeOf`, `ownKeys`, and `getOwnPropertyDescriptor` Proxy failures collapse to fixed parser errors so trap text cannot escape.

Operation ordering is deliberate:

1. parse the current target;
2. parse the request/revoke record;
3. parse current time;
4. compare lane/generation identity;
5. only then expire or replace stored lease state.

Malformed, wrong-lane, stale-generation, and future-generation requests therefore perform zero expiry cleanup or other ledger mutation.

## First browser consumer

The first likely consumer is a later Chromium/Firefox actuator layered on the canonical browser projection host. A possible write path is:

```text
current canonical lane generation
  -> current interaction lease
  -> reviewed requested browser/application effect
  -> explicit effect authorization
  -> input/navigation/click/submission
  -> bounded receipt
```

Lifecycle/resource residency remains independent. Holding an interaction lease does not itself permit freeze, discard, or wake; #132 remains the resource-policy seam.
