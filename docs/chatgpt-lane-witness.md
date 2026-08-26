# ChatGPT application-lane continuity witness

Status: first ChatGPT application witness for the canonical live-lane model  
Benchmark gate: #116  
Canonical lane identity/runtime: #127 / #142  
Chromium binding/effects: #144 / #148 / #147 / #153

## Purpose

The browser transport can identify and control an ephemeral Chromium projection, while the application-lane runtime owns durable `laneRef + generation`. A missing application fact remained between those layers:

> after a projection reload/recovery, is the authoritative ChatGPT graph still the same conversation graph that this lane generation previously represented?

`@elatura/adapter-chatgpt/lane-witness` answers that narrow question.

It does **not** discover a conversation from a tab id, title, URL, notification, or browser process. A trusted ChatGPT adapter path first obtains and validates the authoritative conversation graph with the existing production inspection validator. The witness then follows the validated active parent chain to its root and retains that root reference as a private local continuity anchor.

## Private witness

For one exact canonical lane generation the private witness contains:

- `laneRef + laneGeneration`;
- current ChatGPT adapter identity/version;
- active-root application reference;
- content-free node count and active-path depth;
- local observation time;
- zero work/dispatch authority.

The root application reference is private application identity. It is runtime/binding state, not benchmark telemetry and not committed evidence. The content-free recovery assessment is the shareable artifact.

The witness uses the active-path root instead of `current_node`. `current_node` is expected to advance as a conversation gains turns; the active root should remain stable for the same validated conversation graph. If the application replaces that graph with a different root, continuity is no longer proven.

## Recovery assessment

A later validated ChatGPT graph is accepted as the same lane generation only when:

1. the canonical lane still uses the current ChatGPT adapter identity;
2. lane ref matches the witness;
3. lane generation exactly matches the witness;
4. observation time does not regress;
5. the current validated active path resolves to the same private root reference.

A match emits:

```text
identityContinuity = verified
recovery = verified
freezeEligibility = unknown
discardEligibility = unknown
blockers = []
```

An anchor/lane/generation mismatch emits attention-required fidelity and blocks aggressive lifecycle transitions.

## Why discard stays unknown

Static conversation graph continuity proves the conversation survived/recovered. It does not prove every transient application condition needed for safe suspension or discard.

A static payload alone cannot establish, for example:

- an active generation/streaming operation is absent;
- composition is inactive;
- uploads/tool UI are settled;
- a modal interaction is absent;
- another application-local transient state will survive discard.

The witness therefore never upgrades freeze/discard eligibility to `allowed`. A later, separately reviewed ChatGPT activity/fidelity sentinel must earn that permission from current application state.

This separation lets the first physical benchmark exercise `responsive` / Keep warm recovery truthfully before deeper reclaim automation exists.

## Relationship to Chromium

The intended flow is:

```text
validated ChatGPT graph
  -> private ChatGPT continuity witness
  -> content-free recovery/fidelity assessment
  -> exact current lane generation
  -> exact current Chromium projection binding
  -> canonical residency planner
  -> generation-owned browser-local effect transaction
  -> fresh browser revalidation / effect receipt
```

Browser tab ids never become ChatGPT identity. The private active-root reference never enters the Chromium service worker.

## Evidence boundary

For #116 shared evidence may record fixed fields such as:

- identity continuity verified / attention-required;
- recovery state;
- lifecycle eligibility;
- blocker class;
- node count / active-path depth when useful and content-free.

It should not record the private root reference, transcript text, titles, URLs, account identifiers, cookies, request bodies, or credentials.

## Next earned packet

After physical Keep warm/reload dogfood proves this continuity witness useful, the next application-specific packet can add the smallest current-state sentinel needed to distinguish `discardEligibility: allowed` from `unknown`.

That packet should stay independent from completion hints: a completion/changed event may justify inspection or a warmer residency request, while transition safety must come from current application fidelity.
