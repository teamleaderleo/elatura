# Chromium lane governor

Issue #123 narrows the Chromium experiment to an intent-aware lifecycle and attention layer over stock Chromium.

## Baseline

Native Chromium tab discard is the coarse memory-reclamation baseline. A discarded tab keeps its browser-tab identity while its loaded page is released and later restored through normal browser activation/reload behavior. Elatura does not reproduce that mechanism in the core runtime.

The first question is therefore whether Elatura can make a better **decision about when a useful authenticated application lane should stay warm, become protected, become a discard candidate, or wake for attention**.

## Pure governor

`@elatura/core/lane-governor` contains no browser API, provider field, URL, DOM, credential, or page-content dependency. The host supplies two bounded records:

- browser lifecycle: active, pinned, audible, discarded, frozen when known, auto-discardable, and last-access time;
- tiny application signals: generating, unsaved, needs-attention, and explicit discard safety.

The governor returns exactly one advisory action plus a fixed reason code:

- `keep-resident`;
- `protect-from-discard`;
- `discard-candidate`;
- `wake-candidate`;
- `observe-only`.

Unknown application discard safety resolves conservatively. `frozen` alone never proves that an application is safe to discard. `safeToDiscard: "yes"` can produce a discard candidate only after active, attention, pinned, audible, generating, unsaved, browser-protection, clock, and idle-time checks pass.

The default idle threshold is five minutes. It is a provisional policy input for experiments, not a product claim.

## Interaction leases

The same module includes a bounded in-memory lease ledger for future human/agent computer use.

- passive observation uses no lease;
- a future mutation/input host can require one current lane lease;
- a human lease preempts an agent lease;
- direct human activity revokes an agent lease immediately;
- an agent cannot replace a current human lease;
- leases have bounded TTLs and deterministic expiry;
- one lane has at most one current mutation owner.

A lease is only local coordination state. It carries no provider, application, account, browser-profile, or repository authority.

## Chromium host boundary

The next packet may add a thin Manifest V3 host that projects `chrome.tabs` lifecycle fields into the pure records and executes operator-authorized focus/discard/protection actions. The host should persist only bounded lane identity and lifecycle metadata needed to survive extension service-worker restarts.

Persistent CDP/debugger attachment, response interception, page-content caches, and deep provider adapters stay outside this packet. Any later debugger use should be explicit-operation scoped where practical.

## Benchmark contract

#116 should compare at least:

1. stock loaded tabs;
2. stock Memory Saver / natural discard;
3. explicit native discard;
4. Elatura lifecycle policy using browser fields plus tiny sentinels;
5. deeper reads only after the preceding level demonstrates value.

Measure revisit intervals rather than one static peak. Record memory residency, background CPU, wake latency and CPU, reload bytes, application fidelity, unnecessary reads/visits, and missed attention events. The useful result is the break-even region between keeping an application warm and discarding/restoring it.

Google Docs #118 remains a demanding control: browser-only lifecycle management or one tiny save/safety sentinel is a valid success. Reconstructing its editor, caret, collaboration, or canvas internals is outside the intended adapter economics.
