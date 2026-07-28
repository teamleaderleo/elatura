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

`runAdapterConformance` exercises a supplied synthetic scenario and checks:

- valid fixtures are detected and validated
- invalid fixtures are rejected when provided
- each stage is deterministic
- detect, validate, plan, materialize, and validate-output preserve their inputs
- fingerprint identity matches the adapter id and version
- every declared pipeline method exists
- every implemented optional method has a matching declaration
- materialized output passes independent output validation

The conformance runner is a shared baseline. Adapter-specific suites still own graph invariants, unknown-field preservation, resource budgets, application semantics, and adversarial cases.

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

The synthetic representation path checks the fixture marker before copying any message-like content. It has no connection to the Firefox response path.

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
