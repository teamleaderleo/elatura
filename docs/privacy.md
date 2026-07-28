# Privacy model

Elatura operates near private authenticated application data. Privacy is an architectural constraint, not a settings-page feature.

## Default rules

- local only
- no analytics, remote configuration, or remote content processing
- no cookies, authorization headers, or session tokens in logs
- no response bodies or message text in benchmark reports
- no query strings in diagnostics
- no literal URL path segments in stored or exported diagnostics
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

Every non-empty path segment is replaced before storage with a content-independent class describing only coarse syntax and length, such as UUID, number, word, compound word, file-like value, encoded value, or generic segment. Hosts, query strings, fragments, and literal segment text are discarded. The report builder validates this grammar again and refuses stored aggregates containing literal path content. Path depth and classified-segment work are bounded; deep paths use an explicit overflow token and oversized segments collapse to one fixed class.

This stronger redaction deliberately reduces route fidelity. Reports can still distinguish path depth and broad segment patterns while avoiding filenames, slugs, identifiers, and future upstream path values.

The observer holds at most 128 simultaneous response filters. When that limit is reached, or Firefox refuses filter attachment, the request continues through Firefox and a numeric `unobservedRequestCount` makes the resulting report incomplete. Open filters are represented only by `activeRequestCount`; request identifiers and partial response bytes are never stored. A 64 MiB response-size policy records a numeric oversized-response count after completion while continuing exact byte counting and direct pass-through.

The content-independent grammar and stream-integrity counters use observation storage schema 5 and report schema 3. Extension startup preserves schema-2, schema-3, or schema-4 state only when every stored path already satisfies the content-independent grammar; other legacy state is cleared. A preserved active run increments `captureInterruptionCount`, because Firefox recreated the background context while request-local capture state disappeared. Reports with persistence failures, capture interruptions, active requests, or unobserved requests mark totals and path breakdown incomplete.

The analyzer reads historical report schema 2, treating missing additive integrity counters as zero. It refuses to aggregate report schema 2 and report schema 3 in one comparison because their path-template keys use different semantics.

Readiness messages contain the readiness kind, elapsed duration, and a content-free timestamp used to reject marks recorded before the active run. They carry no page path.

The JSON export omits individual request identifiers. It reports persistence failures, background-context interruptions, active requests, observation-capacity gaps, oversized responses, and path overflow instead of silently claiming complete data. The extension does not persist response bytes. Firefox extension storage is not encrypted, so even content-free diagnostics should be treated as local browser data and kept minimal.

## Structural fingerprints

Structural fingerprints describe schema shape and adapter compatibility. They must not be browser/device fingerprints and must not become cross-site identifiers.

A structural fingerprint may use field names, expected types, graph invariants, adapter version, and bounded content-type variants. It must not include message text, scalar values, or raw identifiers.

Dictionary-shaped fields require an adapter-declared dictionary path. At those paths, Elatura fingerprints the sorted union of value shapes and never serializes the dictionary keys. The ChatGPT adapter treats `$.mapping` this way so conversation node identifiers cannot enter the fingerprint.

Array and dictionary variants are bounded and order-independent. Traversal is depth-limited and cycle-safe, object-key and variant counts are capped, and the exposed shape string has a fixed maximum length. A structural fingerprint is a compatibility hint, not an authoritative content hash or cache-freshness proof.
