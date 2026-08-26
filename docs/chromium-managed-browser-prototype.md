# Chromium managed-browser prototype

Status: executable research plan  
Last reviewed: 2026-08-27  
Tracking: #117  
Primary benchmark: #116  
Firefox comparison: #95 and `docs/transport-capability-matrix.md`

## Decision

The smallest Chromium experiment that can answer #117 is:

```text
pinned Chrome for Testing Stable
+ dedicated Elatura user-data-dir
+ one Manifest V3 extension
+ tiny launcher/resource sampler
+ chrome.debugger attachments only for explicit reads/actions
```

A separate loopback CDP broker is an earned addition. A Chromium fork is outside this packet.

This prototype is intended to answer one product question: can a dedicated Chromium browser profile keep several genuine application lanes useful while reducing resident browser work and unnecessary inspection, with truthful wake and recovery semantics?

The first packet performs zero response-body rewriting.

## Why this is enough to test the thesis

Chromium already supplies most of the control plane Elatura needs without browser-source changes:

- a dedicated profile can own authenticated application state independently of the operator's ordinary browser profile;
- extension APIs expose tabs, `lastAccessed`, `discarded`, `frozen`, tab groups, sessions, storage, and a side panel;
- `chrome.debugger` supplies an extension-approved CDP transport for `Target`, `Page`, `DOM`, `Accessibility`, `Runtime`, `Network`, `Fetch`, `Input`, `Performance`, and related allowed domains;
- CDP can capture screenshots, bring a page to the front, inspect bounded DOM/accessibility state, collect runtime metrics, and dispatch explicitly authorized input;
- Chromium already owns process isolation, sandboxing, profile persistence, login state, service workers, application caches, permissions, downloads, accessibility, codecs, updates in branded Chrome, and the application compatibility burden.

A fork would duplicate responsibility before measurements identify a browser-source limitation.

## Browser choice

### First automated packet: Chrome for Testing Stable

Use an exact pinned Chrome for Testing version and record it in every benchmark manifest.

Chrome for Testing is the preferred first binary because Google publishes versioned binaries alongside Chrome releases for automation/testing, without auto-update changing the executable mid-run. It is closer to ordinary Chrome than an independently built Chromium snapshot.

Treat this as a trustworthy-fixture and controlled-dogfood browser. Ordinary Chrome remains the later human acceptance target.

### Why the dedicated profile is mandatory

Launch with a dedicated non-default user-data directory such as:

```text
<elatura-state>/chromium-profile
```

Modern Chrome requires a non-default `--user-data-dir` when command-line remote debugging is used. Elatura should keep this separation even when the first packet uses `chrome.debugger` and opens no remote-debugging port.

The profile directory is operator-owned private state. It never enters Git, benchmark artifacts, telemetry, or a companion protocol.

### Ordinary Chrome acceptance

After the controlled packet is useful, repeat the human-facing checks in ordinary current Chrome with an Elatura-only profile. Branded Chrome has tightened command-line extension loading, so automated unpacked-extension launch convenience must not become a production assumption.

## Prototype components

### 1. Launcher and resource sampler

One small local process owns only these jobs:

1. resolve the pinned browser executable;
2. create/select the dedicated Elatura user-data directory;
3. launch and restart that browser;
4. sample the browser process tree for content-free resource measurements;
5. record exact browser identity, command line policy, timestamps, process IDs, RSS/private-memory where the host exposes it, and CPU time.

It does not receive cookies, local storage, authorization headers, response bodies, DOM text, or reusable browser credentials.

The launcher is also sufficient to run the synthetic crash/restart recovery experiment. A general browser-control daemon adds no value yet.

### 2. One MV3 extension

The extension owns the browser-facing lane projection:

```text
Elatura lane id (durable UUID)
  -> current tab/target projection
  -> URL/resource fingerprint + adapter identity
  -> active / parked / discarded / recovery-needed
  -> last observed freshness + content-free change hints
```

Use `chrome.storage.local` for durable lane records and rebuild in-memory projections on extension service-worker startup. Tab IDs, target IDs, process IDs, group IDs, and session IDs are ephemeral projections.

Initial permissions should cover only the measured packet. Likely candidates are:

- `storage`
- `tabs`
- `tabGroups`
- `sessions`
- `sidePanel`
- `debugger`

Host permissions should stay limited to explicit synthetic/dogfood hosts.

`debugger` cannot be an optional permission in Chrome, so a debugger-bearing build has an install-time capability cost. Keep the attachment policy narrow: attach for an explicit observation/action, collect the bounded result, then detach. Measure an idle extension baseline separately from debugger-attached runs because an active debugger session can keep an MV3 service worker alive.

### 3. Side panel as the human lane palette

The side panel is useful because it can stay visible beside the ordinary application and expose content-free lane state:

```text
active
parked
changed
recovery-needed
```

It can offer explicit actions such as activate, inspect, screenshot, park, discard, and restore.

Keep it closed during stock/idle resource baselines. The panel is a control surface, never the authoritative application view.

### 4. `chrome.debugger` as the first CDP transport

Use `chrome.debugger` before opening a remote-debugging endpoint. Chrome documents it as an approved extension transport for the CDP domains Elatura needs, including:

| Domain | First-packet use |
| --- | --- |
| `Target` | discover/track child targets and workers when needed |
| `Page` | lifecycle observation, screenshot, bring-to-front, experimental freeze/active probe |
| `DOM` | bounded element/state reads for reviewed adapters |
| `Accessibility` | bounded accessibility reads before pixels when useful |
| `Runtime` | tightly reviewed synthetic/adaptor probes only |
| `Network` | content-free request/lifecycle metadata |
| `Performance` | on-demand runtime metrics |
| `Input` | synthetic test input first; human/agent writes separately authorized |
| `Fetch` | reserved for later response-interception experiment |

The accessibility domain is experimental and enabling it can affect performance. Prefer partial/query reads and keep full-tree collection outside scheduler loops.

`Page.startScreencast` also exists, but continuous screencasting belongs to the remote-display problem in #94. #117 only needs explicit screenshots at first.

## Lane lifecycle semantics

### Active

A normal interactive tab. Preserve the application exactly as Chromium presents it.

### Grouped/collapsed

Useful organization only. A collapsed tab group carries no resource-saving claim by itself.

### Frozen

Chrome exposes a `frozen` tab state: timers, event handlers, and other tasks stop while content remains loaded in memory. Chromium does not currently expose a stable `chrome.tabs.freeze()` command.

CDP has experimental `Page.setWebLifecycleState` with `frozen` and `active`. Treat it as an experiment, record the exact browser version, and keep a normal active fallback.

Expected benefit: lower background CPU/network activity while retaining loaded page memory.

### Discarded

`chrome.tabs.discard()` unloads tab content from memory while keeping the tab in the strip; activating the tab reloads it.

Expected benefit: larger memory relief with a stronger fidelity requirement. This state is only valid for lanes whose application state can survive reload from the browser/profile/server. Unsaved in-memory application state makes discard unsafe.

### Wake

Wake means restoring the genuine application to an interactive state:

- frozen -> activate lifecycle + focus as required;
- discarded -> activate/reload and wait for reviewed readiness signals;
- missing/restart recovery -> reconcile durable lane identity with available tabs/session hints and surface `recovery-needed` when ambiguous.

Never report a lane ready from a tab event alone when the application has not recovered its usable state.

## Recovery model

Extension service workers are deliberately ephemeral. Durable lane state belongs in `chrome.storage.local`; current tab/target bindings are reconstructed.

On browser/profile startup:

1. load durable lane records;
2. enumerate current windows/tabs;
3. match only with reviewed stable resource identity;
4. treat tab/group/target/process IDs as new projections;
5. mark zero-match or multi-match lanes `recovery-needed`;
6. use `chrome.sessions` only as a recent-close restoration hint;
7. require the genuine application to reach its reviewed readiness state before returning `active`.

`chrome.sessions` retains a bounded recently-closed set and should never serve as the durable Elatura lane database.

The first crash/restart test uses synthetic state so the launcher can terminate and restart the managed browser without touching an operator's normal browser session.

## Resource measurement

Do not make CDP responsible for measurements it does not expose well.

Chrome's `chrome.processes` API has useful per-process CPU/private-memory fields and tab-to-renderer lookup, but Chrome currently labels the API Dev channel. Exclude it from the stable first packet.

CDP `SystemInfo.getProcessInfo` can return browser process IDs/types and cumulative CPU time, yet `SystemInfo` is outside the documented `chrome.debugger` domain allowlist and does not provide the complete resident/private-memory accounting #116 needs.

Therefore the first packet samples the launched browser's OS process tree externally. Record:

- browser tree total RSS/private bytes where available;
- per-process type when Chromium command lines expose it safely;
- process count;
- CPU time/delta;
- wall-clock phase;
- browser/tab lifecycle events from the extension;
- `Performance.getMetrics` values on explicit attached reads.

Exact per-lane renderer memory is an earned follow-up if aggregate process-tree results cannot answer the benchmark.

## Firefox comparison

Firefox remains materially better for Elatura's current response-stream experiment.

### Firefox response filtering

`webRequest.filterResponseData()` gives the extension the response stream before page consumption. Elatura's current observer can:

```text
ondata
  count/inspect bytes
  filter.write(the same bytes)

onstop
  filter.close()

onerror
  filter.disconnect()
```

Firefox documents `disconnect()` as removing the filter so the remainder of the response is processed normally. That gives Elatura a particularly clean pass-through/fail-open primitive for stream observation and later bounded rewriting.

### Chromium Fetch interception

CDP `Fetch.enable` pauses matching requests until the client continues, fails, or fulfills them. At response stage:

- `Fetch.getResponseBody` obtains the complete body;
- `Fetch.takeResponseBodyAsStream` gives a sequential stream;
- after taking that stream, the request cannot continue unchanged: the client must cancel or provide a replacement body;
- disabling interception or mixing body-reading modes at the wrong point has documented undefined behavior.

That moves delivery responsibility into the debugger/CDP client and creates more opportunity for pause latency, backpressure, body/header fidelity mistakes, service-worker/cache surprises, and bad failure behavior.

Firefox therefore stays the response-interception specialist until a separately gated Chromium Fetch experiment produces contrary evidence.

Chromium's stronger near-term case is elsewhere: application compatibility, tab/workspace APIs, bounded CDP observation, screenshot/input integration, and lifecycle control around many live applications.

## When a loopback CDP broker is earned

Add a local-only broker only when at least one first-packet result proves that `chrome.debugger` cannot supply a required capability cleanly.

Credible triggers:

- a required CDP domain is outside the `chrome.debugger` allowlist;
- reliable target/process correlation needs browser-level CDP access;
- crash/restart orchestration needs a protocol beyond the launcher;
- the separately authorized Fetch response-interception experiment needs richer streaming/control semantics;
- external resource sampling cannot answer the matched #116 benchmark.

If added:

- bind to loopback only;
- use the dedicated profile only;
- never expose the endpoint to LAN/tailnet/public interfaces;
- never export cookies or reusable credentials;
- keep an authenticated/nonce-bound local protocol if more than one local process can connect;
- preserve extension/user control as the human-visible authority boundary.

## First three experiments

### Experiment 1 — Can an extension represent a real lane without a broker?

Use 6-10 deterministic local/synthetic application tabs with navigation, background changes, workers, a small accessibility tree, and enough DOM to exercise bounded inspection.

Compare:

1. stock pinned Chrome for Testing;
2. dedicated profile + extension, debugger detached;
3. same profile with explicit attach/read/detach operations.

Exercise:

- durable lane UUID -> current tab binding;
- URL/title/navigation and `lastAccessed` observation;
- `frozen`/`discarded` observation;
- bounded DOM read;
- bounded accessibility read;
- `Performance.getMetrics`;
- screenshot of an inactive target;
- activate/jump-back;
- extension service-worker suspension/revival and projection rebuild.

Record browser process-tree CPU/memory, attach latency, read sizes, screenshot latency, stale-binding errors, and recovery time.

**Promotion gate:** the extension can inventory/reconcile lanes and execute the read ladder reliably while the detached idle overhead remains small enough for #116. Any required remote-debugging daemon must correspond to a concrete missing capability.

### Experiment 2 — Does Chromium lane parking buy useful resident capacity?

Use the same deterministic stateful fixture and compare:

1. normal background tab;
2. collapsed tab group;
3. experimental CDP frozen state;
4. discarded tab.

For each state record:

- browser process-tree memory and CPU;
- fixture timer/background-task/network counters;
- wake latency;
- DOM/application readiness after wake;
- scroll/focus/edit state that the fixture intentionally holds;
- any lost in-memory state;
- 100 park/wake rotations and retained-memory plateau.

**Interpretation:** grouping is UI organization; freezing should mainly target background work; discard is the candidate for larger memory release and carries reload semantics.

**Promotion gate:** at least one browser-level parking mode creates useful savings for lanes with application fidelity that #116 actually needs. If freeze saves little and discard breaks required state, browser-level lifecycle control alone has a weak product case.

### Experiment 3 — Can durable lane identity survive browser death?

Create several synthetic lanes, place them in groups, persist only durable Elatura identity plus reviewed resource identity, then terminate the managed browser process and restart the same dedicated profile.

Verify:

- every restored tab receives fresh ephemeral IDs;
- unambiguous lanes reconcile to the right authoritative page;
- missing and duplicate candidates become `recovery-needed`;
- no stale tab/target/process ID is treated as authority;
- restored lanes reach reviewed application readiness before `active`;
- recovery latency and ambiguity count are recorded.

**Promotion gate:** restart recovery is deterministic on the synthetic workload and failure stays explicit.

## Response-interception experiment, only after promotion

If #116 shows enough live-lane value and pre-hydration response reduction remains important, run a fourth local-fixture comparison:

1. Firefox `filterResponseData` pass-through/windowing;
2. Chromium CDP `Fetch` response-stage interception;
3. DOM/render-only suppression.

Measure latency, byte/body/header fidelity, memory effect, cache/service-worker behavior, cancellation, browser/client crash behavior, and the ability to return safely to the ordinary application path.

This experiment is intentionally separate from the managed-browser proof.

## Exit criteria

Stop the Chromium lane direction when the controlled packet shows that ordinary tabs already deliver comparable resident cost, switching behavior, recovery, and inspection semantics, or when useful parking requires application-breaking discard/reload behavior.

Promote Chromium as a first-class Elatura transport when the matched #116 evidence shows a material advantage in one or more of:

- live lanes per host memory budget;
- background CPU under multi-lane use;
- wake/switch latency;
- elimination of useless human/agent visits through cheap events;
- bounded DOM/accessibility/screenshot escalation;
- reliable crash/restart continuation;
- compatibility across the selected real applications.

A custom Chromium build becomes discussable only after these measurements identify a browser-owned cost or missing primitive that a source change could plausibly remove.

## Explicit non-goals

- Chromium fork or custom browser build in the first packet;
- public remote-debugging endpoint;
- default-profile debugging;
- cookie/profile export;
- generic automation service;
- continuous screenshots/screencast for scheduler polling;
- full accessibility/DOM snapshots on every pass;
- response-body transformation in the first packet;
- application submission/input authority in the observation benchmark;
- claims that a grouped, frozen, or discarded tab preserves application semantics without a workload-specific proof.

## Primary references

Chrome / extension:

- https://developer.chrome.com/docs/extensions/reference/api/debugger
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- https://developer.chrome.com/docs/extensions/reference/api/sessions
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/blog/remote-debugging-port
- https://developer.chrome.com/blog/chrome-for-testing/

Chrome DevTools Protocol:

- https://chromedevtools.github.io/devtools-protocol/tot/Page/
- https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- https://chromedevtools.github.io/devtools-protocol/tot/Network/
- https://chromedevtools.github.io/devtools-protocol/tot/Fetch/
- https://chromedevtools.github.io/devtools-protocol/tot/Input/
- https://chromedevtools.github.io/devtools-protocol/tot/Performance/
- https://chromedevtools.github.io/devtools-protocol/tot/Target/
- https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/

Firefox comparison:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData
