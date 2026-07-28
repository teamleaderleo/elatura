# Cache and provenance contracts

Elatura treats cached data as a derived copy. The authenticated application remains authoritative.

## Current implementation boundary

The repository contains a synthetic-only in-memory snapshot cache. It accepts JSON-serializable payloads whose provenance carries `synthetic: true`.

It does not persist browser content, survive process exit, connect to the extension, or bridge captured transcripts into another interface. Private-content persistence and private alternate surfaces remain gated by issue #4.

## Versioned envelope

Cache envelopes currently use version `1` and contain independent metadata for:

- isolation key
- adapter identity and version
- structural fingerprint hash
- opaque content identity
- freshness window
- provenance
- payload

Envelope-version compatibility, adapter compatibility, schema compatibility, content identity, and freshness are separate checks. Passing one check grants no conclusion about the others.

## Isolation keys

Every entry is keyed by:

- exact HTTP or HTTPS origin
- browser-profile identifier supplied by the trusted caller
- adapter id
- cache namespace
- resource identifier

The serialized key preserves all five fields. A lookup for one profile, origin, or adapter cannot fall through to another key.

Profile and resource values are opaque local identifiers. They should avoid raw private titles, message text, query strings, tokens, and full private URLs.

## Structural compatibility

`structural.fingerprintHash` records the adapter's structural fingerprint hash. It describes the schema shape used to create the entry.

A reader supplies the fingerprint it currently accepts. A mismatch produces `schema-drift`, removes the entry, and returns a recoverable cache miss.

Structural compatibility does not identify a conversation revision or prove current content.

## Content identity

`content` holds an opaque caller-defined identity:

```text
scheme + value + optional revision
```

A future authoritative adapter may derive this from reviewed response metadata, an application revision, or another content-safe identifier. The generic cache never derives it from message bodies.

A mismatch produces `content-identity-mismatch` and invalidates the entry.

## Freshness

Freshness uses three ordered times:

```text
capturedAt <= staleAt <= expiresAt
```

- before `staleAt`: `fresh`
- from `staleAt` through the instant before `expiresAt`: `stale`
- at or after `expiresAt`: expired and deleted

A stale hit remains visibly stale. A caller may use it only under a reviewed stale-while-revalidate policy. The generic cache does not replace authoritative network behaviour or decide whether stale display is suitable.

## Adapter compatibility

Every read checks the exact adapter id and explicit adapter-version policy. Older versions remain unreadable until listed by the current adapter after migration tests.

An incompatible id or version removes the entry and returns a miss. This keeps old payload assumptions from silently surviving adapter upgrades.

## Corruption recovery

The in-memory cache stores a serialized copy even though it lives in memory. Reads parse and validate the envelope and payload again.

Malformed JSON, invalid envelope metadata, or invalid payload causes deletion of the affected entry and a recoverable `corrupt` miss. Other entries remain available.

Unsupported envelope versions produce their own miss reason and are deleted.

## Retention, invalidation, and deletion

The synthetic store supports:

- exact-key deletion
- scoped invalidation by any isolation-key fields
- full clearing
- maximum entry count
- maximum age
- expiry pruning
- deterministic oldest-entry eviction

A persistent implementation must expose equivalent user-visible deletion and retention behaviour. Clearing private cached content must also remove indexes and derived representations that depend on it.

## Provenance

Every cached or represented payload records:

- authoritative origin
- optional authoritative reference for jump-back
- capture time
- adapter id and version
- transformation kind, id, and version where applicable
- cache kind and envelope version
- freshness window
- synthetic status

Alternate interfaces should display enough of this metadata to distinguish authoritative, transformed, cached, stale, expired, and synthetic content.

A jump-back reference points toward the authenticated source. It grants no authentication authority and should be opened through the ordinary browser.

## Encryption and OS protection hook

`PersistentCacheProtectionHooks` defines a future boundary for sealing, opening, and deleting key material. The interface exists so persistent backends have an explicit protection dependency.

No encryption or operating-system key protection is implemented by this work. A persistent private-content backend requires an implementation, threat-model review, tests for deletion and failure handling, and completion of the applicable issue #4 gate.

## Failure contract

Every cache failure returns control to authoritative application behaviour:

```text
missing / corrupt / incompatible / drifted / mismatched / expired
                         ↓
             authoritative fetch or display path
```

Cache errors never authorize a partial transform, cross-profile lookup, or silent reuse of stale private state.
