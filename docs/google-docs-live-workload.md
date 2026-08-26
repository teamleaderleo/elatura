# Google Docs live application workload

Status: research and dogfood only. Parent: #118. Comparison frame: #116. Chromium transport input: #117. Product model: `docs/application-lanes.md` (#119). Consumer contract: `@elatura/core/application-lane` (#127). Residency planner: `@elatura/core/application-lane-lifecycle` (#132).

## Question

Can Elatura let a human keep substantially more genuine Google Docs working documents available in Chrome while preserving ordinary editing, autosave, undo/redo, caret and selection behavior, collaboration, and quick return to work?

The official signed-in application remains authoritative for document content, permissions, edits, collaboration, save state, and current interaction. Browser tab, target, renderer, window, profile, extension, and CDP handles remain internal projections.

Google Docs stays a research workload. This packet authorizes observation and measured browser-native lifecycle experiments. It creates zero Docs response adapter, alternate editor, response rewrite, credential export, or network interception path.

## Reconciled application-lane model

Each generated Doc is one application lane with the merged consumer identity:

```text
laneRef + laneGeneration
```

The generic consumer surface remains `status`, `observe`, `activate`, and `screenshot`. Every event and operation response carries:

```text
grantsWorkAuthority = false
authorizesWorkDispatch = false
```

The residency policy from #132 supplies the generic browser-resource vocabulary. #118 records those exact facts instead of inventing a Docs-only lifecycle model.

### Requested availability

The shared requested intents are:

- `responsive` — keep the lane loaded and runnable;
- `suspended` — permit an earned resident freeze;
- `reclaimable` — permit discard once reload fidelity has been proven.

These are desired postures. They remain separate from current browser facts.

### Browser and recovery facts

#118 records the shared browser residency:

```text
foreground | background | frozen | discarded | reloading | missing
```

and recovery state:

```text
verified | recoverable | recovering | attention_required | unavailable
```

Freeze and discard eligibility are separate:

```text
allowed | blocked | unknown
```

with the shared blocker vocabulary:

```text
active_generation
unsaved_interaction
save_in_progress
composition_active
modal_interaction
collaboration_active
media_or_device_active
download_active
application_unknown
manual_protection
```

Unknown eligibility never authorizes an aggressive transition.

### Planner receipt

When an Elatura residency request exists, the benchmark records the shared planner action and reason bound to the exact lane generation. The planner can return:

```text
none | wake | freeze | discard | recover_projection | wait | attention_required
```

The browser transport performs the selected effect separately. The benchmark also records the browser action that actually occurred.

Stock controls and `elatura-observe` contain no lifecycle planner request/decision. This keeps browser primitives and Elatura policy distinguishable.

### Attention stays separate from permission

Application-lane events retain the #127 vocabulary and confidence/freshness. A `changed` or `possible_completion` event can motivate a consumer to request a warmer posture. It does not grant freeze/discard permission. Current lifecycle eligibility remains the authority for browser-resource transitions.

## Useful-document capacity

A tab in the tab strip is only a browser projection. The product metric is useful working documents.

A document counts as useful at a recovery probe when all applicable checks succeed:

- the expected `laneRef + laneGeneration` resolves to the intended signed-in Doc;
- activation reaches a trustworthy editable state without account repair;
- the expected generated anchor/current region is reachable;
- workload fidelity checks succeed;
- lost ephemeral interaction state is surfaced as `attention_required` / `recovery_needed` evidence;
- recovery latency, reload cost, and operator-visible failures are recorded.

The benchmark preserves stable `laneRef` per document ordinal and requires lane generations to move monotonically through one run.

## Existing Docs and Chrome behavior

Google moved Docs from HTML-based document rendering to canvas-based rendering in 2021, citing performance and cross-platform consistency. Google also warned that integrations coupled to the previous HTML implementation could break. Current Docs accessibility guidance describes focus-local semantic exposure while distant content can be absent for performance.

Official references:

- https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html
- https://support.google.com/docs/answer/1632199

This makes raw DOM reduction a weak primary target. Docs already performs significant viewport-local work while its editor model, history, collaboration state, caches, and browser allocations can remain elsewhere.

Chrome supplies distinct lifecycle behaviors:

- hidden/background tabs remain loaded;
- frozen tabs remain resident while freezable work is suspended;
- discarded tabs unload page resources and reload on activation;
- Memory Saver applies Chrome's own inactive-tab policy;
- `chrome.tabs` exposes lifecycle metadata and explicit discard;
- experimental CDP `Page.setWebLifecycleState` can request `frozen`/`active` for the controlled compatibility experiment.

Official references:

- https://support.google.com/chrome/answer/12929150
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setWebLifecycleState

Docs automatically saves online edits as the user works. With offline editing enabled, edits can remain profile-local and synchronize later.

- https://support.google.com/docs/answer/49114
- https://support.google.com/docs/answer/6388102

## Cost map to test

Treat high RAM as a retained-cost observation, never as a leak conclusion.

| Scope | Likely cost | Primary owner | Useful discriminator |
| --- | --- | --- | --- |
| Chrome browser process | tab/session metadata, storage coordination, network/cache bookkeeping, service-worker coordination | Chromium | whole process-tree memory and process inventory as document count changes |
| Docs renderer | V8 isolate, editor model, formatting/edit state, undo history, collaboration state, listeners, canvas-related app state | Docs inside renderer | renderer resident bytes and bounded heap probes |
| Renderer native allocations | Blink/V8 native allocations, DOM wrappers, text/font support, canvas backing objects | mixed | renderer resident bytes versus reported JS heap |
| GPU process | raster surfaces, textures/canvas backing, compositing resources | mixed | GPU resident bytes during viewport traversal and idle |
| Current document region | raster work, caret/selection, overlays, menus, focus-local accessibility | mixed | active/background deltas and navigation probes |
| Collaboration/background work | presence, live-edit delivery, save reconciliation, timers/network callbacks | Docs + browser scheduling | background CPU/network and two-session generated-doc trials |
| Shared caches/services | fonts, compiled code, network cache, utility services | Chromium/shared | growth outside mapped Docs renderers |

One large text-heavy document primarily tests editor/application state and current-region caches. Eight open documents add repeated application instances, per-document edit state, process/target overhead, and background save/collaboration work.

Process assignment can change between Chrome revisions. Record actual mappings instead of assuming one renderer per tab.

## Human fidelity fence

A useful policy must preserve or truthfully recover:

- lane/document identity and authentication;
- edit permission and Editing/Suggesting mode;
- current generated anchor/region;
- caret and text selection;
- IME/composition transaction;
- local edits waiting for save/offline synchronization;
- autosave/saved/offline state;
- undo/redo continuity expected by the active editing session;
- open comment/suggestion drafts and anchors;
- collaboration presence and incoming edit reconciliation;
- permissions/share state;
- find/navigation state;
- dialogs, menus, and transient text-entry controls;
- application error/offline state;
- browser profile and Docs storage state.

The primary experiment applies zero application mutation while a Doc is active.

Routine aggressive actions begin only with generated research Docs classified as saved/quiescent. Active composition, pending edits, save-in-progress, transient editors, active collaboration, or uncertain offline state become lifecycle blockers or unknown eligibility.

A failed fidelity probe remains valid evidence and becomes attention-required/recovery-needed state. It never silently promotes the transition into routine eligibility.

## Docs-specific facts supplied to the shared planner

The merged lifecycle planner owns generic `freezeEligibility`, `discardEligibility`, blockers, actions, and reasons. #118 adds content-free human probes used to derive/review those facts:

```text
autosaveState = saved | saving | offline | unknown
localEditPending = yes | no | unknown
compositionActive = yes | no | unknown
selectionPresent = yes | no | unknown
transientEditorActive = yes | no | unknown
collaborationActive = yes | no | unknown
viewportAnchorAvailable = yes | no | unknown
```

Routine and adversarial probes are tagged separately. The first conservative policy maps obvious unsafe/uncertain human state to blocked/unknown eligibility; later evidence may narrow blockers only after repeated fidelity trials.

## Why cosmetic reductions do not count

Docs canvas rendering and focus-local accessibility mean a small DOM/AX tree can coexist with a large retained editor model, renderer-native allocations, GPU resources, service-worker activity, or shared browser caches.

Interpret diagnostics this way:

- DOM nodes fall while renderer resident bytes and JS heap stay flat: cosmetic DOM reduction;
- background CPU falls under freeze while resident bytes stay similar: scheduling win;
- renderer exits after discard and whole-browser memory falls: real reclamation with reload cost;
- whole-browser memory falls while Docs heap stays similar: Chromium/shared reclaim;
- JS heap rises with generated character count while DOM nodes stay flat: retained application model dominates that delta;
- GPU memory moves during viewport traversal while JS heap stays flat: raster/cache behavior dominates that delta.

## Measurement packet

Use the dedicated signed-in Chromium profile from #117. Commit bounded numbers and fixed tokens only.

### Primary physical measurements

- whole Chrome process-tree RSS/PSS/private bytes or closest OS equivalent;
- system available memory and swap/pagefile use;
- major page-fault/pressure indicator where available;
- process inventory and CPU deltas by process type;
- renderer/site PIDs serving Docs targets, including shared mappings;
- service-worker process/running state where observable;
- native lifecycle state and renderer exits/spawns;
- GPU process resident bytes when exposed;
- background network bytes around transitions;
- reload request count/transferred bytes;
- activation-to-visible latency;
- activation-to-editable latency;
- recovery CPU burst;
- unexpected reload/operator-visible failure counts.

Whole-browser OS memory is authoritative for the resource result. Per-renderer values remain diagnostics because same-site pages may share processes.

### Bounded diagnostics

Use short probes for:

- `Memory.getDOMCounters` documents/nodes/listeners;
- `Runtime.getHeapUsage` or equivalent bounded isolate heap metric;
- target/frame count;
- service-worker wake/running samples;
- request/stream activity when cheaply observable;
- accessibility evidence in a separate short profiling pass;
- screenshot latency only in the later attention experiment.

References:

- https://chromedevtools.github.io/devtools-protocol/tot/Memory/
- https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage
- https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/#method-getProcessInfo
- https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/

### CDP by short lease

Steady-state observation should use ordinary browser/extension metadata when sufficient. Persistent debugger attachment is excluded by the run contract.

When a capability requires CDP—bounded diagnostics, experimental freeze, later screenshot—attach for that operation, use a deadline, tolerate detach, then release. Opening DevTools or losing the lease must leave the lane usable.

Reference: https://developer.chrome.com/docs/extensions/reference/api/debugger

### Primary-run exclusions

`Memory.prepareForLeakDetection` changes the renderer by terminating workers, stopping spellcheckers, dropping caches, and forcing garbage collection. Full heap/DOM snapshots, continuous AX capture, screencasts, and persistent screenshots stay outside the primary run.

## Physical memory versus deterministic counters

Browser memory has GC, allocators, cache eviction, process reuse, OS compression, and paging noise.

For physical memory:

- preserve every raw sample;
- run at least five matched repetitions per selected cohort;
- compare distributions, slopes, capacity points, and recovery costs;
- use first-half/second-half trends as descriptive evidence;
- establish the local noise envelope before setting hard percentage gates.

Strict deterministic plateau rules remain appropriate for Elatura-owned counters when those counters exist.

## Capacity curve

Use prefixes of the eight generated Docs and measure requested counts:

```text
0, 1, 2, 4, 8
```

At each point record:

- requested documents;
- useful/recoverable documents;
- foreground/background/frozen/discarded/reloading/missing counts;
- attention-required count;
- whole-browser resident bytes;
- system memory/swap pressure;
- idle/background CPU;
- renderer/service-worker counts;
- recovery p50/p95 and reload cost.

Alternate cohort order where practical so cache/temperature/order effects become visible.

## Memory/restore/fidelity frontier

For inactive revisit intervals:

```text
30 s, 2 min, 10 min, 60 min
```

measure:

- incremental resident memory over the inactive interval;
- background CPU/network;
- reload bytes/requests;
- activation-to-visible/editable;
- recovery CPU/peak memory;
- fidelity outcome;
- manual attention required.

A policy earns a human capacity result when it moves this frontier beyond stock Chrome for useful documents at realistic revisit intervals.

## Matched controls and Elatura arms

### `stock-resident`

Memory Saver off. Leave inactive Docs loaded. No application-lane residency request or planner decision is recorded.

### `stock-memory-saver`

Record Chrome Memory Saver level and let Chrome choose inactive-tab deactivation. No Elatura planner decision.

### `stock-explicit-discard`

Primitive control. After the same simple saved/quiescent operator confirmation used in the first Elatura discard trial, explicitly invoke Chrome discard and record reclamation/recovery. No Elatura residency request or planner decision.

This arm prevents Elatura from receiving credit for Chrome's reclamation primitive.

### `elatura-observe`

Memory Saver off. Add bounded application-lane status/events/receipts only. No residency request or planner decision. Measure observer tax.

### `elatura-suspended`

For the selected eligible inactive generated lane, request `suspended` from the merged residency planner. Record current facts, planner decision/reason, then perform the selected browser action.

The first targeted experiment expects a `freeze` decision for an eligible background lane where the Chromium transport exposes the capability. Frozen pages remain resident, so this arm primarily tests CPU/background-work reduction and resume fidelity.

### `elatura-reclaimable`

For the selected generated lane whose discard fidelity is proven, request `reclaimable`. Record current facts, planner decision/reason, then perform the selected action.

This tests policy value around the same browser primitives: safe selection, process-aware reclamation opportunity, durable recovery, and truthful attention outcomes. A resource win requires a better useful-document memory/recovery/fidelity frontier than stock Memory Saver and stock explicit discard.

### Responsive return

Before interaction with a suspended/reclaimed lane, request `responsive` when the consumer needs a warm runnable lane. The shared planner can choose wake/recover/wait/attention-required according to current facts and capabilities.

## Adversarial eligibility probes

Run separate generated-document probes while:

- an edit is visibly saving;
- a caret/selection is active;
- IME composition is active where available;
- a comment/suggestion editor is open;
- collaboration is actively changing the document;
- the browser is offline with a local edit pending.

Record `probeClass: adversarial`, the Docs-specific facts, shared blockers, eligibility, and recovery outcome. One successful adversarial trial does not automatically make that condition routine-safe.

## Reproducible fixture generator

Run:

```bash
node scripts/generate-google-docs-workload.mjs --out /tmp/elatura-google-docs-v1
```

The generator produces deterministic ASCII text plus a local manifest containing file names, code-unit counts, paragraph counts, anchor counts, and SHA-256 digests.

Generated fixtures:

- `docs-large-text-v1.txt`: 4,800 fixed-width paragraphs, 772,800 text code units, 10 searchable anchors;
- `docs-switch-8-v1-01.txt` through `docs-switch-8-v1-08.txt`: 1,800 fixed-width paragraphs each, 289,800 text code units each, 10 searchable anchors each.

Upload each generated file to the dedicated research Drive account and convert it with Google Docs. Keep converted Docs private to the research identities. Committed evidence contains generated fixture metadata and fixed verdicts only.

## Workload A — `docs-large-text-v1`

Purpose: characterize one large text-heavy editable Doc and Docs' own viewport behavior.

1. Open the generated Doc and wait until editable/saved.
2. Record a sample after 30 seconds idle.
3. Find anchors 00, 05, 09 in sequence; sample after each region settles.
4. At anchor 09 insert `ELATURA_EDIT_01`; record edit echo and save-settled latency.
5. Undo/save, redo/save; record verdicts.
6. Place caret after the canary and select its final four characters. Switch to a neutral local tab for 30 seconds, return, and record caret/selection/viewport continuity plus activation latency.
7. Run 10 anchor-navigation cycles across 00/05/09; sample after each full cycle.
8. Leave active and idle five minutes; final sample.

Primary text run contains no comments, suggestions, images, add-ons, or collaborators.

## Workload B — `docs-switch-8-v1`

Purpose: fixed-eight repeated human switching.

Setup:

- eight converted generated Docs;
- one tab per Doc in the same dedicated profile/window;
- all eight visited, editable, and saved before recorded rounds;
- fixed order 01–08;
- one stable local `laneRef` per Doc.

One cycle:

1. Activate lane/tab and record activation-to-visible/editable.
2. Search for anchor `(cycle mod 10)` and move caret there.
3. First recorded visit: insert per-doc canary such as `ELATURA_D03_EDIT_01`, save, undo, redo, save.
4. Later visits: move caret and make a four-character selection around the existing canary.
5. Record one raw sample after the required human check.

Run:

- four unrecorded warm-up cycles;
- eight recorded cycles;
- exactly 64 raw samples;
- preserve emission order;
- run all six matched arms independently.

## Workload C — `docs-switch-capacity-v1`

Use prefixes of the same eight Docs at requested counts `0, 1, 2, 4, 8`.

At each count:

1. establish no-Docs browser baseline or hydrate the requested prefix;
2. fully visit every requested Doc;
3. warm ordinary switching;
4. record steady active/inactive samples;
5. probe recovery from observed residency classes;
6. report useful count, whole-browser cost, and recovery distribution.

This is the primary #116 capacity curve.

## Revisit recovery probes

For arms with lifecycle behavior, run the same generated Doc after 30s, 2m, 10m, and 60m inactivity.

Record:

- exact lane ref/generation;
- requested intent where present;
- browser residency and recovery state;
- freeze/discard eligibility and blockers;
- planner action/reason where present;
- latest lane event confidence/freshness;
- process exit/spawn/reuse;
- service-worker/background activity;
- reload bytes/requests;
- activation-to-visible/editable;
- recovery CPU/peak memory;
- document/authentication/viewport fidelity;
- attention-required/recovery-needed outcome.

## Collaboration subtest

Use two dedicated generated research identities and one generated switching Doc.

1. Session A edits/saves a generated canary.
2. Put A into tested background/suspended state only when eligibility permits.
3. Session B edits another generated anchor.
4. Return A to responsive/foreground state.
5. Record remote-edit delivery, identity, caret/selection behavior, save state, collaboration continuity.

Repeat an adversarial active-collaboration probe and retain `collaboration_active` as a blocker until evidence supports any narrower rule.

## Offline subtest

1. Enable supported Docs offline mode in the dedicated profile.
2. Make a generated edit while offline and verify the UI's local/offline state.
3. Keep routine discard eligibility blocked/unknown while that local edit is pending.
4. Run an explicit adversarial lifecycle probe.
5. Reconnect and verify synchronization.
6. Record fixed save/offline/fidelity verdicts only.

## Rich-content follow-up gate

The first fixtures are text-heavy to isolate editor/application residency and browser lifecycle from media variability.

Create a deterministic rich-content fixture only if text-only evidence leaves a meaningful resident gap. Then repeat browser-level controls with tables/images/comments or another evidence-selected cost source.

## Resource result versus attention result

Report separately.

### Human resource result

How many useful working Docs remain available at what whole-browser resident cost, background cost, and recovery latency under stock Chrome versus Elatura residency policy?

### Attention result

After human resource/fidelity evidence succeeds, test whether application-lane events and bounded `observe` calls reduce unnecessary human/agent activations:

```text
lane event
  -> bounded observe when useful
  -> screenshot when useful
  -> activate genuine Doc
```

The same lane remains the application source. Events and receipts continue to grant zero work/dispatch authority. Stensibly decides whether observations wake work.

## Decision outcomes

### `browser-lifecycle-only`

Stock browser primitives already reclaim the relevant RAM and recovery is faithful. Elatura contributes eligibility, lane identity, planner/recovery receipts, process-aware selection, and attention events. Ship zero Docs in-page adapter.

### `protected-active-with-post-save-parking`

Active/pending editing needs `responsive`; saved/quiescent Docs can become `reclaimable` and recover faithfully.

### `live-middle-mode-worthy`

Discard recovery loses valuable interaction state or costs too much while a large resident gap remains between responsive/suspended and discarded. Only this result opens a later minimally invasive resident middle-mode investigation.

### `browser-app-already-efficient`

Chrome/Docs already keep useful capacity efficient enough that added intervention has too little benefit. Keep Docs as a negative control and direct effort elsewhere.

## Kill criteria for Docs-specific in-page work

Stop Docs-specific slimming research when:

- stock Memory Saver/explicit discard gives comparable useful capacity and recovery;
- beating stock requires reverse-engineering Docs canvas/editor/collaboration internals;
- DOM/AX reduction creates little whole-browser memory improvement;
- maintenance/privacy cost exceeds measured human benefit.

A browser-lifecycle-only result strengthens the application-lane thesis because application adapters remain optional and earned.

## Content-free evidence contract

`benchmarks/schema/benchmark-google-docs-live-run-v1.schema.json` and `benchmarks/src/google-docs-live-manifest.ts` record/validate:

- generated fixture and requested Doc count;
- matched arm and exact browser/profile tokens;
- raw process/memory/CPU/network/reload/recovery samples;
- `laneRef + laneGeneration`;
- exact #132 intent, browser residency, recovery, eligibility, blockers, planner action/reason;
- exact #127 event type/confidence/freshness with zero work/dispatch authority;
- Docs-specific content-free human facts;
- routine/adversarial probe class;
- useful/attention-required counts;
- human fidelity verdicts;
- privacy flags pinned to false;
- `persistentDebuggerAttached: false`.

The parser imports the shared application-lane/lifecycle enums directly, preventing vocabulary drift. It also requires stable lane refs and nondecreasing generations within a run.

Validate scratch manifests with:

```bash
npm run benchmark:google-docs-live -- /path/to/run.json
```

The checker validates evidence admission. Recorded fidelity failures remain valid evidence.

## Smallest falsifiable sequence

1. Run `stock-resident`, `stock-memory-saver`, `stock-explicit-discard` on generated Docs.
2. Measure `elatura-observe` tax with zero residency request.
3. On one saved/quiescent generated lane, request `suspended`; record planner decision and Chromium freeze/resume fidelity/background cost.
4. On one proven reload-safe generated lane, request `reclaimable`; record planner decision, discard/recovery, memory, and fidelity.
5. Compare against stock controls on useful-document capacity and the memory/restore/fidelity frontier.
6. Run the fixed-eight rotation only after single-lane lifecycle behavior is truthful.
7. Run the `0/1/2/4/8` capacity sweep and revisit intervals.
8. Open deeper Docs-specific intervention only if a meaningful live-resident gap survives those controls.

This sequence answers #118 without building a replacement Docs client.
