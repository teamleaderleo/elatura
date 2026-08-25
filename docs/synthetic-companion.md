# Synthetic companion protocol

Elatura's first companion contract is a pure, synthetic-only working-set experiment. It proves that a smaller client can browse a large validated read-only representation without receiving or retaining the complete source graph.

A static browser surface and a loopback-only Node server over this contract are specified in [companion-browser-surface.md](companion-browser-surface.md); the content-free measurement packet lives in [companion-browser-benchmark.md](companion-browser-benchmark.md).

This module does not start a server, read a browser profile, persist private content, inspect cookies, use native messaging, access the network, submit messages, or connect to a live application response.

The public `@elatura/core/companion` entrypoint rejects every valid representation whose provenance does not explicitly declare `synthetic: true`. Malformed fixtures remain available as corrupt-source test cases, while valid private provenance never enters the synthetic runtime.

## Protocol version 1

Every request contains exactly:

- protocol version
- session id
- request id
- operation
- operation-specific payload

Every response contains exactly:

- protocol version
- session id
- request id
- operation
- success flag
- payload or fixed error code
- current companion working-set usage

Unknown fields, malformed ids, unsupported operations, oversized strings, excessive JSON depth or nodes, and oversized request or response bodies are rejected through fixed content-free codes.

Conversation, session, and request ids use compact local-token bounds. Timeline entry ids use the broader bounded representation-id contract. Page and list cursors are opaque protocol tokens with their own larger bound so a generated cursor always round-trips through request and client validation.

Supported operations are:

- `list`
- `open`
- `page`
- `entry`
- `code`
- `search`
- `navigate`
- `status`
- `close`
- `revoke`

The capability declaration explicitly reports paging, search, branches, code-on-demand, and jump-back support. Submission, persistence, and private-content capabilities remain false.

## Mobile working set

The companion owns the complete synthetic source representation. The client receives only bounded derived records:

- one timeline window at a time
- bounded copied search snippets
- relationship ids capped by policy
- one requested code block at a time
- bounded conversation metadata

Timeline pages include `codeBlockCount` and omit code text. A client must request one block by conversation, entry, and block index. Search copies only a bounded snippet and retains no reference to the source entry object.

## Default companion limits

- 3 resident conversations
- 8 resident page/search records
- 2 pages and 1 search result set per conversation
- 256 resident entries
- 1 Mi code units of resident text
- 8 MiB serialized resident data
- 32 MiB accounted resident data
- 50 entries per page
- 16 Ki code units of text per page entry
- 512 Ki code units of text per page
- 1 MiB serialized page response
- 2 MiB serialized protocol response
- 50 search results
- 240 code units per search snippet
- 256 KiB serialized search result set
- 100,000 scanned index entries
- 16 Mi code units of scanned index text
- 4 in-flight requests
- 4 queued page requests
- 64 relationship ids per navigation result
- 256 Ki code units per code response
- 64 KiB serialized request
- 1-hour volatile session lifetime

Every policy value is a positive safe integer. Constrained and adversarial configurations may lower limits, but the response ceiling must remain large enough to contain the configured maximum page, search, code, metadata, relationship, and envelope payload. Incoherent policies fail during construction before any resident state exists.

## Source-admission representation policy

Synthetic companion construction accepts an optional `representationPolicy` that bounds how large an admitted read-only source may be. It is separate from the resident working-set limits above and from client state:

- absent by default, which preserves the 10,000-entry default admission ceiling;
- validated through the descriptor-safe public wrapper, which rejects unknown fields, accessors, non-safe integers, and incoherent caps (a per-entry byte ceiling above the total, more children per entry than entries, or a code-block text ceiling above the entry text ceiling) before any source is inspected;
- applied to every admitted source at construction, including the synthetic ChatGPT alternate-representation helper through its own optional `representationPolicy`;
- unable to bypass synthetic-only provenance or version-1 entry-id requirements.

This is the bounded seam used to admit a 100,000-entry synthetic fixture for the companion browser experiments without raising any global default.

## Resident admission

Page and search records are measured before entering resident state. Admission plans all removals before mutating the working set.

The runtime applies these rules:

1. reject a record that cannot fit by itself;
2. plan deterministic oldest-conversation eviction when the conversation limit is reached;
3. plan per-conversation page/search replacement;
4. plan deterministic oldest-record eviction for aggregate limits;
5. apply the plan only after the resulting counts and bytes satisfy every policy.

The policy-coherence check guarantees that every accepted stateful success payload fits inside the configured response envelope. A page or search admission therefore cannot succeed internally and then return `response-too-large` with hidden retained state.

Usage reports include resident conversation count, record count, entry count, text code units, serialized bytes, accounted bytes, in-flight requests, and queued pages.

## Cursors, close, and revoke

Every page cursor contains the conversation generation and bounded index range. Closing, resident-conversation eviction, adapter drift, expiration, and session revocation advance the generation or session epoch.

Delayed page work checks both values immediately before commit. A late response therefore cannot repopulate a closed, evicted, drifted, expired, or revoked working set.

`close` removes all resident pages and search snippets for one conversation. `revoke` clears every resident record, advances all generations, and permanently disables the volatile session.

## Freshness and compatibility

Stale representations remain readable and are labelled `stale`. Expired representations are released and return `conversation-expired`.

The runtime accepts exact adapter id/version pairs supplied by trusted local configuration. A source whose identity leaves that set becomes `drifted`, releases resident state, and cannot be opened until the trusted set changes again.

Invalid source representations remain visible as `corrupt` metadata and cannot be opened.

## Bounded client state

`BoundedCompanionClientState` owns only:

- capped conversation metadata
- one timeline page
- one search result set and its conversation id
- one code block
- fixed last-error state
- a capped map of pending request ids and expected operations

The client rejects unsolicited, duplicate, operation-mismatched, malformed, and oversized responses. A successful `close` clears page, search, and code state for that conversation. A successful `revoke` clears all client state.

Client state is remeasured before every commit. Rejected state leaves the previous bounded view intact while releasing pending ownership of the response.

## Remaining work under issue #73

This contract is the core consumed by a later loopback browser experiment. That later packet still needs:

- a synthetic-only local transport
- a minimal responsive browser view
- mobile and desktop manual benchmark instructions
- content-free latency and memory observations
- backgrounding and reconnect experiments

Private-content transport remains blocked by issue #4. Persistent storage remains owned by issue #32.
