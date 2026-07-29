# Adapter contracts

Elatura adapters describe application-specific knowledge without granting every adapter the same powers.

## Capability declarations

`ApplicationAdapter` declares support for each optional feature:

- `plan`
- `materialize`
- `validateOutput`
- `branches`
- `paging`
- `cache`
- `submission`
- `alternateRepresentation`

Each feature is one of:

- `unsupported` — the adapter supplies no implementation
- `synthetic-only` — the implementation accepts test fixtures carrying an explicit synthetic marker
- `supported` — the implementation may accept authoritative input once its own release gates are satisfied

A capability declaration describes an adapter contract. It does not enable browser permissions, response interception, persistence, or native messaging.

The early `Adapter<TSource, TSnapshot>` interface remains available during migration. New orchestration, cache, and alternate-surface work should target `ApplicationAdapter` from `@elatura/core/adapter-contract`.

## Staged transform contract

A transform-capable adapter follows this sequence:

```text
detect → validate → fingerprint → plan → materialize → validateOutput
```

The stages have separate responsibilities:

1. `detect` performs a cheap candidate check.
2. `validate` parses and verifies authoritative input without mutation.
3. `fingerprint` describes schema compatibility without content identity.
4. `plan` selects a bounded working set.
5. `materialize` creates a candidate output from validated input and a validated plan.
6. `validateOutput` independently verifies the candidate before any caller may publish it.

Declarations are internally consistent:

- materialization requires planning
- output validation requires materialization
- declared stages require matching methods
- methods cannot silently appear while their capability remains `unsupported`

## Reusable conformance checks

`runAdapterConformance` exercises a supplied synthetic scenario rather than checking method names alone. It verifies that:

- valid fixtures are detected and validated
- invalid fixtures are rejected when provided
- detect, validate, fingerprint, plan, materialize, output validation, alternate representation, and alternate-output validation are deterministic
- every stage preserves the exact source, plan, option, or detached validator input passed to it
- fingerprint identity matches the adapter id and version
- every declared pipeline or alternate-representation method exists
- every implemented optional method has a matching declaration
- materialized output passes independent output validation
- declared alternate representations execute and pass either a supplied validator or the generic read-only representation validator
- `synthetic-only` capabilities execute only when the scenario explicitly declares synthetic context

Conformance snapshots are bounded. The runner charges array slots, object keys, inherited enumerable keys, and values before retaining or sorting them. Accessor-bearing, cyclic, unsupported, or over-budget fixtures fail with fixed content-free issue codes instead of invoking getters or allocating an unbounded canonical key array.

The conformance runner is a shared baseline. Adapter-specific suites still own graph invariants, unknown-field preservation, application semantics, and workload-specific adversarial cases.

## Schema drift

A structural fingerprint answers one question: does the input have a schema shape this adapter understands?

It does not identify content, prove freshness, identify a browser profile, or authorize reuse of a cached payload.

A fingerprint mismatch is schema drift. Cache and transform callers must invalidate the candidate and return to authoritative application behaviour. Compatibility cannot be inferred from semver ranges alone because upstream application schemas may change independently of Elatura package versions.

## Adapter-version compatibility

Cache readers use an explicit `AdapterVersionPolicy`:

- exact adapter id is required
- the current adapter version is readable
- older versions are readable only when listed in `readableVersions`
- every unlisted version is incompatible

Compatibility lists are intentional migration records. An adapter version bump begins incompatible by default until tests demonstrate that the new reader safely understands an older envelope.

## ChatGPT declaration

The current ChatGPT adapter declares:

- branch awareness: `supported`
- cache: `synthetic-only`
- alternate representation: `synthetic-only`
- paging: `unsupported`
- submission: `unsupported`
- plan/materialize/validate-output: `unsupported` on this branch

The ChatGPT conformance scenario now executes its synthetic alternate representation and validates the resulting generic read-only representation. The path checks the fixture marker before copying any message-like content and has no connection to the Firefox response path.

## Integration guidance

Fail-open orchestration should depend on the staged method names and capability declarations. Graph correctness work should continue to own strict validation and traversal budgets. Security policy should decide which declared capabilities may become reachable in a given build.

Capability support and feature enablement are separate decisions:

```text
adapter declares support
        +
build grants capability
        +
input passes validation and policy
        =
feature may run
```
