# Bounded synthetic companion core

Status: synthetic, in-memory, engine-neutral experiment for issue #79.

## Purpose

The companion core tests whether Elatura can expose an oversized read-only application record while keeping a small resident working set. It does not acquire browser data and does not provide an HTTP server or user interface.

The core has three public modules behind `@elatura/core/companion`:

- strict versioned protocol contracts;
- a synthetic in-memory companion runtime;
- bounded client-side state admission.

## Safety and privacy boundary

The runtime accepts representations whose provenance declares `synthetic: true`. It has no browser APIs, network access, storage backend, native messaging, credentials, cookies, profile paths, authenticated requests, or private-content bridge.

This packet does not authorize any capability in the Firefox extension. Live response transformation, private alternate surfaces, private persistence, and device-to-device access remain governed by the existing evidence, authorization, and release gates.

## Protocol v1

Every request declares a version, request id, session id, and operation. Parsers reject unknown fields, malformed values, unbounded limits, accessors, proxies, and unsupported versions through fixed validation codes.

Supported operations:

- `list` — bounded synthetic conversation metadata;
- `open` — one bounded timeline window around the active entry;
- `page` — a bounded earlier or later window using a generation-bound cursor;
- `entry` — one entry without full code text;
- `code` — one code block on demand;
- `search` — bounded copied snippets with no retained source references;
- `navigate` — bounded parent, child, and sibling records;
- `status` — current session state and deterministic usage;
- `close` — release the active working set;
- `revoke` — release state and reject the bounded session tombstone.

Every response is measured before delivery. Oversized responses become a fixed `response-limit` failure.

## Working-set policy

`CompanionPolicy` sets explicit limits for:

- sessions and revoked-session tombstones;
- active conversations;
- resident pages and aggregate resident page bytes;
- entries, child ids, text, code, search queries, snippets, results, and navigation records;
- pending page work;
- response nodes and serialized bytes.

Resident page eviction is deterministic by last use and stable key ordering. Opening more conversations than allowed releases the oldest active working set. Code text is excluded from timeline pages and fetched one block at a time.

The runtime reports sessions, active conversations, resident page counts and bytes, retained search results, retained code units, and pending page work. Tests use deliberately small limits to prove a stable plateau.

## Lifecycle and cancellation

Timeline cursors contain the session generation and starting entry index. Opening, closing, revoking, replacing, or removing a source advances or invalidates the active generation.

`beginPageWork()` records a pending page request without materializing a response. `completePageWork()` checks the session, generation, active conversation, revocation state, and pending work id. A late result returns `late-reply-discarded` and cannot repopulate released pages.

`close` clears pages, snippets, code, queues, and the active conversation. `revoke` performs the same cleanup, removes the session, and records a bounded tombstone.

## Client state

`BoundedCompanionClientState` retains only:

- bounded conversation metadata;
- one current timeline window;
- capped copied search results;
- one requested code block.

It validates the complete response envelope before admission, rejects older generations, copies accepted records, measures the resulting snapshot, and rolls back atomically when nested data or resident-byte limits fail.

## Next packet

After independent review and merge, issue #73 can consume this pure core in a loopback/static browser experiment. That later packet owns rendering virtualization, browser lifecycle measurements, bundle cost, and the content-free mobile benchmark. Private transport remains a separate gated milestone.
