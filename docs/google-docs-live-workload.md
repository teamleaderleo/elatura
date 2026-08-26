# Google Docs live application workload

Status: research and dogfood only. Parent: #118. Comparison frame: #116. Chromium transport input: #117.

## Question

Can Elatura let a human keep substantially more genuine Google Docs working documents available in Chrome while preserving ordinary editing, autosave, undo/redo, caret and selection behavior, and collaboration?

This packet treats Google Docs as the human-facing application. The official site remains the editing surface and sole source of application authority. Elatura starts as an observer and may exercise browser-native lifecycle controls only after the stock measurements are complete.

## Current evidence and first decision

Google migrated Docs from HTML-based document rendering to canvas-based rendering in 2021, explicitly citing performance and cross-platform consistency. Google also warns that extensions tied to Docs' HTML implementation can break as the UI changes. Current accessibility guidance says headings and links near the current focus are exposed while distant content can be absent because of performance optimizations. Together, those facts show that Docs already performs significant viewport-local work and make raw DOM reduction a weak primary target.

Chrome already has two distinct browser lifecycle mechanisms relevant to the experiment:

- a frozen tab remains loaded in memory while event handlers, timers, and other freezable tasks stop until activation;
- a discarded tab unloads its page resources and reloads on activation.

Chrome Memory Saver is therefore a required stock control. It deactivates unused tabs, reloads inactive tabs when the user returns, and exposes Moderate, Balanced, and Maximum levels. A useful Elatura result must beat the stock browser on the combined memory/fidelity tradeoff, rather than merely rediscovering tab discard.

Docs also autosaves to Drive as the user works. With offline editing enabled, changes save locally and later save to Drive after reconnection. A lifecycle intervention has to respect both online autosave and pending offline edits.

### Implication

The first serious target is whole-tab residency and lifecycle. DOM, accessibility-tree, and canvas counts remain explanatory metrics. Application DOM removal, canvas replacement, response rewriting, network interception, and an alternate editor stay outside this packet.

## What a large Docs session asks from the browser

The following cost map is a set of measurable hypotheses, rather than a leak claim.

| Scope | Likely retained or active cost | Primary owner | How to distinguish it |
| --- | --- | --- | --- |
| Chrome browser process | tab/session metadata, storage coordination, network/cache bookkeeping, service-worker coordination | Chromium | external process memory plus process inventory while document count changes |
| Docs renderer process | V8 isolate, Docs application model, formatting/edit state, undo history, collaboration state, listeners, canvas command/state caches | Docs inside Chromium renderer | renderer resident bytes plus `Performance.getMetrics` heap values as generated document count/size changes |
| Renderer native allocations | DOM wrappers, text/font support, canvas backing objects, Blink/V8 native allocations | mixed | renderer resident bytes minus reported JS heap; optional native allocation sampling in a separate diagnostic |
| GPU process | raster surfaces, texture/canvas backing, compositing resources | mixed | external GPU-process resident bytes while viewport movement and visible page count change |
| Visible document region | current canvas/raster work, caret/selection painting, overlays, menus, current accessibility region | mixed | active-vs-hidden deltas and viewport navigation trials |
| Collaboration/background work | presence, live-edit delivery, timers, network callbacks, local operation reconciliation | Docs plus browser scheduling | background CPU/network activity and two-session generated-doc fidelity trial |
| Shared caches | fonts, code, network cache, shared services | Chromium/shared | growth that remains after Docs renderer accounting and is shared across document tabs |

One large text-heavy document should primarily stress the application document model, editor history, JS/native renderer state, and whatever canvas/raster state Docs keeps near the viewport. Eight open documents add repeated application instances, renderer/process overhead, per-document editor state, and background collaboration/autosave work. Site/process assignment can change between Chrome revisions, so the benchmark records the actual process inventory instead of assuming one renderer per tab.

## State required for normal editing fidelity

A production-quality parking policy has to preserve the following user state. The first packet records pass/fail verdicts and leaves opaque application internals alone.

- current document and edit permission;
- current editing mode, including Editing/Suggesting where applicable;
- caret position and text selection;
- active IME/composition transaction;
- scroll position, zoom, and current visible region;
- local edits waiting for autosave or offline synchronization;
- undo/redo history expected by the current editing session;
- open comment/suggestion drafts and their anchors;
- collaboration presence and incoming edit reconciliation;
- current dialogs, menus, and transient editor controls when they contain user input;
- browser session/account state and Docs storage state.

### Hard fence

Elatura does zero application mutation while the tab is active. It also avoids lifecycle intervention during an IME composition, a transient text-entry surface, or a manually observed unsaved/pending state. The initial research runner uses operator confirmation for these states instead of reverse-engineering private Docs models.

A discard is counted as full-fidelity only if the post-reload session passes the same caret, selection, edit-canary, undo/redo, autosave, and collaboration checks. Otherwise it is classified as cold availability and cannot answer #118's normal-experience goal.

## What Chrome and Docs already virtualize

Two existing optimizations are important controls:

1. Docs renders the document through canvas rather than a simple page-sized HTML tree.
2. Docs accessibility navigation exposes nearby document semantics while content farther from the current focus can be absent for performance reasons.

Chrome independently deprioritizes background work and can freeze or discard background pages. Current Chrome extension tab metadata reports both `frozen` and `discarded` state. Chrome's lifecycle documentation also describes hidden, frozen, and discarded states and explains that frozen pages suspend freezable tasks while discarded pages are unloaded.

These existing behaviors mean a low DOM count, a hidden canvas region, or a smaller accessibility tree can coexist with a large retained Docs model. A benchmark must therefore treat DOM/AX reduction as explanatory evidence rather than a memory result.

## Safe observation packet

Use the dedicated signed-in Chromium profile already called for by #117. Record only bounded numbers and fixed tokens.

### Primary measurements

- whole Chrome process-tree resident bytes from an external OS process sampler;
- resident bytes for the unique renderer processes serving Docs targets, when the platform can map them reliably;
- GPU process resident bytes when exposed;
- Chrome process inventory and cumulative CPU time;
- per-target `JSHeapUsedSize` and `JSHeapTotalSize` from `Performance.getMetrics` when exposed;
- one-shot `Memory.getDOMCounters` values: documents, nodes, and JavaScript event listeners;
- page target count and frozen/discarded tab count;
- activation-to-editable latency;
- edit-echo latency for a fixed generated canary edit;
- time from the canary edit to operator-observed saved state;
- unexpected reload count;
- fidelity verdicts for edit persistence, undo/redo, caret, selection, autosave, and collaboration.

### Measurement discipline

- Map memory to actual PIDs and unique renderer processes. Same-site tabs can share a renderer, so tab count is never used as a process-count proxy.
- Sample stock and intervention runs at the same points in the workload.
- Warm up before the recorded switching plateau and preserve every raw numbered sample.
- Compare second-half samples against first-half samples and stock controls. A lower one-time snapshot cannot establish a retained-cost win.
- Run at least five independent repetitions per variant before comparing medians and tails.
- Record null for unavailable platform metrics instead of substituting estimates.
- Keep screenshots out of the benchmark record. The human operator sees the genuine page directly.
- Keep document text, title, URL, account identity, collaborator identity, and clipboard data out of the record.

### Instrumentation that stays out of the primary run

`Memory.prepareForLeakDetection` changes the renderer by terminating workers, stopping spellcheckers, dropping caches, and running garbage collection. It belongs only in an explicitly separate diagnostic because it changes the state under study.

Likewise, continuous accessibility instrumentation stays out of the primary run. CDP documents that enabling the Accessibility domain can affect performance until disabled. If AX evidence is needed, use a short separate probe with a partial tree near current focus, then disable it before the retained-memory run.

Full heap snapshots, full DOM snapshots, continuous DOM mirroring, screencasts, and persistent screenshot capture carry enough overhead or private-content risk to stay outside the first packet.

## Attribution rules: Chromium versus Docs

The runbook uses deltas and process ownership instead of prose guesses.

### Chromium/shared cost

Classify a cost as Chromium/shared when it appears primarily in the browser, GPU, network/utility, or other shared process and scales with tab/process count while Docs renderer heap stays comparatively flat.

### Docs application cost

Classify a cost as Docs application-retained when it appears in the Docs renderer's JavaScript heap or renderer resident bytes and scales with generated document size, edit history, or open document count.

### Mixed cost

Canvas/raster, font, compositor, and renderer-native growth can cross the browser/application boundary. Keep the label `mixed` until a controlled experiment separates it.

### Useful diagnostic patterns

- DOM nodes fall while renderer resident bytes and JS heap stay flat: cosmetic DOM win.
- Background CPU collapses under freeze while resident bytes stay flat: scheduling win, weak capacity win.
- Renderer process disappears or its resident bytes collapse under discard and activation causes reload: real reclamation with reload cost.
- Whole-browser memory falls while Docs heap stays flat: Chromium/shared reclaim.
- JS heap rises with document character count while DOM nodes remain flat: retained application model dominates.
- GPU memory rises during viewport traversal and falls after long idle while JS heap stays flat: raster/cache behavior dominates that delta.
- Memory Saver matches Elatura's memory and fidelity results: Chrome already solves that portion of the workload and Elatura earns no product claim from it.

## Candidate interventions in increasing risk

### 0. Observation only

Enumerate Docs tabs/targets, lifecycle state, process/CPU data, bounded memory metrics, and operator-visible fidelity. This variant must establish its own overhead. If `elatura-observe` adds more than 5% to the stock second-half median whole-browser resident bytes or more than 50 ms to p95 activation-to-editable latency, reduce instrumentation before continuing.

### 1. Selective freeze of inactive generated Docs tabs

Use Chrome's own lifecycle control (`Page.setWebLifecycleState` in a controlled CDP experiment) for a background tab only after the operator has observed saved state and the tab has no active composition or transient text entry. Activation immediately returns the tab to `active`.

This is the first reversible intervention because Chrome preserves the loaded page while suspending freezable tasks. It should strongly reduce background CPU. Chrome documents frozen tabs as still loaded in memory, so a large RAM reduction has to be demonstrated directly.

Promotion gate:

- zero fidelity failures;
- zero unexpected reloads;
- p95 activation-to-editable no more than stock + 150 ms;
- second-half median whole-browser resident bytes at least 25% below `stock-resident` for `docs-switch-8-v1`.

If CPU improves while resident memory improves by less than 10%, record a scheduling result and stop claiming capacity from freeze.

### 2. Explicit discard as a reclamation ceiling

Use Chrome's tab discard API only as a research variant after the freeze run. Chrome documents discard as unloading the page and reloading it on activation. This trial estimates how much per-document renderer memory can be reclaimed if reload is allowed.

The discard result qualifies as normal working-document availability only when every fidelity check passes and p95 activation-to-editable stays within the same usability gate. A failure on caret, selection, undo/redo, collaboration, or reload latency makes discard a cold-lane result.

### 3. App-specific suppression or parking

Attempt this only after measurements identify a large retained cost with a safe owner outside the editing fidelity fence. Canvas/document internals, text model, editor history, collaboration state, autosave queues, comment/suggestion state, and selection/caret state remain outside intervention authority.

Network response rewriting stays outside #118's first path. The browser/app measurements can answer whether lifecycle control has enough value before any response work is considered.

## Reproducible fixture generator

Run:

```bash
node scripts/generate-google-docs-workload.mjs --out /tmp/elatura-google-docs-v1
```

The generator produces deterministic ASCII text plus a local manifest containing file names, code-unit counts, paragraph counts, anchor counts, and SHA-256 digests.

Generated fixtures:

- `docs-large-text-v1.txt`: 4,800 fixed-width paragraphs, 772,800 text code units, 10 searchable anchors;
- `docs-switch-8-v1-01.txt` through `docs-switch-8-v1-08.txt`: 1,800 fixed-width paragraphs each, 289,800 text code units each, 10 searchable anchors each.

Upload each generated text file to the dedicated research Drive account and open/convert it with Google Docs. Keep the converted documents private to the research account or share only with a dedicated second test identity for the collaboration subtest. The benchmark stores only generated fixture metadata and fixed verdicts.

The large fixture stays below Google's current 1.02-million-character Docs limit with substantial headroom for canary edits.

## Workload A: `docs-large-text-v1`

Purpose: measure what one large, text-heavy editable document retains, how much Docs already virtualizes, and whether repeated navigation/editing reaches a stable resident plateau.

### Setup

- dedicated signed-in Chrome profile;
- all unrelated tabs closed;
- Chrome Memory Saver off for `stock-resident`;
- Energy Saver off or its state recorded consistently;
- one converted `docs-large-text-v1` document;
- browser zoom and Docs zoom held constant across repetitions;
- no comments, suggestions, images, add-ons, or collaborators in the primary text-only run.

### Recorded procedure

1. Open the document and wait until the operator sees the document as editable and saved.
2. Record sample 0 after 30 seconds of idle.
3. Find anchor 00, anchor 05, and anchor 09 in sequence. After each navigation, wait for the visible region to settle and record one sample.
4. At anchor 09, insert the fixed canary token `ELATURA_EDIT_01`, record edit-echo latency, wait for saved state, and record save-settled latency.
5. Undo the edit, wait for saved state, then redo it and wait for saved state. Record the `undoRedo` and `editCanarySaved` verdicts.
6. Put the caret immediately after the canary and select the final four characters. Switch to a neutral local tab for 30 seconds, return, and record caret/selection continuity plus activation latency.
7. Run 10 navigation cycles over anchors 00, 05, and 09. Record one sample after each full cycle.
8. Leave the Docs tab active and idle for five minutes. Record a final sample.

### What this workload answers

- Does document-size growth appear in JS heap, renderer-native memory, GPU memory, or shared browser memory?
- Do DOM node/event-listener counts stay bounded while the large Docs model grows?
- Does repeated top/middle/bottom navigation reach a plateau after warm caches?
- Does viewport traversal create a temporary GPU/native peak that later falls?
- Can the human continue ordinary editing with stable input and save latency?

## Workload B: `docs-switch-8-v1`

Purpose: measure the marginal cost of keeping eight real editable Docs tabs available and compare stock Chrome with browser-native Elatura lifecycle control.

### Setup

- eight converted generated documents, one per fixture file;
- each opened in its own tab in the same dedicated profile and window;
- all eight documents confirmed editable and saved before the recorded round;
- fixed tab order 01 through 08;
- Memory Saver state set according to the variant.

### One switch cycle

For document 01 through 08:

1. Activate the tab and measure activation-to-editable.
2. Search for anchor `(cycle mod 10)` and move the caret to that generated paragraph.
3. On the first visit to each document in the recorded run, insert a fixed per-document canary such as `ELATURA_D03_EDIT_01`, wait for saved state, undo, redo, and wait for saved state again.
4. On later visits, perform a caret move and four-character selection around the existing generated canary without adding more content.
5. Record one sample after the tab is usable and the required edit/selection check has completed.

### Plateau procedure

- four unrecorded warm-up cycles across all eight documents;
- eight recorded cycles across all eight documents;
- 64 raw samples total, which is the schema ceiling;
- preserve samples in emission order;
- compare the second four recorded cycles with the first four.

Run the complete workload independently for:

1. `stock-resident`: Memory Saver off, Elatura absent;
2. `stock-memory-saver`: Chrome Memory Saver Balanced, Elatura absent;
3. `elatura-observe`: Memory Saver off, bounded Elatura/CDP observation only;
4. `elatura-freeze`: Memory Saver off, selective freeze for eligible background generated Docs tabs;
5. `elatura-discard`: Memory Saver off, explicit discard as the reclamation ceiling.

The stock Memory Saver run is mandatory. If Chrome's own policy already gives the desired capacity and fidelity, the second-workload rubric says the opportunity weakens sharply.

## Collaboration subtest

Use two generated research identities and one generated switching document. Store only fixed verdicts.

1. Session A edits and saves a fixed canary, then moves the tab to the background.
2. Session B joins, inserts `ELATURA_REMOTE_EDIT_01`, and waits for saved state.
3. For the freeze variant, Session A remains frozen for 30 seconds after Session B's edit, then is activated.
4. Record whether Session A reaches editable state, receives the remote edit, retains local undo/redo and caret expectations, and shows coherent collaborator state to the operator.
5. Repeat once with Session A making a local canary edit immediately before backgrounding and only apply the intervention after saved state is visibly confirmed.

Any conflict, stale editor state that requires manual reload, lost local history, or misleading collaboration behavior fails the fidelity gate.

## Content-free run contract

`benchmarks/schema/benchmark-google-docs-live-run-v1.schema.json` records:

- fixed workload and variant tokens;
- generated fixture counts and manifest digest;
- bounded Chrome/environment tokens;
- raw numbered process/memory/heap/DOM/CPU/latency samples;
- fixed pass/fail/unmeasured fidelity verdicts;
- privacy flags pinned to false.

It excludes document text, titles, URLs, account identifiers, collaborator identifiers, screenshots, clipboard contents, and free-form notes.

## Decision rule

A Docs intervention earns continued product work only when it produces a real retained-cost improvement and preserves the official editing experience.

For the first lifecycle experiment, `elatura-freeze` passes the memory gate only when the second-half median whole-browser resident bytes on `docs-switch-8-v1` are at least 25% below `stock-resident`, with zero fidelity failures, zero unexpected reloads, and p95 activation-to-editable within stock + 150 ms.

A DOM/AX count reduction without a corresponding retained-memory reduction is a cosmetic result. A CPU-only freeze improvement is useful browser scheduling evidence and fails the RAM-capacity claim. A discard memory win with reload, caret, selection, undo/redo, autosave, or collaboration failures is a cold-lane result and fails the normal-experience claim.

The key product question remains open until valid runs exist. The first packet is designed so a negative result is useful: it can show that Docs already virtualizes the cheap layer, that Chrome Memory Saver already dominates the opportunity, or that the memory held for genuine editing fidelity is precisely the state Elatura must leave alone.

## Sources

Primary public references used to define this packet, checked 2026-08-27:

- Google Workspace Updates, “Google Docs will now use canvas based rendering” — https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html
- Google Docs Editors Help, “Use Google Docs with a screen reader” — https://support.google.com/docs/answer/1632201
- Google Docs Editors Help, “Switch from Microsoft Word to Google Docs” — https://support.google.com/docs/answer/9310150
- Google Docs Editors Help, “Create, view, or download a file” — https://support.google.com/docs/answer/49114
- Google Drive Help, file size limits — https://support.google.com/drive/answer/37603
- Chrome Help, “Personalize Chrome performance” — https://support.google.com/chrome/answer/12929150
- Chrome for Developers, Page Lifecycle API — https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Chrome Extensions API, `chrome.tabs` — https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome DevTools Protocol, Memory domain — https://chromedevtools.github.io/devtools-protocol/tot/Memory/
- Chrome DevTools Protocol, Performance domain — https://chromedevtools.github.io/devtools-protocol/tot/Performance/
- Chrome DevTools Protocol, SystemInfo domain — https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/
- Chrome DevTools Protocol, Accessibility domain — https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- Chrome DevTools Protocol, Page domain — https://chromedevtools.github.io/devtools-protocol/tot/Page/
- Chromium multi-process architecture — https://www.chromium.org/developers/design-documents/multi-process-architecture/
