# Elatura application lanes

Status: product-direction decision record  
Last reviewed: 2026-08-27  
Primary experiment: #116  
Transport comparison: #117  
Human-first dogfood: #118

## Product direction

Elatura should become a local adaptive access layer for heavyweight authenticated web applications.

Its live unit is an **application lane**: a consumer-neutral managed view of one useful application target through a genuine signed-in application context.

```text
heavyweight authenticated web application
                ↓
      Elatura application lane
                ↓
      bounded live working set
      change / lifecycle signals
      bounded DOM / accessibility observation
      screenshot when visual state is useful
      genuine application activation and interaction
                ↓
          human or agent
```

The signed-in application remains authoritative for content, permissions, collaboration state, edits, submissions, and provider behavior. Elatura manages the cost of keeping that application available and the amount of state a consumer needs to inspect before acting.

This direction grows directly from the Firefox slimming, bounded companion, lifecycle, notification-hint, persistent-browser, and agent-viewport work already in the repository. It gives those pieces one product boundary without promoting every experiment into a permanent subsystem.

## Lane identity

A lane is a logical application-access unit. Browser implementation objects are projections of that unit.

A durable lane reference should eventually identify only enough local context to recover the intended application target, for example:

- an opaque Elatura-local lane key;
- application/adapter class where needed for routing;
- an opaque application-native target/navigation locator when one can be recovered safely and stably enough;
- target freshness/generation information where the application exposes it.

The current signed-in browser/application session is a runtime access binding, not lane identity. Browser profile/session handles, tab ids, CDP target ids, renderer process ids, window ids, remote-workspace ids, and similar handles belong to the current projection. They can disappear and be reacquired after navigation, discard, crash, restart, profile replacement, or host migration.

Reusable browser credentials, cookies, authorization material, and provider session secrets stay inside the authoritative browser/application context and never enter the lane reference.

This distinction also keeps an Elatura application lane separate from a Stensibly work or agent lane. Stensibly may retain a reference to an Elatura lane; Elatura does not inherit mission, ownership, scheduling, or dispatch authority from that association.

## Consumer symmetry

The same lane should support ordinary human work and computer-using agents.

For a human, useful outcomes include:

- keeping more heavyweight applications or documents available on one machine;
- returning quickly to the current useful region;
- preserving normal signed-in interaction while active;
- seeing simple local state such as active, parked, changed, drifted, unavailable, or recovery-needed;
- recovering cleanly when an optimization no longer applies.

For an agent, useful outcomes include:

- learning which application lane deserves inspection without reading every live page;
- requesting a bounded semantic region before paying for pixels;
- requesting a screenshot when visual state carries information the semantic view misses;
- activating and operating the genuine application when interaction or verification requires it;
- receiving explicit freshness, omission, and recovery state from any bounded view.

Human and agent consumers should share the same authoritative application access path and intervention policy. Agent use should not require a parallel browser product with a second copy of application state.

## Observation ladder

Elatura should expose the cheapest sufficient observation first.

```text
change / lifecycle event
        ↓
bounded application state, DOM, or accessibility region
        ↓
screenshot / visual inspection
        ↓
full genuine-application interaction
```

Each rung is optional. A signal can be enough to leave a lane alone or direct attention elsewhere. A bounded DOM/accessibility read can be enough to choose the next action. Pixels remain available for visual semantics. Full application interaction remains the final source for exact current behavior.

Useful signal classes may include:

```text
changed
generating
idle
possible_completion
error
drifted
parked
discarded_or_unavailable
recovery_needed
```

Signals are local observations with explicit confidence and freshness. They carry application or work authority only when the authoritative application itself supplies that authority through a separately reviewed exact-effect path.

## Intervention ladder

Observation and resource intervention are separate decisions. Elatura should stop at the cheapest intervention that produces a measured gain while preserving application fidelity.

A candidate escalation order is:

1. stock application with content-free observation;
2. browser lifecycle management and lane parking where application semantics survive;
3. render suppression for expensive inactive regions;
4. bounded live DOM/accessibility retention or replacement;
5. validated local representation for specific reading/navigation tasks;
6. application-response or network transformation behind its existing safety gates;
7. a focused browser shell only after stock-browser control demonstrates that browser-level policy or chrome is the remaining constraint.

A workload may stop anywhere on this ladder. Google Docs may prove useful at browser lifecycle level with zero custom response adapter. ChatGPT may justify deeper application-specific intervention because the repository already has graph validation and Firefox response-stream research.

## What existing work means now

### Firefox remains earned product value

Firefox supplied Elatura's first unusually strong primitive: `webRequest.filterResponseData()`. The repository also has bounded live DOM discovery, render-suppression/window planning, drift handling, content-free metrics, and a preflighted destructive executor.

Firefox therefore remains the best current laboratory for in-browser response and DOM intervention, plus the stock-Firefox baseline for #116. Chromium work should add capabilities and comparison evidence instead of rewriting that history.

### Chromium is a transport experiment

#117 should evaluate a stock or reproducible Chromium-family binary with a dedicated profile, extension, and local CDP control where required. Its strongest candidate value is target/lifecycle observation, accessibility/DOM reads, screenshots, activation, input, and process control across applications.

A Chromium fork remains evidence-gated. Compile-time browser removal work becomes relevant only after the stock managed profile shows that browser-owned services are the dominant remaining cost.

### The companion surface is a bounded-view primitive

The synthetic companion/browser work proves bounded replacement state, provenance/freshness/omission contracts, paging/search/navigation, lifecycle cleanup, and plateau measurement.

PR #115 also produced a decisive constraint: when a clean local JSONL representation already exists, ordinary local search beat the bounded agent viewport on the held-out task. Elatura should use direct local/API tools in that region.

The companion becomes interesting again when a bounded semantic view saves a live authenticated application read, helps a human navigate an oversized application, or provides a cheaper rung before pixels. It is one lane surface, not the default product shell.

### Android completion hints are optional signal inputs

The Android work proves that bounded content-minimized completion hints can be handled conservatively. Such hints can feed a lane's observation state when physical-device evidence supports them.

Provider notification identity stays advisory. Lane identity comes from the logical application target and can survive missing, grouped, delayed, or ambiguous notification events. Correlation into the current authoritative browser/application projection remains explicit and confidence-bounded.

### Persistent remote Firefox is a host/offload option

#94 preserves a useful idea: one genuine browser/profile can remain alive while thin clients reconnect and device-side hydration disappears. In the lane model this is a host choice and cross-device continuity experiment.

Remote display alone leaves the heavyweight browser working set intact. #116 supplies the separate test for reducing that host-side cost.

## Portfolio boundary

Elatura owns:

- signed-in application access through reviewed browser/application transports;
- logical lane reference and projection recovery;
- browser/application working-set policy;
- local lifecycle and change observation;
- bounded DOM/accessibility/application views;
- screenshots and computer-use host integration;
- activation/jump-back into the genuine application;
- freshness, drift, omission, and recovery state;
- adapter-specific intervention where evidence earns it.

Stensibly owns:

- work and agent lanes;
- mission and responsibility;
- hierarchy and ownership;
- scheduling, dispatch, wake routing, and continuation;
- authority to decide which work runs next.

Elatura can emit `changed` or `possible_completion`. Stensibly decides whether that observation should wake or dispatch work.

Project memory, reusable evidence selection, and long-lived work narratives live outside the Elatura lane contract.

## Experiment sequence

### 1. Define the live-lane contract before expanding implementation

#116 should pin a content-free experiment manifest covering:

- opaque logical lane reference versus current browser/session projection ids;
- application-native target/navigation locator class without reusable credentials;
- lane freshness and recovery state;
- current intervention level;
- emitted signal class and confidence;
- bounded-read, screenshot, and full-activation counts;
- browser/process resource measurements;
- human interaction fidelity and recovery outcomes.

Avoid inventing a durable service database for the first packet. The benchmark needs enough identity to correlate one run and recover a current target; it does not need project memory.

### 2. Reuse Firefox for the first live comparison

Use the existing pathological ChatGPT workload and compare stock Firefox with the safest currently earned Elatura level. Measure the real browser resident cost, repeated switching plateau, return-to-current-region latency, and application fidelity.

Derive only the smallest live signals already justified by existing page/lifecycle observation. Record which signals would have prevented a useless inspection.

### 3. Evaluate Chromium without a fork

Run #117 as a managed stock/reproducible Chromium profile. Start observation-first: targets, lifecycle, accessibility/DOM, screenshots, activation/input, process measurements, and restart recovery.

Compare its lane semantics with Firefox. Treat transport-specific strengths as complementary until evidence supports a primary host decision.

### 4. Run the human-first Google Docs test

#118 should begin with observation and matched stock-browser measurements. Test browser-level parking/recovery and bounded observation before creating a Docs adapter.

The first success criterion is ordinary human work: several large documents stay available, edits/caret/autosave/collaboration remain truthful, and returning to a lane stays responsive. Agent access then consumes the same lane through the observation ladder.

### 5. Test multi-lane attention only after single-lane fidelity

Once one ChatGPT lane and one human-first workload have interpretable measurements, test several simultaneous live lanes. Compare blind tab rotation with signal-directed inspection and record:

- unnecessary lane visits;
- false-positive and missed attention signals;
- bounded semantic reads;
- screenshots;
- full application activations;
- resident resource plateau;
- recovery after discard/restart;
- human usability under the same lane policy.

Stensibly can consume this experiment later without moving scheduling logic into Elatura.

## Promotion criteria

The application-lane direction earns broader product investment when evidence shows both sides of the symmetry:

- a human can keep or use heavyweight applications more effectively through the lane policy; and
- a computer-using agent gains useful attention/observation/interaction access to the same live application state with fewer unnecessary reads or less resident cost than ordinary fully loaded browser use.

The lane should also recover across ephemeral browser projection changes, preserve application authority, and make drift or intervention failure explicit.

If the live browser comparison shows little gain, retain the earned Firefox rescue/slim work for human pathological cases and keep agent access close to ordinary browser/computer use. PR #115 already establishes that Elatura should avoid competing with direct local search where a clean local representation exists.

## Terminology cleanup

Use these product-facing terms going forward:

- **application lane** — logical managed live access unit;
- **browser projection** — current profile/session/tab/target/window/process realization of a lane;
- **working set** — bounded currently retained/observed application state;
- **signal** — local observation with confidence/freshness;
- **bounded view** — semantic/DOM/accessibility/application region with explicit omission;
- **activation** — return to the genuine interactive application.

Legacy `orchestration` module names in `packages/core` refer to the local detect/validate/plan/materialize pipeline. Product documentation should call that work a pipeline or runtime control flow so it cannot be confused with Stensibly scheduling and dispatch.
