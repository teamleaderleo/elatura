# Firefox response-binding preparation

Issue #72 owns the transport contract that will eventually connect one evidence-selected response class to the reviewed production adapter. The current implementation is browser-independent and uses synthetic bytes only.

## Current boundary

`@elatura/core/response-binding` prepares one immutable decision. It does not import Firefox APIs, inspect request URLs or headers, select a ChatGPT endpoint, issue authorization, access storage, or write response bytes.

The decision order is fixed:

```text
content-free metadata selection
  → authorization
  → bounded chunk collection
  → injected decode
  → injected fail-open pipeline bridge
  → injected serialization
  → prepared transformed bytes
```

Any miss, ambiguity, denial, malformed result, exception, cancellation, invalid chunk, chunk-count breach, body-byte breach, pipeline pass-through, or invalid serialization returns the original chunk references. The original bytes are never parsed and reserialized for pass-through.

## Dependency requirements

The future Firefox adapter must inject five data-property functions:

- `select(metadata)` returns only `match`, `miss`, or `ambiguous`;
- `authorize(metadata)` returns only an eligibility boolean derived from the reviewed live-authorization contract;
- `decode(bytes)` belongs to the reviewed application adapter bridge;
- `runPipeline(decoded)` returns only pass-through or a fully validated transformed output;
- `serialize(output)` returns one application-native `Uint8Array`.

Accessor-backed functions and malformed stage results are rejected without exposing exception details.

## Byte ownership

Input chunks are never mutated. Every pass-through decision retains the exact original chunk objects in original order. A transformed decision contains one copied serialized byte array, so later mutation of the serializer's buffer cannot change the prepared result.

The pure controller does not perform stream writes. A later Firefox integration must commit a prepared decision only after all gates succeed. That avoids exposing partial candidate bytes from this layer.

## Live integration gates

Do not adapt `StreamFilter` events into this controller until:

1. #3 identifies one safest content-free response class;
2. #60 merges the corresponding production adapter and reviewed limits;
3. the #69 authorization contract is evaluated before candidate collection;
4. the applicable #4 review permits a local test build;
5. cross-review confirms the existing observer pass-through remains unchanged.

Normal builds remain observe-only. Misses and every failure must continue to write the authoritative bytes unchanged.

## Diagnostics

Diagnostics contain only:

- schema and binding versions;
- decision, stage, and fixed reason code;
- completed stage names;
- chunk count;
- input and output byte counts.

They contain no byte content, URL, request identifier, response-class identifier, headers, adapter output, exception text, or private application data.
