# Firefox ChatGPT lane-activity sampling route

Status: extension-internal sampling bridge with document/route projection fencing  
Physical producer: `extension/firefox/src/chatgpt-lane-activity-producer.ts`  
Canonical activity contract: `@elatura/adapter-chatgpt/lane-activity`  
Benchmark gate: #116

## Purpose

The Firefox ChatGPT producer can classify current blocker state once it receives an exact `laneRef + laneGeneration`. The benchmark/runtime side also knows the current ephemeral Firefox tab projection.

A tab id alone is too weak for this binding. ChatGPT can navigate between conversations inside one browser tab, including client-side route changes that preserve the tab id and the content-script document.

The v2 route therefore adds one more private projection fence:

```text
documentProjectionRef
```

The content producer owns that token. It is created randomly for the loaded document/route epoch and rotates when the locally observed ChatGPT route changes. The raw route location is used only inside the content script to notice a change; it never enters a response or benchmark artifact.

## Two-step flow

The route is explicit:

```text
trusted extension caller
  -> discover requestRef + explicit tabId
  -> Firefox background
  -> content producer returns current documentProjectionRef

trusted caller verifies/binds that current projection to laneRef + laneGeneration

trusted extension caller
  -> requestRef + tabId + documentProjectionRef + laneRef + laneGeneration
  -> Firefox background
  -> content producer compares expected documentProjectionRef to current epoch
  -> sampled observation OR projection_mismatch
  -> background strict reconstruction / projection + lane-generation match
  -> correlation-bound receipt
```

The content producer never receives its tab id. It never derives canonical lane identity from the page route.

## Document/route projection discovery

The extension-internal discovery message is:

```text
elatura:get-chatgpt-document-projection-on-tab
```

with:

```text
version = 1
requestRef
explicit tabId
```

Background forwards only:

```text
elatura:get-chatgpt-document-projection
```

to that exact tab.

A valid response contains only:

- protocol version;
- private `documentProjectionRef`;
- local observation time;
- zero work/dispatch authority.

Discovery does not claim which logical application lane the page represents. A trusted caller still needs the ChatGPT application continuity/binding evidence before associating this private document projection with a canonical lane generation.

## Activity route v2

The activity request contains only:

- protocol version 2;
- bounded opaque `requestRef`;
- numeric Firefox tab id;
- expected private `documentProjectionRef`;
- exact canonical lane ref;
- exact canonical lane generation.

The runtime message type remains:

```text
elatura:sample-chatgpt-lane-activity-on-tab
```

Background forwards the content message:

```text
elatura:sample-chatgpt-lane-activity
```

with only:

```text
laneRef + laneGeneration + documentProjectionRef
```

## Same-tab navigation fence

Before every discovery or sample response, the producer compares its private current route key with the last observed route key.

When the route changes it rotates `documentProjectionRef`.

A later request carrying the older token receives:

```text
status = projection_mismatch
observation = null
```

Background converts this into:

```text
outcome = stale_projection
reason = document_projection_mismatch
observation = null
```

This closes the case where the same Firefox tab id now displays a different ChatGPT conversation/document realization.

A page reload also receives a fresh token because the content script starts again in a new document.

## Caller boundary

Background refuses both discovery and cross-tab activity routing when `runtime.onMessage` reports a sending tab. Content scripts may continue reporting their own existing passive page metrics, while they cannot ask background to discover or sample another tab.

The route remains extension-internal. The manifest has no `externally_connectable` entry and adds no native messaging or remote endpoint.

## Response admission

Background treats every content-script reply as untrusted.

`chatgpt-lane-activity-route.ts` reconstructs exact own-data records only. It refuses:

- unknown fields;
- accessors/symbol decoration;
- malformed tokens/timestamps;
- work/dispatch authority claims;
- content-bearing decoration;
- wrong document projection;
- wrong lane ref;
- wrong lane generation.

A response from a different current document projection is suppressed before the activity observation is returned to the caller.

Accepted observations remain covered by tests that pass them through `parseChatGptLaneActivityObservationV1()` from the canonical adapter contract.

## Closed receipts

Document discovery outcomes are:

```text
resolved
unavailable
invalid_response
browser_error
```

Activity outcomes are:

```text
sampled
stale_projection
unavailable
invalid_response
mismatched_response
browser_error
```

Failed activity receipts carry no observation.

The caller correlates:

```text
requestRef + tabId + documentProjectionRef + laneRef + laneGeneration
```

before consuming a sampled activity receipt.

## Browser behavior

Background uses only explicit:

```text
browser.tabs.sendMessage(request.tabId, ...)
```

for discovery and sampling. It never queries the active/current tab for this route.

This route performs no navigation, activation, freeze, discard, reload, storage write, or page mutation.

## Relationship to lifecycle planning

A sampled activity record is current application evidence only. The caller combines it with:

- exact ChatGPT continuity/recovery;
- canonical lane generation ownership;
- current private document projection binding;
- browser projection/fidelity facts;
- requested residency posture.

The merged ChatGPT activity assessor remains conservative: the current Firefox producer provides exact blocker evidence, while ordinary quiet samples remain probable/partially unknown and therefore cannot earn destructive lifecycle permission.

## Evidence boundary

For #116, final preregistered projection artifacts stay unchanged. The private `documentProjectionRef` and raw route key remain local transaction state.

Useful diagnostics may retain fixed route outcomes such as `sampled` or `stale_projection`, plus canonical activity confidence/blocker results. Private routes, page content, raw DOM, account identity, cookies, request bodies, credentials, and exception text stay outside committed evidence.
