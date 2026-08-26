# Chromium MV3 lane host

Status: stacked prototype behind #123 / PR #124  
Tracking: #126  
Benchmark consumer: #116

## Purpose

This packet projects the pure lane-governor contract onto stock Chromium with the smallest browser permission surface that can answer the lifecycle question.

The host owns browser projection and explicit browser-lifecycle actions. It does not own work scheduling, mission authority, provider authority, or agent dispatch.

## Permission boundary

The Manifest V3 extension requests only:

```json
{"permissions":["storage"]}
```

Chrome exposes non-sensitive tab lifecycle fields and ordinary tab management calls without the `tabs` permission. The host deliberately avoids URL, title, favicon, page content, cookies, browser storage, and host permissions.

The first packet also has zero `debugger`, `webRequest`, native-messaging, content-script, screenshot, or remote-debugging capability.

## Durable lane projection

A stored lane contains only bounded content-free state:

```text
lane id
bind timestamp
browser-session projection or null
small lifecycle signals
whether Elatura owns automatic-discard protection
```

`storage.local` keeps this lane record across MV3 service-worker restarts. `storage.session` holds a random browser-session epoch in memory. Chrome clears session storage on extension reload/update/disable and browser restart.

Every tab projection therefore carries:

```text
browser-session epoch + tab id
```

Chrome tab IDs are unique within one browser session. When the session epoch changes, the host clears old tab projections before using current tab IDs. That makes an old numerical tab ID incapable of silently becoming authority for a new browser session.

This packet stops there. Browser-restart recovery to the correct live application requires a separately reviewed application-resource identity. It must never guess from a reused tab ID.

## Lifecycle policy and actions

The browser host converts Chrome tab fields into the pure governor input:

- active;
- pinned;
- audible;
- discarded;
- frozen when available;
- auto-discardable;
- last-access time.

Application signals default to conservative unknown values. A lane therefore cannot become a discard candidate merely because it is old or frozen.

The host exposes explicit operations for future extension UI:

- bind a tab to a durable lane ID;
- update bounded signals;
- inspect the current governor decision;
- discard only when the current decision is `discard-candidate`;
- activate/wake the current tab projection;
- protect the tab from automatic browser discard;
- remove automatic-discard protection only when Elatura recorded ownership of that change;
- forget an unprotected lane.

Inspection is advisory. It never executes discard automatically.

Wake receipts mean only that Chromium accepted tab activation. Application readiness remains a separate adapter/sentinel observation.

## Failure behavior

Browser and storage exceptions collapse to fixed reason codes. Browser error text, page data, and exception detail never enter receipts.

A missing or stale projection blocks lifecycle mutation. Durable-storage read failure blocks host actions. Failed ownership persistence after applying automatic-discard protection triggers an attempted rollback; an unconfirmed rollback is surfaced as a fixed partial result.

## Build boundary

`extension/chromium/src/lane-governor.ts` is a source-time bridge to the reviewed core module so repository tests exercise the same implementation. During `npm run build`, the asset-copy step replaces that emitted bridge with the compiled core `lane-governor.js` inside the extension package. The browser therefore loads a self-contained local module graph with no package resolver, remote code, or runtime source-tree dependency.

## Next experiment

After PR #124 is accepted and #126 passes repository CI, load the built extension into a pinned Chrome for Testing profile and measure:

1. stock Chrome;
2. extension installed with no bound lanes;
3. several bound lanes under observation only;
4. explicit native discard and wake on a synthetic reload-safe lane.

Record whole-browser memory/CPU separately from extension state. A deeper debugger/DOM/screenshot packet earns itself only after this lifecycle-only host demonstrates useful value or a concrete missing capability.
