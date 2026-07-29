# M1 production ChatGPT adapter acceptance

Issue #60 owns the first evidence-backed production adapter. This document defines the test packet that can be prepared before the private baseline while keeping all schema-specific implementation blocked on #3.

## Merge position

The required order from issue #12 is:

1. #3 produces a complete content-free baseline and selects one safest redacted response class.
2. #58 merges a pure deny-by-default authorization contract, still disconnected from response handling.
3. #60 implements and validates the pure production adapter.
4. A later Firefox-binding issue selects the response class and invokes the reviewed pipeline behind disabled capabilities.

The acceptance suite in this repository proves adapter behaviour only. Passing it grants no live authorization and enables no browser response replacement.

## Evidence packet

Before production implementation begins, #60 must record these bounded content-free inputs:

- the selected redacted response-class token;
- navigation modes in which it was observed;
- request method and resource class;
- response encoding/content class;
- observed body-byte range;
- observed node, edge, active-depth, and payload envelope;
- accepted structural fingerprint hash set;
- adapter id, new version, and readable-version policy;
- calibrated pipeline budgets and safety margin;
- known miss, ambiguity, invalid-input, and schema-drift families.

Build synthetic fixtures from the observed field and relationship rules. Never commit response bodies, transcript text, identifiers, URLs, headers, cookies, credentials, screenshots, profile paths, or copied authenticated requests.

## Production test invocation

Add a production test beside the prepared reference test:

```ts
import { defineProductionAdapterAcceptanceSuite } from "./production-adapter-acceptance.js";
import { createChatGptProductionPipelineAdapter } from "../src/production.js";

defineProductionAdapterAcceptanceSuite({
  name: "evidence-backed ChatGPT production adapter",
  adapter: createChatGptProductionPipelineAdapter(reviewedEvidencePolicy),
  expectedIdentity: reviewedEvidencePolicy.adapter,
  expectedCapabilities: reviewedCapabilities,
  validInput: evidenceShapedSyntheticFixture,
  acceptedBudgets: reviewedEvidencePolicy.budgets,
  passThroughCases: [
    unrelatedCase,
    ambiguousCase,
    invalidGraphCase,
    schemaDriftCase,
  ],
  budgetFailureCases: calibratedBoundaryCases,
  forbiddenDiagnosticTokens: syntheticPrivateSentinels,
  assertOutput: assertProductionOutput,
  createTamperingAdapter,
});
```

The production test must use a fixed clock supplied by the suite and deterministic synthetic inputs. Add separate fuzz/property tests for key ordering, graph variants, and calibrated size families.

## Required output assertions

`assertProductionOutput` must prove all of the following:

- the output independently passes the production input validator;
- the current node remains present and resolves;
- retained parent and child links are reciprocal;
- every retained child and parent reference resolves;
- the selected ids exactly match the reviewed plan;
- omitted parent and child boundaries follow the documented production rule;
- every retained unknown top-level and node field equals the source JSON-like value;
- application fields outside the reviewed transformation set remain unchanged;
- no Elatura fixture, snapshot, diagnostic, provenance, cache, authorization, or capability marker is inserted into the application response;
- the output shares no mutable object with the authoritative input;
- output size and allocation remain inside reviewed limits.

Provenance and diagnostics stay out-of-band. The application payload must remain application-native.

## Pass-through cases

The production invocation must include at least these cases:

| Case | Expected stage | Expected result |
|---|---|---|
| unrelated object | detect | `detect-no-match` |
| partial or conflicting markers | detect | `detect-ambiguous` |
| malformed graph inside the detected family | validate-input | `input-invalid` |
| unapproved observed-schema fingerprint | fingerprint | stable schema-drift pass-through reason |
| invalid policy or plan | plan | `plan-invalid` or a stable budget reason |
| reserved application-field collision | materialize | pass-through with no candidate |
| tampered candidate | validate-output | `output-invalid` |

Every pass-through decision must return the exact authoritative input reference and expose no `output` property.

## Stage fault matrix

The reusable suite injects exception, cancellation, and operation-budget failure at every stage:

- detect;
- validate input;
- fingerprint;
- plan;
- materialize;
- validate output.

Each injected failure must stop at that stage, report only content-free diagnostics, preserve the authoritative input, and expose no candidate output.

## Calibrated resource tests

The production PR must add evidence-derived boundary cases beyond the generic fault matrix:

- approved maximum body and graph envelope succeeds;
- one unit beyond the approved node, edge, depth, operation, input-byte, or allocation limit passes through;
- extreme fan-out, deep active paths, key-order permutations, and unknown-field variants remain deterministic within budget;
- time-budget tests use a deterministic synthetic clock;
- no test allocates from raw live content.

Budget defaults must never be inferred from the current synthetic fixture alone.

## Adapter contract and provenance review

In addition to the fail-open suite:

- invoke the shared adapter conformance runner for every declared capability;
- bind fingerprints and diagnostics to the exact adapter id/version;
- declare plan, materialize, and validate-output as `supported`;
- declare branches according to the observed schema;
- leave cache, submission, and alternate representation unsupported for the first production transform;
- record readable prior versions explicitly; an empty list is valid;
- keep content identity separate from structural compatibility and freshness;
- keep jump-back and alternate representation outside the application response.

## Privacy and release boundary

Acceptance success means the pure adapter is ready for cross-review. It does not permit:

- Firefox response binding;
- transform enablement in normal builds;
- persistent private-content caching;
- private indexing or alternate surfaces;
- native messaging;
- direct replay of authenticated requests.

Those paths remain governed by #4, #58, and the later Firefox-binding and live-validation packets.
