# Selecting Elatura's second real workload

The second real workload should test whether the **application-lane** model transfers to a meaningfully different heavyweight authenticated application.

It does not need to begin as a production adapter. A workload can first exercise stock-browser cost, lifecycle, parking/recovery, bounded DOM/accessibility observation, screenshots, and ordinary human interaction. Application-specific parsing or transformation should arrive only when evidence shows a stable useful seam.

See [`application-lanes.md`](application-lanes.md) for the current product model. Google Docs #118 is the first explicitly human-first research workload under this rubric.

## Two promotion stages

### Lane research

A candidate can enter lane research when it can be exercised safely through a genuine signed-in application using operator-owned or synthetic test data and content-free measurements.

The first questions are:

- does ordinary browser residency or repeated observation become a real constraint at useful scale;
- can Elatura reduce that cost through browser-level working-set/lifecycle control;
- can a human keep using the real application normally while active;
- can a computer-using agent consume the same lane through signals, bounded semantic observation, screenshots, and full application activation;
- does the application already virtualize/park/recover well enough that Elatura adds little value.

### Application-specific adapter promotion

A candidate earns a custom adapter only after lane research identifies application-specific state whose validation, bounded representation, signal extraction, or transformation would materially improve the result.

This keeps generic browser-level wins separate from adapter maintenance cost.

## Selection rule

Choose a workload that exposes reusable live-browser strengths and new failure modes while keeping privacy, legal, and maintenance costs bounded.

A candidate should score strongly enough across the full rubric. A spectacular performance symptom cannot excuse weak authority/recovery semantics, destructive editing risk, or an application that already handles the problem well.

## Scoring

Score each category from 0 to 4:

- `0` — disqualifying or absent
- `1` — weak
- `2` — usable with significant cost
- `3` — strong
- `4` — unusually strong

Apply the listed weight to each category. The maximum weighted score is 100.

| Category | Weight | Question |
|---|---:|---|
| Human pathological value | 15 | Does ordinary human work become slow, crash-prone, inaccessible, or resource-constrained at realistic scale? |
| Live working-set opportunity | 15 | Does the browser/application keep materially more state resident or continuously active than the current task needs? |
| Authority and recovery | 10 | Can Elatura preserve the genuine signed-in application, recover the intended target after discard/restart, and return to a truthful full interaction state? |
| Consumer symmetry | 10 | Can the same managed lane help a human and a computer-using agent without a second browser/session product? |
| Observation diversity | 10 | Does the workload exercise lifecycle signals, DOM/accessibility state, visual state, editing/collaboration, or other requirements beyond ChatGPT? |
| Reproducibility | 10 | Can maintainers create operator-owned, synthetic, or public workloads that reproduce the relevant scale and behavior? |
| Privacy and legal risk | 10 | Can development and testing avoid publishing sensitive content, exporting credentials, evading access controls, or sending private application content to a remote service? |
| Application-specific seam quality | 10 | If deeper intervention becomes useful, is there a stable detectable seam that can be validated and failed open safely? |
| Measurement quality | 5 | Can resident memory, CPU, switching, recovery, observation cost, interaction latency, and fidelity be measured objectively? |
| Maintenance cost | 5 | Can a small project sustain the browser/application-specific work that the winning intervention level actually requires? |

Weighted category score:

```text
(category score / 4) × category weight
```

## Research gates

A candidate can begin observation-first lane research when all of these are true:

- the genuine application and sign-in flow remain authoritative;
- testing uses operator-owned, synthetic, or public data appropriate to the workload;
- committed reports remain content-free;
- browser/profile credentials stay inside the owning browser/application context;
- the stock-browser control workload is reproducible enough for comparison;
- first-phase work is observation and measurement or another reversible browser-level intervention;
- human interaction fidelity has explicit invariants for the workload;
- recovery after navigation/discard/restart can be measured.

This stage does not require the first ChatGPT response transform to be enabled.

## Adapter-promotion gates

Application-specific parsing, representation, or transformation should move beyond research only when the relevant extra gates are satisfied:

- lane research shows a measurable advantage that browser-level control alone cannot deliver;
- synthetic/public fixtures cover the candidate's important application-specific state patterns;
- authoritative input and output validation rules are documented where transformation is proposed;
- required permissions and origins are narrow and inspectable;
- content collection, retention, deletion, and bounded-view boundaries have security review;
- adapter capability declarations match the actual implementation;
- fail-open tests cover unknown schema, partial data, cancellation, oversized input, and output rejection where applicable;
- maintenance ownership is explicit.

## Disqualifiers or strong deferrals

Reject or defer a candidate with any of these traits:

- useful testing requires publishing private user archives;
- authentication depends on exporting cookies, tokens, or browser storage;
- the only useful access path relies on evading access controls or anti-abuse systems;
- a remote service must receive private application content for the proposed benefit;
- edits, collaboration, permissions, or local unsaved state cannot be preserved or restored at the proposed intervention level;
- the ordinary application/browser already solves the working-set problem well enough that Elatura adds little value;
- a proposed application transform has no reliable drift detection or truthful fallback path;
- legal or contractual permission remains unclear after review.

## Candidate archetypes

### Long collaborative documents and knowledge systems

Likely strengths:

- strong ordinary-human productivity test;
- many simultaneously open documents are common;
- current visible/editing region is naturally smaller than the whole document;
- caret/selection, collaboration, comments, autosave, and accessibility exercise new fidelity requirements;
- browser-level parking or observation may help with little custom parsing.

Likely costs:

- rich editing semantics are complex;
- embeds, tables, images, comments, and collaborative cursors broaden compatibility demands;
- mature products may already virtualize effectively.

Google Docs #118 is the current human-first research candidate. A useful result can be “browser-level lane management helps while a Docs adapter adds little.”

### Giant issue or pull-request timelines

Likely strengths:

- natural chronological representation;
- public reproducible fixtures;
- direct jump-back to comments and events;
- paging and revision semantics unlike ChatGPT branches;
- strong candidate for a read-oriented application-specific adapter when browser-level gains alone are insufficient.

Likely costs:

- provider-specific event variants;
- attachments and collapsed-event handling;
- supported APIs or local data may already beat an Elatura bounded view for agent retrieval;
- authenticated private repositories require additional privacy review.

This remains a strong **adapter-diversity** candidate even though Google Docs currently leads the human-first live-browser research lane.

### Large notebooks

Likely strengths:

- expensive outputs provide clear resident/render cost;
- source, output, and execution-order relationships;
- code extraction and visual outputs exercise multiple observation rungs;
- public synthetic notebooks are easy to create.

Likely costs:

- binary media and rich widget semantics;
- local-file and hosted-service transports differ substantially;
- editing/execution state requires careful activation fidelity.

### Log or deployment consoles

Likely strengths:

- extreme volume and clear recent-window policies;
- lifecycle/change signals can prevent repeated full reads;
- public synthetic streams are easy to generate;
- browser-level and application-specific interventions can be compared cleanly.

Likely costs:

- logs often contain secrets and personal data;
- supported APIs or command-line tools often dominate agent retrieval;
- real products use vendor-specific streaming and retention semantics.

## Recommended decision process

1. Define a reproducible stock-browser workload and human fidelity invariants.
2. Observe resource/lifecycle behavior before adding an adapter.
3. Compare stock browser with the cheapest safe Elatura intervention from the application-lane ladder.
4. Record whether the gain comes from browser lifecycle, render/DOM working-set control, bounded semantic observation, or an application-specific seam.
5. Run the same lane through a human interaction scenario first.
6. Let a computer-using agent consume the same lane through event → bounded semantic state → screenshot → full interaction, recording which rungs were actually required.
7. Prototype a custom adapter only when the preceding evidence identifies application-specific value.
8. Run the shared adapter conformance suite for any promoted adapter.
9. Compare the adapter path against supported APIs and ordinary local tools for the exact task it claims to improve.

## Current hypotheses

**Google Docs** is the leading human-first live-application research workload through #118. Its value is the possibility of proving that Elatura can improve ordinary browser work while preserving a rich editing application and simultaneously supplying a useful lane to computer-using agents.

A **giant public issue or pull-request timeline** remains a leading application-specific adapter candidate because it offers public reproducibility, paging, heterogeneous events, revisions, and exact jump-back. PR #115 raises the control bar for agent retrieval: when a clean local representation or supported API already exists, Elatura must beat that simpler route on the claimed task.
