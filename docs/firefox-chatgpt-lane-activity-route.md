# Firefox ChatGPT lane-activity sampling route

Status: extension-internal sampling bridge  
Physical producer: `extension/firefox/src/chatgpt-lane-activity-producer.ts`  
Canonical activity contract: `@elatura/adapter-chatgpt/lane-activity`  
Benchmark gate: #116

## Purpose

The Firefox ChatGPT content producer can classify current blocker state once it receives an exact `laneRef + laneGeneration`. The benchmark/runtime side also knows the current ephemeral Firefox tab projection. This packet connects those two facts without asking the content script to discover browser or lane identity.

The route is explicit:

```text
trusted extension caller
  -> requestRef + tabId + laneRef + laneGeneration
  -> Firefox background
  -> tabs.sendMessage(explicit tabId)
  -> ChatGPT content producer receives lane target only
  -> fixed content-free activity observation
  -> background strict reconstruction / lane-generation match
  -> correlation-bound receipt
```

No active-tab lookup, URL/title matching, or DOM identity discovery participates in routing.

## Route request

One request contains only:

- protocol version;
- bounded opaque `requestRef`;
- numeric Firefox tab id;
- exact canonical lane ref;
- exact canonical lane generation.

The runtime message type is:

```text
elatura:sample-chatgpt-lane-activity-on-tab
```

The background forwards a separate content-script message:

```text
elatura:sample-chatgpt-lane-activity
```

with only:

```text
laneRef + laneGeneration
```

The content producer never receives its tab id.

## Caller boundary

The background refuses the cross-tab route when `runtime.onMessage` reports a sending tab. Content scripts may continue reporting their own existing passive page metrics, but they cannot ask background to sample another tab.

The route is therefore available to extension-internal contexts only. The manifest still has no `externally_connectable` entry and adds no native messaging or remote endpoint.

A later benchmark/operator integration can create the request from its already-known canonical lane generation and current Firefox projection.

## Response admission

Background treats the content-script reply as untrusted.

`chatgpt-lane-activity-route.ts` reconstructs the exact fixed activity record from own enumerable data properties only. It refuses:

- unknown fields;
- accessors/symbol decoration;
- malformed enums/timestamps;
- work/dispatch authority claims;
- content-bearing decoration;
- wrong lane ref;
- wrong lane generation.

Accepted observations are covered by tests that also pass them through `parseChatGptLaneActivityObservationV1()` from the canonical adapter contract.

A wrong-lane or malformed response is never echoed to the caller.

## Receipt

Every receipt echoes only:

- request correlation ref;
- explicit tab id;
- lane ref + generation;
- fixed outcome/reason;
- one canonical content-free observation when sampling succeeded;
- zero work and dispatch authority.

Outcomes are closed:

```text
sampled
unavailable
invalid_response
mismatched_response
browser_error
```

Each outcome has a fixed allowed reason family. Failed receipts carry no observation body.

The caller must correlate `requestRef + tabId + laneRef + laneGeneration` before consuming a receipt.

## Browser behavior

Background uses exactly:

```text
browser.tabs.sendMessage(request.tabId, ...)
```

It never queries the active/current tab for this route. If the explicit tab has no content producer or cannot receive the request, background returns a fixed `content_unavailable` receipt.

This route performs no navigation, activation, freeze, discard, reload, storage write, or page mutation.

## Relationship to lifecycle planning

A sampled activity record is still only current application evidence. The caller combines it with:

- exact ChatGPT continuity/recovery;
- canonical lane generation ownership;
- browser projection/fidelity facts;
- requested residency posture.

The merged ChatGPT activity assessor remains conservative: the current Firefox producer is expected to produce exact blocker evidence, while ordinary quiet samples remain probable/partially unknown and therefore cannot earn destructive lifecycle permission.

## Evidence boundary

For #116, the useful recorded fields are the fixed activity tokens, confidence/freshness, route outcome, and the canonical blocker/eligibility result derived later.

Private page content, browser URLs/titles, raw DOM, account identity, cookies, request bodies, credentials, and exception text stay outside the route and benchmark artifacts.
