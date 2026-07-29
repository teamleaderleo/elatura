# Deny-by-default live authorization

Elatura's observe-only response path remains the default. A live private-content capability may proceed only after one pure authorization decision returns `eligible: true`. The decision module is currently disconnected from the Firefox background response handler, and the repository contains no grant issuer, unlock message, or positive approval record.

## Boundary

The authorization check runs before any future code:

- retains or decodes candidate response bytes;
- invokes a production transform adapter;
- persists private content;
- sends private content to an alternate surface;
- hands private content to a native companion.

A denial leaves the authoritative byte-for-byte observer path in control. Authorization never substitutes for adapter detection, schema validation, fingerprints, resource budgets, independent output validation, or the emergency kill switch.

## Two required records

### Reviewed approval

A `LiveAuthorizationApproval` is immutable, content-free review evidence bundled with an exact build. It binds:

- approval schema and bounded approval identifier;
- full source revision, extension version, release channel, and build-manifest SHA-256;
- exact HTTPS origin;
- a bounded content-free response-class identifier selected from #3 evidence;
- exact adapter id and version;
- the complete enabled live-capability set;
- the SHA-256 of the reviewed content-free evidence packet;
- the expected structural fingerprint hash;
- an explicit validity interval.

The approval is build input, never page input, browser storage, remote policy, or a downloaded configuration. Changing the build, channel, capability policy, adapter, response class, evidence, or validity interval requires another reviewed approval.

### Volatile session grant

A `VolatileLiveAuthorizationGrant` represents the future explicit local authorization action. It binds one requested capability to:

- the exact reviewed approval;
- the current background-session identifier;
- the build-manifest digest;
- origin and response-class identifier;
- adapter id/version;
- the approval's exact capability set;
- issue and expiry times within the approval interval;
- emergency-control generation;
- local opt-in generation.

The grant must live only in extension-process memory. Browser restart, background restart, extension reload, explicit revocation, emergency disable, or any integrity reset removes it. This design intentionally provides no grant-creation API; the future issuer and UI require a separate #4 review.

## Decision order

`evaluateLiveAuthorization` uses fixed content-free denial codes and follows this order:

1. Validate the bounded top-level request and emergency snapshot.
2. Deny immediately when the emergency lock is engaged. This result takes precedence over positive or malformed approval/grant data.
3. Require the requested capability in the exact locally declared live-capability set.
4. Require current session-local opt-in intent while preserving `authorizesTransform: false`.
5. Apply the bundled exact adapter id/version denylist.
6. Require a well-formed, unrevoked, currently valid reviewed approval.
7. Match build, origin, response class, adapter, and complete capability set exactly.
8. Require a well-formed, unexpired volatile grant.
9. Match session id, safety generation, opt-in generation, approval, build, origin, response class, adapter, and capability bindings exactly.
10. Return eligible for the single requested capability.

Any missing, malformed, stale, contradictory, widened, downgraded, revoked, or mismatched value returns a denial. The function does not throw application data, log raw input, inspect response content, access storage, call the network, or mutate its input.

## Authority sources

Future Firefox binding must construct gate input only from these sources:

| Input | Required source |
|---|---|
| current build identity | immutable generated build metadata |
| declared live capabilities | bundled `security/capabilities.json` |
| reviewed approval | bundled reviewed content-free approval artifact |
| revocation identifiers | bundled local revocation data |
| adapter denylist | bundled exact id/version list |
| emergency state | volatile local safety controller |
| opt-in generation | volatile local opt-in controller |
| session id and grant | volatile background-process memory |
| origin and response class | narrowly classified Firefox request metadata |
| clock | local runtime clock |

Page responses, DOM data, content-script messages, browser storage, remote services, query strings, and application-controlled fields cannot supply or amend authorization authority.

## Capability isolation

The live capability names are `transform`, `cache`, `alternate-surface`, and `native-companion`. Approval lists are canonical, unique, and exact. A transform approval cannot authorize cache, alternate-surface, or native-companion work. Synthetic adapter capabilities remain outside this gate and grant no live private-content access.

## Current build state

The current extension remains unable to satisfy the decision:

- transform, cache, and native-companion capabilities remain disabled;
- the emergency controller starts engaged and exposes no unlock path;
- opt-in intent explicitly reports `authorizesTransform: false`;
- no reviewed live approval is bundled;
- no volatile grant issuer exists;
- `background.ts` does not import the live authorization module.

The pure contract and adversarial tests can merge before #3. Populating the first approval requires completed #3 evidence. Connecting a grant issuer or response path requires the applicable #4 review.

## Review checklist for future binding

- Call authorization before candidate capture or decoding.
- Call it again before any transformed bytes, persistence, alternate rendering, or native handoff.
- Preserve byte-for-byte pass-through for every denial and exception.
- Register grant clearing with the volatile-state registry.
- Change the session identifier on every background start.
- Revoke grants when safety or opt-in generation changes.
- Keep approval and revocation artifacts local, fixed-schema, content-free, and build-reviewed.
- Add live tests for restart, expiry, emergency disable, opt-in revocation, adapter denylisting, capability-policy drift, schema drift, output mismatch, and browser cancellation.
