# Architecture

## Working definition

Elatura is a local adaptive access layer for oversized authenticated web applications.

```text
authenticated browser request
        ↓
browser transport
        ↓
application adapter
        ↓
validation + structural fingerprint
       ↙ ↘
original bytes   bounded working set / local representation
```

The authenticated website remains authoritative. Elatura changes how much state becomes active and which surface presents it.

## Planned components

### Browser transport

The transport observes requests inside a real signed-in browser profile. The first transport is a Firefox WebExtension because Firefox exposes a response stream filter. Transport code must not contain application graph logic.

### Core runtime

The core owns generic concepts:

- adapter detection and capability declarations
- validation results
- structural fingerprints
- working-set policies
- staged plan/materialize/validate-output contracts
- cache envelopes, compatibility metadata, and isolation keys
- provenance and freshness metadata
- read-only representation contracts
- instrumentation envelopes
- fail-open decisions

It must not know ChatGPT endpoint names, message roles, or graph field names.

### Application adapters

An adapter owns application-specific knowledge. The first adapter recognizes and validates candidate ChatGPT conversation graphs. Later adapters may target issue timelines, notebooks, logs, documents, or message archives.

Adapters declare optional capabilities individually. Branch navigation, paging, caching, submission, planning, materialization, output validation, and alternate rendering are never inferred from the presence of an adapter.

A transform-capable adapter follows:

```text
detect → validate → fingerprint → plan → materialize → validate output
```

A shared conformance runner checks declarations, determinism, input preservation, fingerprint identity, and independent output validation. Application-specific graph semantics and resource budgets remain in adapter suites.

See `docs/adapter-contracts.md`.

### Cache layer

Cache entries are derived copies. A versioned envelope keeps these dimensions separate:

- origin/profile/adapter isolation
- adapter-version compatibility
- structural fingerprint compatibility
- opaque content identity
- freshness and expiry
- provenance

The current cache is an in-memory synthetic-fixture implementation. Persistent private-content caching remains behind the security and privacy release gate. Protection hooks define the required seam for future encryption or operating-system key services without claiming an implementation.

See `docs/cache-and-provenance.md`.

### Alternate surfaces

A future local web, native, or terminal interface may render and search captured state without asking the original application to mount its complete UI. It must preserve provenance and provide a path back to the authoritative page.

The generic read-only representation supports deterministic timeline order, search text, parent/child navigation, code blocks, active-path navigation, and jump-back references. The current ChatGPT representation accepts explicitly synthetic fixtures only and has no Firefox bridge.

## Initial modes

- **observe** — byte-for-byte pass-through with content-free local metrics
- **safe** — validated bounded working set; not implemented yet
- **cached** — validated local snapshot followed by revalidation; persistent private-content mode not implemented yet
- **full** — no interception or transformation

Capability declaration and runtime enablement remain separate. A build must grant a capability explicitly after the applicable security, privacy, live-evidence, and release checks.

## Second workload

ChatGPT is the first workload and should not dictate the generic interfaces. A second production adapter waits for M1 evidence. Selection should reward pathological value, structured state, reproducibility, contract diversity, direct provenance, manageable privacy/legal risk, and sustainable maintenance cost.

See `docs/second-workload-rubric.md`.

## Why not a browser engine?

Building an engine would bury the experiment under security, compatibility, media, accessibility, networking, and browser-UX responsibilities. Elatura initially reuses Firefox for those jobs and owns only the adaptive-state layer.

## WebKit position

A focused macOS shell using WKWebView remains a plausible later transport. It may offer a cleaner product surface and tighter lifecycle control, but its public API does not expose the same ordinary-HTTPS response-body interception primitive. Prove the adapter and cache model in Firefox first; revisit WebKit after M1.
