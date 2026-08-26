# Chromium lifecycle host

Issue #129 is the first browser-host packet consuming the lane governor from #123 / PR #124.

## Permission boundary

The prototype is a Manifest V3 extension targeting Chrome 132+ with a module service worker and toolbar popup. Its manifest requests no permissions, host permissions, optional permissions, content scripts, or web-accessible resources.

That boundary is intentional. The Chrome Tabs API exposes the lifecycle fields used here without the sensitive `tabs` permission. The prototype does not read or display URL, pending URL, title, favicon, page text, DOM, screenshot, cookies, storage, history, network traffic, or authenticated application content.

The popup labels lanes only with numeric browser-session metadata:

- window id;
- one-based tab position;
- numeric tab id;
- active/background;
- pinned/unpinned;
- audible/quiet;
- loaded/discarded;
- frozen/unfrozen;
- auto-discardable/browser-protected;
- governor action and fixed reason code.

## Browser-only safety semantics

The browser host supplies these application signals to the core governor:

```text
generating = unknown
unsaved = unknown
needs-attention = false
safe-to-discard = unknown
```

Therefore browser-only observation does not create an application-level discard-safety claim. The governor remains conservative and reports protection while safety is unknown.

A manual native discard is a separate operator action. The service worker re-fetches the target tab immediately before the operation and refuses the request when the fresh tab is:

- active;
- pinned;
- audible;
- already discarded;
- protected from automatic browser discard.

The browser then performs the actual `chrome.tabs.discard(tabId)` operation. The receipt labels this path `explicit-operator-native-discard` so it cannot be confused with a sentinel proving application safety.

## Other operator actions

- **Wake** activates the target with `chrome.tabs.update(tabId, { active: true })`; activating a discarded tab lets Chromium perform its native reload.
- **Protect** sets `autoDiscardable: false`.
- **Allow discard** sets `autoDiscardable: true`.

Every operation re-fetches or receives the browser's resulting tab state and returns only bounded lifecycle metadata plus fixed local decision/reason tokens. Browser exceptions become fixed failure codes.

## Continuity boundary

The first host uses `chrome-session-tab-<tabId>` as the lane projection. Chrome tab ids are unique within one browser session, so this identity survives extension service-worker termination and restart without any local storage or in-memory registry.

It makes no cross-browser-restart continuity claim. A later packet may evaluate a stable identity source, but content access should not be added merely to manufacture identity.

## Build and review boundary

`npm run build` compiles `extension/chromium/src/lifecycle.ts`, copies the static MV3 assets, and copies the compiled `@elatura/core/lane-governor` module into the Chromium extension's local `vendor/` directory.

`scripts/chromium-extension-gate.mjs` runs inside the repository security gate and asserts:

- exact zero-permission manifest fields;
- Chrome 132+;
- reviewed service-worker and popup entrypoints;
- absence of debugger, scripting, storage, cookies, history, browsing-data, web-request, download, outbound-network, dynamic-evaluation, logging, and sensitive tab-property access;
- `chrome.tabs` use stays in the service worker;
- the service worker retains fresh manual-discard preflight and browser-only unknown application signals.

The Firefox build manifest and Firefox release path remain unchanged. This Chromium packet is local dogfood and makes no Chrome Web Store distribution claim.
