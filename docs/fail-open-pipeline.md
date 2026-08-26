# Fail-open transformation pipeline and synthetic materialization

Elatura's pure-library transformation controller executes six stages:

```text
detect → validate input → fingerprint → plan → materialize → validate output
```

A transformed decision exists only after the final validator accepts the complete candidate. Every other path returns the authoritative input reference with a typed pass-through outcome.

## Terminology

The existing package subpath and source files use the name `orchestration` for historical reasons. In this repository that name refers only to the local bounded transformation pipeline described here: stage sequencing, budgets, cancellation, and fail-open decisions.

Product-facing documentation should call this the **transformation pipeline** or **runtime control flow**. Work orchestration, scheduling, dispatch, wake routing, mission, and continuation belong to Stensibly rather than Elatura.

## Public library boundaries

- `@elatura/core/orchestration` owns local transformation decisions, reason codes, budgets, cancellation, diagnostics, fault injection, and stage sequencing.
- `@elatura/adapter-chatgpt/synthetic` supplies a synthetic-fixture-only adapter that consumes the existing graph validator, fingerprint, active-path planner, shared adapter identity, and capability declarations.
- `extension/firefox` remains observe-only and imports neither library subpath.

The synthetic adapter requires the fixture marker `elatura_fixture.synthetic: true`. Missing markers produce a detection miss. A malformed marker or uncertain fixture form produces an ambiguous detection. Both decisions pass through.

## Decision invariant

`PipelineDecision` has two variants:

- `pass-through`: contains `authoritativeInput`, an outcome, and a diagnostic envelope; it has no output field.
- `transformed`: contains `authoritativeInput`, the independently validated output, an outcome, and a diagnostic envelope.

The materializer's candidate remains local to the controller. Exceptions, cancellation, invalid stage return values, schema rejection, and output-validation failures cannot expose it.

The authoritative input is measured, copied within the allocation budget, and recursively frozen before any adapter stage executes. Adapters receive only that isolated copy. Mutation attempts fail open at the active stage, while every decision retains the original authoritative reference unchanged.

## Resource budgets

The controller applies explicit limits for elapsed time, estimated input bytes, visited values/nodes, recursion depth, operations, and allocated copy bytes.

Input measurement is deterministic, traverses object keys in sorted order, rejects cycles, accessors, symbol fields, sparse arrays, and non-JSON object prototypes, and runs before adapter detection. Descriptor reads prevent application getters from executing during measurement or copying. Stage contexts provide cancellation/time checkpoints plus operation, recursion, and allocation accounting. A breach maps to one stable `budget-*` reason code.

## Diagnostics

Diagnostic envelopes contain only fixed fields: schema and pipeline versions, bounded adapter id/version tokens, decision, stage, stable reason code, completed stage names, issue count, an optional bounded hexadecimal fingerprint hash, and numeric budget limits/usage.

They contain no application values, identifiers, validation paths, messages, exception text, or materialized data. Adapter identity, methods, stage results, and fingerprint fields are captured from plain data descriptors once. Getter-backed or malformed values pass through without execution.

## Synthetic snapshot semantics

The synthetic ChatGPT adapter uses `ActivePathSelectionPlan.selectedIds` as the sole retained-node authority. Materialization:

1. copies every unknown top-level field except `mapping` and `current_node`;
2. copies every field on each retained node;
3. rewrites each retained parent to its selected parent or `null`;
4. filters children to selected children in their original order;
5. emits a reserved `elatura_snapshot` envelope with counts and boundary semantics;
6. independently revalidates the graph and compares retained fields and rewritten edges against the source and plan.

`parentBoundary.kind: "omitted-parent"` names the first retained active-path node and its omitted source parent. `disconnectedRootAnchor` records the deliberate isolated root selected for anchoring. Omitted child edges are counted. No placeholder node or dangling reference is synthesized.

A pre-existing `elatura_snapshot` field causes pass-through, preserving unknown application-owned data.

## Security and graph cross-review

Graph assumptions:

- the current validator remains the independent graph validator;
- the existing planner remains the selection authority;
- the active-path plan must exactly partition retained and omitted nodes;
- reciprocal retained edges are required after boundary rewriting;
- output node identity, retained fields, top-level fields, and metadata are compared independently.

Security assumptions:

- adapters are pure functions supplied by trusted local code;
- page data cannot configure faults, budgets, adapter identity, or executable callbacks;
- diagnostics serialize fixed enums, bounded tokens, hashes, counts, and numeric budgets only;
- the authoritative input is never supplied to adapters; a bounded frozen copy is used instead;
- accessor-bearing or otherwise non-JSON-like values pass through before adapter execution;
- no network, storage, native messaging, browser permission, or response-stream capability is present.

## Enablement gate

This work is a synthetic laboratory. It makes no claim about the current live ChatGPT schema and remains disconnected from ordinary browsing. Firefox response transformation stays blocked by the live-evidence work and the security/privacy release gate in issues #3 and #4.

## Benchmark

Run the content-free synthetic benchmark after building:

```bash
npm run benchmark:synthetic-materialization -- --turns 2000 --max-groups 24 --iterations 5
```

The report contains fixture parameters, node counts, elapsed-time summaries, heap deltas, and pipeline allocation/operation totals. It contains no node ids, message payloads, titles, or raw snapshots.
