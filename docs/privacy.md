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

The extension is idle by default. It filters and records response measurements only after the user explicitly starts an observation run. Starting a run clears earlier measurements; clearing the run disables observation again.

During an active run, the M0 extension stores run-scoped aggregates containing:

- observation run identifier
- request count, response byte total, elapsed-time total, and error count
- per-redacted-path counts, bytes, durations, maximum duration, methods, and resource types
- latest DOM-ready and composer-like-input readiness marks
- capture-integrity metadata

Individual request records are not retained. Aggregate totals do not have the former 200-request ring-buffer limit. Redacted path cardinality is capped; additional path classes enter an explicit overflow bucket so total counts and bytes remain represented while the report marks its path breakdown as incomplete.

The JSON export omits individual request identifiers. It reports persistence failures, background-context interruptions, and path overflow instead of silently claiming complete data. A resumed active run increments a numeric interruption counter; no page content or response bytes are needed to detect that lifecycle event. The extension does not persist response bytes. Firefox extension storage is not encrypted, so even content-free diagnostics should be treated as local browser data and kept minimal.

## Structural fingerprints

Structural fingerprints describe schema shape and adapter compatibility. They must not be browser/device fingerprints and must not become cross-site identifiers.

A structural fingerprint may use field names, expected types, graph invariants, adapter version, and bounded content-type variants. It must not include message text, scalar values, or raw identifiers.

Dictionary-shaped fields require an adapter-declared dictionary path. At those paths, Elatura fingerprints the sorted union of value shapes and never serializes the dictionary keys. The ChatGPT adapter treats `$.mapping` this way so conversation node identifiers cannot enter the fingerprint.

Array and dictionary variants are bounded and order-independent. Traversal is depth-limited and cycle-safe, object-key and variant counts are capped, and the exposed shape string has a fixed maximum length. A structural fingerprint is a compatibility hint, not an authoritative content hash or cache-freshness proof.
