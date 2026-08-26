# Architecture

## Working definition

Elatura is a local adaptive access layer for heavyweight authenticated web applications.

Its runtime unit is an **application lane**: a logical, consumer-neutral managed live view of one useful application target through a genuine signed-in application context.

```text
heavyweight authenticated application
                ↓
        browser/application transport
                ↓
         Elatura application lane
          ↙       ↓        ↘
   working set   signals   observation
          ↘       ↓        ↙
        activation / interaction
                ↓
          human or agent
```

The authenticated application remains authoritative. Elatura owns working-set policy, observation, and access surfaces around that application. See [`application-lanes.md`](application-lanes.md) for the product model and current experiment sequence.

## Identity and projection

Application-lane identity is logical. Browser objects and signed-in browser sessions implement a current access projection of that lane.

Potential durable local identity inputs include:

- an opaque Elatura-local lane key;
- application/adapter class where needed for routing;
- an opaque application-native target/navigation locator where one can be recovered safely and stably enough;
- target freshness/generation state where the application exposes it.

Browser profile/session handles, tab ids, CDP target ids, renderer process ids, window ids, and remote-workspace ids are ephemeral projection handles. The runtime should be able to reacquire a usable projection after navigation, discard, crash, restart, profile replacement, or host migration.

Reusable browser credentials, cookies, authorization material, and provider session secrets remain inside the authoritative browser/application context and never become lane identity.

This contract intentionally differs from a Stensibly work/agent lane. Stensibly owns mission, responsibility, scheduling, dispatch, wake routing, and continuation. An Elatura lane provides application access and observations that Stensibly may consume.

## Components

### Browser/application transports

A transport owns browser-specific access and projection mechanics. Depending on the host, that can include:

- navigation and target discovery;
- request/response observation;
- DOM and accessibility observation;
- lifecycle/discard/freeze state;
- screenshots or screencast primitives;
- focus/activation and explicitly authorized input;
- browser/process resource measurements;
- projection recovery after browser state changes.

Transport code should translate browser-native handles into engine-neutral lane events and observation records. Application graph semantics stay in adapters.

Firefox remains the first and strongest current intervention transport because its WebExtension path exposes `webRequest.filterResponseData()` and the repository has earned Firefox live-DOM discovery, render-window policy, drift handling, content-free instrumentation, and a preflighted destructive executor.

Chromium is an independent transport experiment under #117. Its first value proposition is managed target/lifecycle control, DOM/accessibility reads, screenshots, input, and process observation through a dedicated stock/reproducible profile plus extension/CDP control where required. A Chromium fork sits behind evidence from that prototype.

### Lane runtime

The lane runtime owns generic consumer-neutral concepts:

- logical lane reference and current projection metadata;
- freshness, drift, availability, and recovery state;
- bounded working-set policies;
- bounded observation envelopes and omission metadata;
- content-minimized lifecycle/change signals;
- escalation from semantic observation to visual inspection to activation;
- resource budgets and retained-state accounting;
- fail-open/fallback decisions;
- content-free instrumentation.

The lane runtime does not decide which work exists or which agent runs next.

### Application adapters

Adapters own application-specific knowledge only where the workload earns it.

The existing ChatGPT adapter recognizes and validates candidate conversation graphs and supports staged transformation/representation contracts. Later workloads can stop earlier: a large collaborative document may benefit from browser lifecycle and observation primitives without a custom response adapter.

Adapter capabilities remain explicit. Detection, validation, structural fingerprinting, paging, branch navigation, caching, materialization, output validation, semantic observation, signal extraction, and exact-effect operations are independent capabilities.

A transform-capable adapter follows the existing reviewed pipeline:

```text
detect → validate → fingerprint → plan → materialize → validate output
```

A shared conformance runner checks declarations, determinism, input preservation, fingerprint identity, and independent output validation. Application-specific semantics and resource budgets remain in adapter suites.

See [`adapter-contracts.md`](adapter-contracts.md).

### Working sets and bounded views

A working set is the bounded application state Elatura keeps continuously resident or continuously observed for one lane.

Possible representations include:

- the current live DOM/render region;
- a bounded accessibility or DOM observation;
- a validated application-specific region;
- a small local derived representation;
- a visual viewport or screenshot;
- stock full application state after activation.

The synthetic companion stack already demonstrates bounded replacement state, search/page/navigation operations, provenance/freshness/omission semantics, lifecycle cleanup, and plateau accounting. PR #115 constrains its product role: when a clean local representation already exists, direct local search can be substantially cheaper than an Elatura viewport. Bounded views should earn themselves against the closest simpler control.

### Signals

Signals summarize locally observed lane changes with explicit confidence and freshness. Candidate classes include `changed`, `generating`, `idle`, `possible_completion`, `error`, `drifted`, `parked`, and `recovery_needed`.

The Android completion-hint work is one existing provider-specific signal experiment. Browser DOM/lifecycle observation may supply stronger application-local signals for other workloads.

Signals guide attention. They do not grant submission, project, scheduling, or work authority.

### Activation and interaction

Elatura should preserve a direct route to the genuine application. A consumer can escalate through:

```text
change / lifecycle event
        ↓
bounded application / DOM / accessibility state
        ↓
screenshot / visual inspection
        ↓
full genuine-application interaction
```

A human and a computer-using agent should consume the same lane through the same authoritative application access path. Screenshots are one rung in the ladder, used when pixels contain useful information beyond cheaper semantic observation.

### Cache and derived local state

Cache entries and local representations are derived copies. Existing envelopes keep origin/profile/adapter isolation, adapter compatibility, structural fingerprint compatibility, opaque content identity, freshness, expiry, and provenance separate.

Persistent private-content caching remains behind the security and privacy release gate. A lane can deliver value through browser-level working-set and observation control with zero persistent private-content cache.

See [`cache-and-provenance.md`](cache-and-provenance.md).

## Intervention levels

Observation and intervention should remain separate. The current candidate escalation order is:

1. stock application with content-free observation;
2. browser lifecycle management or parking where application fidelity survives;
3. render suppression for expensive inactive regions;
4. bounded live DOM/accessibility retention or replacement;
5. validated local representation for selected reading/navigation tasks;
6. response/network transformation behind existing safety gates;
7. focused browser shell after stock-browser evidence identifies browser-level policy or chrome as the remaining constraint.

Every workload can stop at its cheapest useful level.

The older `observe` / `safe` / `cached` / `full` names remain useful for the response-transformation subsystem. They should not become the global application-lane lifecycle vocabulary.

## Human fidelity

A lane is a product feature only when ordinary interaction remains truthful at its active level. Workloads with editing or collaboration must preserve the state users rely on, such as caret/selection, unsaved edits, autosave state, comments, collaboration/presence, permissions, current visual region, and application errors.

When an intervention cannot prove those invariants, Elatura should use a cheaper observation-only level or restore the stock application before interaction.

## Second workload

The second real workload should test the live application-lane model, not merely the adapter abstraction.

Google Docs #118 is the first explicitly human-first research workload. It can begin with observation and browser-level lifecycle measurements before ChatGPT response transformation is enabled. A custom Docs adapter is earned only by evidence of a stable useful application-specific seam.

See [`second-workload-rubric.md`](second-workload-rubric.md).

## Browser-engine position

Elatura remains engine-neutral above the transport boundary.

Firefox keeps its earned role as the response/DOM intervention specialist and stock baseline. Chromium is being evaluated for managed lifecycle, broad web-application compatibility, accessibility/DOM observation, screenshots, input, and process control. WebKit can remain a later supplementary transport experiment.

Building or maintaining a browser engine or Chromium fork would add browser security, update, sandbox, media, accessibility, networking, permission, profile, and compatibility responsibilities. The current evidence calls for stock browser engines plus Elatura control first.

The older capability record remains in [`transport-capability-matrix.md`](transport-capability-matrix.md); #117 owns the current Chromium comparison.

## Terminology note

Several existing `packages/core` modules use `orchestration` to name the local detect/validate/plan/materialize control flow. That is an implementation-era name for a bounded transformation pipeline.

Product-facing documentation should use **pipeline** or **runtime control flow** for those modules. Stensibly owns work orchestration, scheduling, dispatch, and continuation across agents/projects.
