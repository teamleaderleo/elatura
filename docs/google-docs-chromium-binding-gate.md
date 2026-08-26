# Google Docs Chromium binding gate

Status: research-only gate for #118. Browser projection host: #136 / #129. Consumer lane protocol: #127. Residency policy: #132.

## Why this gate exists

The merged Chromium projection host intentionally knows browser state without pretending to know application state.

Before a binding exists it can report an ephemeral browser `projectionRef`, foreground/background/frozen/discarded state, browser protection, audio state, and explicit operator browser actions. It deliberately keeps application state at `application_unknown` and ordinary freeze/discard eligibility at `unknown`.

That behavior is the correct starting point for Google Docs. Browser metadata cannot prove that a human edit is saved, an IME transaction is complete, a comment editor is closed, collaboration is quiescent, or a discarded Doc will return to the expected working region.

The first managed #118 freeze/discard trial therefore has one prerequisite:

> bind the current Chromium projection to the exact generated application lane and generation, then supply current content-free human fidelity facts before invoking the shared #132 planner.

## Research binding only

V1 is an operator-confirmed benchmark binding for generated Docs. It is not a production Google Docs adapter.

It adds no:

- Docs API client;
- document response parsing;
- URL/title/content collection;
- cookie/token/profile export;
- content script requirement;
- automatic document edit;
- automatic lifecycle action;
- persistent third-party identifier.

## Identity domains

Keep these identities separate:

```text
application lane
  laneRef + laneGeneration
  consumer-visible, content-free

browser projection
  projectionRef
  Chromium-host internal, ephemeral

provider document identity
  stays inside the signed-in application/browser context
```

For the generated #118 fixtures, the benchmark coordinator assigns stable local lane refs by fixture ordinal, for example:

```text
gdocs-research-large-00
gdocs-research-switch-01
...
gdocs-research-switch-08
```

Those tokens identify benchmark lanes, not Google document ids.

`projectionRef` never enters the committed #118 run manifest. The Chromium host may use it internally to execute or recover the current browser projection.

## Operator-confirmed binding flow

For one generated research Doc:

1. Activate the candidate Chromium projection.
2. The human confirms which generated fixture ordinal is visible using the known research fixture and generated anchor convention.
3. The benchmark coordinator associates the private current `projectionRef` with the preassigned `laneRef + laneGeneration`.
4. Capture the current content-free Docs fidelity probe.
5. Derive freeze/discard eligibility with `classifyGoogleDocsLifecycleEligibilityV1()`.
6. Create generation-bound #132 lifecycle facts using the current Chromium projection state plus the derived application eligibility.
7. Request the intended posture (`suspended`, `reclaimable`, or later `responsive`).
8. Run the pure #132 planner.
9. Re-fetch the browser projection immediately before any browser effect.
10. Refuse the effect if the binding disappeared, the lane generation changed, the projection no longer matches, or current eligibility is weaker than the decision assumed.
11. Perform the selected browser action through the reviewed Chromium host/short-lived CDP path.
12. Record only content-free lane facts, planner receipt, browser outcome, resource metrics, and human fidelity verdicts.

The human confirmation is the application binding in this research packet. The extension never infers the generated Doc from URL/title/page content.

## Generation rule for the benchmark binding

`laneGeneration` is the local application-lane binding epoch. It is not a Google document revision number.

Generation starts at `1` for the initial confirmed binding and increases whenever the prior application binding is invalidated and must be established again, including:

- navigation to a different application target;
- browser restart followed by explicit rebind;
- projection loss where recovery cannot prove continuity of the previous binding;
- operator replacement of the generated Doc assigned to that lane;
- any binding drift that makes an older lifecycle decision unsafe.

A simple discard/reload may preserve the same lane generation only when recovery proves the same logical lane binding remained valid. Otherwise rebind and advance the generation.

Within one content-free run manifest, lane refs remain stable by document ordinal and generations never decrease.

## Conservative Docs eligibility mapping

`benchmarks/src/google-docs-lifecycle-facts.ts` is the first pure mapping from human-observed generated-Doc state to #132 eligibility.

### Known blockers

V1 maps these observations to blocked freeze and discard eligibility:

| Human observation | #132 blocker |
| --- | --- |
| local edit pending | `unsaved_interaction` |
| save visibly in progress | `save_in_progress` |
| IME/composition active | `composition_active` |
| comment/suggestion/dialog text entry active | `modal_interaction` |
| collaboration actively changing the Doc | `collaboration_active` |
| explicit manual protection | `manual_protection` |
| live text selection in the first conservative policy | `manual_protection` |

The live-selection rule is intentionally conservative. The explicit adversarial selection probe can later earn a narrower rule independently for freeze and discard.

### Unknown state

Offline state, unknown critical facts, or other unresolved application uncertainty yields:

```text
freezeEligibility = unknown
discardEligibility = unknown
blockers = [application_unknown]
```

### Freeze eligibility

A generated Doc can reach `freezeEligibility = allowed` when it is saved, quiescent, unprotected, and every critical human fact is known.

This earns only the `suspended` experiment. Chrome freeze keeps the page resident, so the measured claim is primarily background scheduling and resume fidelity.

### Discard eligibility

Discard remains `unknown` until the generated fixture class has already demonstrated reload fidelity and the current region can be reacquired.

Only then can the same saved/quiescent state reach:

```text
discardEligibility = allowed
```

and participate in the `reclaimable` experiment.

## Relationship to explicit browser actions

The #136 unbound host already supports explicit operator manual discard with fresh browser preflight. That is useful as the `stock-explicit-discard` control and remains labelled as an operator browser action.

The application-bound managed arm is different:

```text
content-free application binding
  + current human fidelity facts
  + exact lane generation
  + #132 planner decision
  + fresh browser projection check
  -> browser effect
```

This distinction prevents Elatura from claiming that Chrome's discard primitive itself is an application-aware policy improvement.

## Recovery

After freeze/discard/reload/restart:

- recover the browser projection internally;
- verify the exact lane binding/generation;
- return to `responsive` when interaction is requested;
- re-run the human fidelity checks;
- record `verified`, `recoverable`, `recovering`, `attention_required`, or `unavailable` using #132 vocabulary;
- advance generation and rebind whenever continuity cannot be proven.

A missing or stale binding cannot execute a lifecycle decision.

## Start gate for managed #118 arms

Before `elatura-suspended` or `elatura-reclaimable` is treated as a valid physical run:

- the operator-confirmed generated-Doc binding is implemented and generation-bound;
- stale-generation effects are refused;
- the pure Docs eligibility classifier tests pass;
- the browser host re-fetches projection state immediately before the effect;
- planner receipts and browser outcomes are recorded separately;
- content-free evidence admission passes;
- a failed human fidelity result remains valid negative evidence.

Until this gate is implemented, #118 can run stock controls, manual explicit-discard controls, `elatura-observe`, fixture preparation, and application-fidelity probes. Managed lifecycle results remain gated.
