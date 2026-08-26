# Chromium projection host

Issue #129 evaluates the smallest stock-Chromium host that can support the application-lane work in #116/#117 without gaining page-content access.

The canonical application-lane contracts live in `@elatura/core/application-lane` and `@elatura/core/application-lane-lifecycle`. Durable identity is `laneRef + laneGeneration`. Requested residency and application/browser eligibility are generation-bound. Browser tab ids remain transport projections.

## Zero-content boundary

The prototype is a Manifest V3 extension for Chrome 132+ with:

- a module service worker;
- a toolbar popup;
- no requested permissions;
- no host permissions;
- no content scripts;
- no debugger/CDP or scripting access;
- no extension storage;
- no URL, pending URL, title, favicon, page text, DOM, screenshot, cookie, history, or network inspection.

The host uses only lifecycle/tab-placement fields that Chrome exposes without the sensitive `tabs` permission.

## Unbound projection

Until a reviewed binding supplies an exact current application lane generation, the host exposes only an ephemeral browser projection:

```text
projectionRef = chrome-session-tab-<tabId>
```

This is explicitly different from `laneRef`.

One projection contains bounded fixed metadata:

- numeric tab/window/index;
- last-access timestamp;
- browser residency: foreground/background/frozen/discarded/reloading;
- audio state: audible/quiet/unknown;
- browser auto-discard protection and pinned state;
- freeze/discard eligibility in the canonical `allowed | blocked | unknown` vocabulary;
- canonical lifecycle blocker tokens;
- manual-native-discard preflight.

The browser-only host always includes `application_unknown`. Ordinary quiet background projections therefore keep freeze/discard eligibility `unknown`. Known media activity or explicit browser protection can make eligibility `blocked`; absence of those blockers never makes application lifecycle permission `allowed`.

`active` means active inside one Chrome window. The projection is `foreground` only when that window is also focused.

## Explicit operator actions

Unbound mode performs no automatic lifecycle mutation and invokes no `planApplicationLaneResidencyV1()` decision.

The popup offers three explicit browser actions:

- **Manual discard** — re-fetch the tab immediately, refuse active/pinned/audible/unknown-audio/already-discarded/browser-protected state, then call native `chrome.tabs.discard(tabId)`;
- **Wake** — activate the tab and focus its window, allowing Chromium to reload a discarded page through normal browser behavior;
- **Protect / Allow discard** — toggle `autoDiscardable` only.

Receipts carry `authority: "explicit-operator-browser-action"`. They are browser-operation receipts, never claims that an application adapter proved reload fidelity or discard eligibility.

## Generation binding later

A future binding packet may associate one private browser projection with a canonical `laneRef + laneGeneration`. That binding must:

- preserve browser ids as private transport details;
- reject stale generations before lifecycle planning or action;
- supply generation-bound application/browser fidelity facts;
- keep event/attention observations separate from freeze/discard permission;
- use the merged residency planner instead of adding another policy engine.

The first zero-content host intentionally avoids inventing a durable identity source. Chrome tab ids are browser-session scoped; service-worker restart can recompute projections, while browser restart may replace them.

## Repository gate

`scripts/chromium-extension-gate.mjs` runs inside `npm run security:gate` and requires:

- the exact zero-permission MV3 manifest;
- Chrome 132+;
- reviewed background/popup entrypoints;
- no outbound network, dynamic evaluation, remote assets, console logging, dynamic Chrome API lookup, or sensitive tab-property access;
- only `chrome.runtime` in the popup;
- only `chrome.runtime`, `chrome.tabs`, and `chrome.windows` in the service worker;
- fresh manual-discard preflight;
- explicit unbound-lane and operator-authority receipts;
- no application-lane planner invocation or manufactured `laneRef` in the Chromium background.

This is local dogfood. The existing Firefox signing/build-manifest path remains the repository's release path and this packet makes no Chrome Web Store distribution claim.
