# Firefox ChatGPT lane-activity operator panel

Status: volatile local dogfood surface for #116  
Physical producer: `extension/firefox/src/chatgpt-lane-activity-producer.ts`  
Route: `extension/firefox/src/chatgpt-lane-activity-route.ts`  
Canonical activity contract: `@elatura/adapter-chatgpt/lane-activity`

## Purpose

The Firefox content producer and exact-target route are intentionally extension-internal. The live application-lane benchmark is still operator-driven and has no external Firefox automation channel.

The popup therefore provides the smallest physical operator loop needed to exercise the existing producer under the frozen benchmark protocol without adding native messaging, `externally_connectable`, or persistent browser/lane binding state.

## Volatile binding workflow

1. Open the target ChatGPT page in the active Firefox tab.
2. Enter the current canonical Elatura `laneRef` and positive `laneGeneration` in the popup.
3. Press **Bind active page**.
4. The popup resolves the active tab id explicitly and asks Firefox background to discover that tab's current private ChatGPT document/route projection epoch.
5. The popup holds the resulting binding only in module memory:

   ```text
   tabId + documentProjectionRef + laneRef + laneGeneration
   ```

6. Press **Sample state** to request one current content-free activity sample through the v2 route.
7. Read only the fixed activity tokens shown in the popup.

Closing the popup clears its module state. Changing either lane-target input also clears the binding.

## Private projection handling

The popup never displays or directly reads `documentProjectionRef`.

The pure panel helper owns that token inside the volatile binding and uses it only to derive/correlate route messages. The visible binding state is limited to:

```text
unbound
bound · generation N
```

If ChatGPT reloads or changes client-side route, the content producer rotates its private projection epoch. A later sample against the older binding returns `stale_projection`; the popup immediately clears the binding and asks the operator to bind the active page again.

## Visible activity fields

A successful sample renders only:

- confidence;
- generation activity;
- composer state;
- IME composition state;
- modal state;
- media/device state;
- download state;
- other transient state.

These are the fixed content-free fields from the reviewed activity contract. The panel does not render transcript text, prompts, answers, titles, URLs, browser ids, account identity, cookies, request bodies, or credentials.

## Failure behavior

Any of the following clears the volatile binding:

- stale document projection;
- route unavailable;
- invalid/mismatched receipt;
- target input change;
- popup close/reopen.

A failed sample also clears the visible activity readout.

The operator must rebind before the next sample.

## Authority boundary

The panel is diagnostics only.

Binding a page or sampling activity performs no navigation, activation, reload, freeze, discard, submission, storage write, scheduling, or work dispatch. Every underlying route/observation remains zero-authority.

The existing slim-mode transformation controls remain separately locked by their current safety/opt-in path.

## Benchmark use

For #116 resource-stage dogfood, the panel can be used during controlled ChatGPT states such as:

- active generation;
- typed-but-unsent composer content;
- IME composition;
- open modal UI;
- reproducible active media;
- ordinary idle background residency;
- post-reload / Keep warm recovery checks.

The frozen final benchmark schemas remain unchanged. The popup is an operator diagnostic surface; private binding data should stay out of committed result artifacts.

Useful observations to transcribe into allowed diagnostics are fixed route outcomes, activity confidence, and later canonical blocker/eligibility results.

## Security / persistence boundary

The panel adds:

- no manifest permission;
- no host permission;
- no external messaging surface;
- no storage or indexed database use;
- no network client;
- no logging sink;
- no additional page-content access beyond the already-reviewed producer.

All binding state disappears with the popup document.
