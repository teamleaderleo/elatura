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

- adapter detection
- validation results
- structural fingerprints
- working-set policies
- cache metadata
- instrumentation envelopes
- fail-open decisions

It must not know ChatGPT endpoint names, message roles, or graph field names.

### Application adapters

An adapter owns application-specific knowledge. The first adapter recognizes and validates candidate ChatGPT conversation graphs. Later adapters may target issue timelines, notebooks, logs, documents, or message archives.

### Alternate surfaces

A future local web, native, or terminal interface may render and search captured state without asking the original application to mount its complete UI. It must preserve provenance and provide a path back to the authoritative page.

## Initial modes

- **observe** — byte-for-byte pass-through with content-free local metrics
- **safe** — validated bounded working set; not implemented yet
- **cached** — validated local snapshot followed by revalidation; not implemented yet
- **full** — no interception or transformation

## Why not a browser engine?

Building an engine would bury the experiment under security, compatibility, media, accessibility, networking, and browser-UX responsibilities. Elatura initially reuses Firefox for those jobs and owns only the adaptive-state layer.

## WebKit position

A focused macOS shell using WKWebView remains a plausible later transport. It may offer a cleaner product surface and tighter lifecycle control, but its public API does not expose the same ordinary-HTTPS response-body interception primitive. Prove the adapter and cache model in Firefox first; revisit WebKit after M1.

The evidence, cross-browser capability matrix, engine-neutral contract requirements, and measurable Firefox exit criteria are maintained in [`transport-capability-matrix.md`](transport-capability-matrix.md).
