# Chromium browser-local effect executor

Status: transport effect seam for #123/#129/#117  
Binding planner: `extension/chromium/src/binding.ts`  
Browser host: `extension/chromium/static/background.js`

## Purpose

The generation-bound binding planner can decide that one exact application lane/current projection deserves either:

```text
keep_warm
discard
```

The Chromium service worker should still avoid carrying durable application-lane identity. The browser-local effect contract removes `laneRef + laneGeneration` before crossing that boundary.

A caller that retains the matched generation-bound plan creates:

```text
{
  version: 1,
  requestRef,
  projectionRef,
  tabId,
  effect
}
```

The correlation token is bounded and opaque. The effect request carries no URL, title, application content, lane reference, lane generation, task, owner, mission, or work authority.

## Immediate projection revalidation

The service worker never acts from the caller's earlier projection snapshot alone.

For `apply-effect` it:

1. parses the exact allowlisted effect request;
2. re-fetches the tab by numeric id;
3. rebuilds the current bounded projection;
4. requires current `projectionRef + tabId` to match the request;
5. only then enters the reviewed Keep warm or native-discard path;
6. native discard re-runs its existing fresh browser preflight;
7. returns a correlation-bound effect receipt.

A replaced or unavailable projection therefore produces no effect.

## Browser receipt

The browser receipt echoes only:

- request reference;
- projection reference;
- numeric tab id;
- selected effect;
- fixed outcome/reason;
- reduced post-effect projection: browser residency and auto-discardability.

The caller retains the generation-bound plan and matches the effect receipt to its request before treating it as evidence for that lane operation.

The service worker receipt describes browser execution only. Application readiness still requires the application recovery/fidelity probe. A background reload request can therefore be followed by `recovering`, `verified`, or `attention_required` application state at the higher layer.

## Effect semantics

### Keep warm

Uses the existing reviewed Keep warm implementation:

- protect the projection from Chromium automatic discard;
- request background reload if it was already discarded;
- leave foreground Wake separate.

### Discard

Uses the existing native discard implementation. Even after the application-layer planner approved discard, the service worker re-checks current browser-only eligibility immediately before `chrome.tabs.discard()`.

This creates two gates:

```text
application + browser plan eligibility
        ↓
browser-local effect request
        ↓
fresh browser projection/preflight
        ↓
physical effect
```

## Authority boundary

The service worker can prove only that it received a valid browser-local request and that the current projection matched. It cannot independently prove which durable lane plan produced the request. Durable generation truth stays with the caller/runtime.

The extension remains internal-only: the manifest has no `externally_connectable`, content scripts, native messaging, or remote endpoint in this packet.

## Next integration

A future local orchestrator/transport can keep the generation-bound plan, send its derived browser-local effect request through an explicitly reviewed local channel, and accept the effect only after matching the returned request reference and current lane generation.

The trusted application binding source remains separate. ChatGPT/Google Docs adapters must earn application identity and recovery facts rather than inferring them from Chromium tab ids, titles, or URLs.
