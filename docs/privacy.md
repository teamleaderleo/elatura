# Privacy model

Elatura operates near private authenticated application data. Privacy is an architectural constraint, not a settings-page feature.

## Default rules

- local only
- no analytics, remote configuration, or remote content processing
- no cookies, authorization headers, or session tokens in logs
- no response bodies or message text in benchmark reports
- no query strings in diagnostics
- redact identifiers in URL paths before storage
- bounded diagnostic retention
- no full-transcript copy outside the browser profile without explicit opt-in
- clear local-data controls
- deterministic fail-open behaviour

## Current observe extension

The M0 extension stores a bounded local ring buffer containing:

- a random per-browser-session request identifier
- HTTP method
- WebRequest resource type
- redacted URL path template
- response byte count
- elapsed time
- stop or error outcome
- page readiness marks such as DOM ready and composer-like input detection

The extension does not persist response bytes. Firefox extension storage is not encrypted, so even content-free diagnostics should be treated as local browser data and kept minimal.

## Structural fingerprints

Structural fingerprints describe schema shape and adapter compatibility. They must not be browser/device fingerprints and must not become cross-site identifiers. A structural fingerprint may use field names, expected types, graph invariants, adapter version, and content-type tags. It must not include message text or raw identifiers.
