# Chromium projection lifecycle host

Status: first stock-Chromium browser host for #116/#117  
Core lane protocol: `@elatura/core/application-lane`  
Residency policy: `@elatura/core/application-lane-lifecycle`

## Purpose

This extension is a deliberately small browser projection host. It exposes browser lifecycle facts and native lifecycle actions without reading page content.

The host does **not** decide which logical application lane deserves resources. A human or external orchestrator chooses a requested lane posture through the core model; application-specific fidelity establishes whether freeze/discard is safe; the transport eventually maps that decision to the current browser projection.

The first host provides the browser half of that pipeline.

## Projection identity

`chrome-session-tab-<tabId>` is an opaque browser-session **projection id** only.

It is not an application-lane `laneRef`, account identity, conversation identity, or work identity. Tab ids can be replaced or reused across browser lifecycle and restart. Durable lane identity remains in the consumer-neutral application-lane layer.

## Zero-content inventory

The popup lists at most 256 projections using only:

- numeric tab id, window id, and tab position;
- foreground/background/frozen/discarded state;
- pinned state;
- audible/quiet/unknown token;
- `autoDiscardable` state;
- last-access timestamp inside the internal projection record;
- fixed browser-only manual-discard eligibility/reason.

The extension reads no URL, title, favicon, DOM, accessibility tree, storage, cookies, history, request/response body, or page application state.

The manifest requests zero permissions and zero host permissions.

## Human lifecycle controls

The popup separates four browser actions:

### Keep warm

- set `autoDiscardable: false` so Chromium does not automatically discard the projection;
- if the tab is already discarded, request `chrome.tabs.reload(tabId)` while leaving activation separate;
- return a bounded receipt and refresh lifecycle state.

This is the first physical browser operation corresponding to the core `responsive` posture. It does not prove that the underlying application is ready; application recovery/fidelity remains a higher-layer fact.

### Allow reclaim

Set `autoDiscardable: true`. This permits Chromium's normal policy to reclaim the tab later. It does not force an immediate discard.

### Discard now

Use explicit native `chrome.tabs.discard(tabId)` only after a fresh browser-only preflight rejects active, pinned, audible/unknown-audio, already-discarded, and browser-protected tabs.

This popup action is explicitly operator-directed. Automated discard must additionally pass the application-lane lifecycle eligibility gate before a transport may execute it.

### Activate

Use `chrome.tabs.update(tabId, { active: true })` for explicit foreground interaction. Activation is separate from warming.

## Security gate

`scripts/chromium-extension-gate.mjs` enforces the current packet:

- Manifest V3 / Chrome 132+;
- zero permissions, host permissions, content scripts, web-accessible resources, and external connections;
- no debugger, scripting, storage, cookies, history, browsing-data, webRequest, downloads, remote network, dynamic evaluation, or logging path;
- no URL/title/favicon access;
- `chrome.tabs` only in the background service worker;
- exact reviewed lifecycle operations only;
- browser tab identity is named as a projection, never a durable lane reference;
- no embedded second governor.

## Next integration

The next earned step is a small projection binding/reconciliation layer that can apply an already-approved `ApplicationLaneLifecycleDecisionV1` to the current Chromium projection and return a generation-bound receipt.

That step should preserve these boundaries:

- browser projection ids stay local;
- application eligibility is established outside the browser-only host;
- `responsive` may protect/reload without foreground activation;
- `reclaimable` never means immediate destructive discard unless the caller explicitly requests and the eligibility gate passes;
- `suspended` waits for an evidence-backed freeze transport; the ordinary extension API currently supplies observation of frozen state, while forced freeze remains a separately reviewed capability.

The #116 capacity benchmark remains the promotion gate for any automatic policy.
