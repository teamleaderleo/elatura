# Cache and provenance contracts

Elatura treats cached data as a derived copy. The authenticated application remains authoritative.

## Current implementation boundary

The repository contains a synthetic-only in-memory snapshot cache. It accepts bounded JSON payloads whose provenance carries `synthetic: true`.

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

Envelope-version compatibility, adapter compatibility, schema compatibility, content identity, freshness, and resource admission are separate checks. Passing one check grants no conclusion about the others.

### Normalization boundary

Successful validation returns a newly constructed envelope. The cache does not preserve the caller's object by type assertion.

In particular:

- isolation, adapter, structural, content, freshness, and provenance fields are copied from validated values only
- unknown envelope and provenance fields are rejected for the current schema version
- the payload stored by the cache is the payload validator's returned `value`, not the original raw input
- payload-validator exceptions become content-free validation failures
- descriptor-safe resource preflight runs before serialization
- serialization produces the final detached JSON value returned by `put`

A future envelope version may add fields deliberately. Version 1 cannot silently carry hidden metadata alongside validated fields.

## Descriptor-safe JSON accounting

`@elatura/core/resource-accounting` measures JSON-compatible values before whole-document serialization. The traversal:

- inspects own property descriptors without invoking getters
- accepts plain objects, null-prototype objects, dense arrays, strings, finite numbers, booleans, and null
- rejects accessors, symbols, cycles, sparse arrays, extra array properties, non-plain objects, unsupported values, and inspection failures
- bounds traversal depth, visited nodes, individual string code units, and exact serialized UTF-8 bytes
- verifies that final `JSON.stringify` output matches the preflight byte count

Failures use fixed codes and do not include property values, thrown messages, application paths, or private content.

## Synthetic cache resource policy

The default in-memory cache policy is:

- 128 entries
- 24-hour maximum age
- 4 MiB serialized bytes per entry
- 20 MiB accounted resident bytes per entry
- 32 MiB serialized bytes in aggregate
- 160 MiB accounted resident bytes in aggregate
- one million JSON nodes per entry
- one Mi code units per JSON string

The caller may supply lower or alternate limits through `retention`. Every numeric limit must be a positive safe integer, except `maxAgeMs`, which may be zero.

### Accounted resident bytes

The cache retains a JavaScript JSON string. A read also creates decoded and normalized objects and returns a caller-owned clone. The default accounting estimate charges:

```text
UTF-16 retained string bytes + 3 × serialized UTF-8 bytes
```

This is a conservative local policy estimate, not a browser heap profiler. `cache.usage` reports exact admitted entry count and serialized bytes plus the policy-derived accounted bytes.

### Admission behavior

`put` validates and serializes the candidate into one bounded local value before touching the map. It then:

1. prunes expired and over-age entries;
2. calculates count-based deterministic evictions without applying them;
3. checks future serialized and accounted aggregate totals;
4. applies planned count evictions and replacement only after every limit passes.

A rejected candidate is never retained. An oversized replacement leaves the prior valid entry available. Aggregate byte pressure returns an explicit failure rather than deleting unrelated entries to make room.

Stable resource result codes include:

- `cache-entry-byte-limit`
- `cache-entry-accounted-byte-limit`
- `cache-entry-unit-limit`
- `cache-aggregate-serialized-byte-limit`
- `cache-aggregate-accounted-byte-limit`
- `cache-entry-count-limit`
- `cache-envelope-inspection-failed`
- `cache-serialization-failed`

Restored synthetic seed entries are measured before admission. Corrupt entries within policy remain recoverable through the existing read-time validation and deletion path.

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

`structural.fingerprintHash` records the adapter's structural fingerprint hash. It describes the schema used to create the entry.

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

Freshness uses three ordered non-negative times:

```text
capturedAt <= staleAt <= expiresAt
```

- before `staleAt`: `fresh`
- from `staleAt` through the instant before `expiresAt`: `stale`
- at or after `expiresAt`: expired and deleted

The envelope freshness window and provenance freshness window must match exactly. A cache entry cannot claim one lifetime in lookup metadata and a different lifetime in provenance.

A stale hit remains visibly stale. A caller may use it only under a reviewed stale-while-revalidate policy. The generic cache does not replace authoritative network behaviour or decide whether stale display is suitable.

## Adapter compatibility

Every read checks the exact adapter id and explicit adapter-version policy. Older versions remain unreadable until listed by the current adapter after migration tests.

An incompatible id or version removes the entry and returns a miss. This keeps old payload assumptions from silently surviving adapter upgrades.

## Corruption recovery

The in-memory cache stores a serialized copy even though it lives in memory. Reads parse and validate the envelope and payload again.

Malformed JSON, invalid envelope metadata, invalid provenance, inconsistent freshness, invalid payload, or clone failure causes deletion of the affected entry and a recoverable `corrupt` miss. Other entries remain available.

Unsupported envelope versions produce their own miss reason and are deleted.

## Retention, invalidation, and deletion

The synthetic store supports:

- exact-key deletion
- scoped invalidation by any isolation-key fields
- full clearing
- maximum entry count
- maximum age
- expiry pruning
- deterministic oldest-entry count eviction
- per-entry and aggregate serialized-byte limits
- per-entry and aggregate accounted-memory limits
- exact post-operation usage reporting

Repeated put/get/delete operations return to the same measured plateau and to zero after deletion. Cache reads return caller-owned clones; the cache stores no callbacks, promises, or late consumer references that can reinsert or retain a deleted payload.

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

The complete provenance object is validated and normalized. Its adapter must agree with the enclosing representation or cache envelope, and its capture time must agree with freshness metadata.

Alternate interfaces should display enough of this metadata to distinguish authoritative, transformed, cached, stale, expired, and synthetic content.

### Jump-back references

A jump-back reference is treated as untrusted navigation input even after TypeScript compilation. Representation version 1 accepts only:

- absolute HTTP or HTTPS URLs
- the same origin as the authoritative origin
- no username or password
- no query string
- an optional fragment for locating an entry

`javascript:`, `data:`, cross-origin, credential-bearing, malformed, and query-bearing references are rejected. `resolveJumpBackReference` repeats the safety check defensively before returning a target.

A jump-back reference points toward the authenticated source. It grants no authentication authority and should be opened through the ordinary browser.

## Read-only representation resource policy

Read-only representation schema version `1` remains unchanged. Admission now applies a separate policy with these defaults:

- 10,000 entries
- 10,000 child ids per entry
- 256 code blocks per entry
- one Mi code units of entry text
- 256 Ki code units per code block
- 2 MiB serialized bytes per entry
- 32 MiB serialized bytes per representation
- one million JSON nodes
- 4,096 code units per search query
- 1,000 search results
- 4,096 extracted code blocks

`validateAndMeasureReadOnlyRepresentation` returns the normalized representation together with entry count, code-block count, string code units, exact serialized bytes, and JSON node usage. `measureReadOnlyRepresentation` performs the admission preflight without returning the normalized graph.

Every copy of text retained in the representation is charged. When fenced code remains in `entry.text` and is also copied into `codeBlocks`, both strings participate in per-entry and total accounting. A future span/reference model may reduce this duplication; no uncharged secondary copy exists today.

Representation resource failures use separate fixed codes for entry count, entry bytes, total bytes, strings, code-block count, code-block text, and traversal units.

`searchReadOnlyRepresentation` and `extractReadOnlyCode` stop after their bounded result counts. Callers may request a lower maximum. Oversized queries return no results.

## Read-only representation integrity

A validated read-only representation is newly constructed from validated fields. Version 1 rejects unknown top-level, provenance, entry, and code-block fields.

Its graph must have reciprocal parent/child links, every parent chain must terminate at a root, and a non-empty representation must declare a connected active path. This prevents alternate interfaces from receiving a cyclic or partially trusted navigation graph.

## Encryption and OS protection hook

`PersistentCacheProtectionHooks` defines a future boundary for sealing, opening, and deleting key material. The interface exists so persistent backends have an explicit protection dependency.

No encryption or operating-system key protection is implemented by this work. A persistent private-content backend requires an implementation, threat-model review, tests for deletion and failure handling, and completion of the applicable issue #4 gate.

## Failure contract

Every cache failure returns control to authoritative application behaviour:

```text
missing / corrupt / incompatible / drifted / mismatched / expired / over-budget
                                      ↓
                          authoritative fetch or display path
```

Cache errors never authorize a partial transform, cross-profile lookup, unsafe navigation reference, unbounded local retention, or silent reuse of stale private state.
