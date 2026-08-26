# Firefox ChatGPT lane-activity producer

Status: first physical producer for `@elatura/adapter-chatgpt/lane-activity`  
Host: existing Firefox ChatGPT content script  
Benchmark gate: #116

## Purpose

The ChatGPT lane-activity contract defines content-free transient-state observations and conservative transition eligibility. This Firefox packet supplies the first physical page producer using the host permission and content-script path Elatura already has for `https://chatgpt.com/*`.

The producer gains no additional host permission.

It accepts an explicit trusted target:

```text
laneRef + laneGeneration
```

and returns one fixed activity observation. It never derives application identity from the browser tab, page title, URL, visible conversation text, or DOM ids.

## Why Firefox first

The Chromium projection host intentionally remains zero-permission and content-free. Firefox already carries the reviewed ChatGPT content-script capability used by existing observation/slimming dogfood.

Using that existing path lets #116 test a real application-state producer without widening Chromium before evidence earns that cost.

## Page signals

The v1 producer reads only local state needed to classify fixed lifecycle blockers:

### Generation

Active when the page exposes an existing reviewed generation marker:

- ChatGPT stop button; or
- assistant streaming/busy marker.

When conversation-role markers exist and no generation marker is active, generation is reported inactive. Missing conversation markers produce `unknown`.

### Composer

The producer reuses the existing composer-like input selector already present in the Firefox content observer.

Exactly one recognized composer is classified as:

- `dirty` when it contains current text;
- `clean` when empty.

Missing or ambiguous composers produce `unknown`.

### IME composition

The content script runs from `document_start` and tracks `compositionstart` / `compositionend`. Active composition becomes the canonical `composition_active` blocker after assessment.

### Modal

An open native dialog or semantic `role=dialog` + `aria-modal=true` is reported active.

### Media

Currently playing HTML audio/video is reported active. Absence of playing media does not prove device/microphone inactivity, so the producer reports `mediaOrDevice=unknown` otherwise.

### Unsupported dimensions

Download state and other transient application state remain `unknown` in v1.

## Confidence rule

A directly observed blocker is emitted with `confidence=exact`:

- generation active;
- dirty composer;
- IME composition active;
- modal active;
- playing media.

An otherwise quiet snapshot is emitted as `probable` because device use, downloads, and other transient state remain outside this producer.

That asymmetry is deliberate. The producer can immediately prevent unsafe transitions, while quiet-state permission remains closed.

## Message boundary

The local producer listens for one extension-internal content-script message:

```text
elatura:sample-chatgpt-lane-activity
```

with an exact target object. Target parsing rejects additional browser/content decoration and accessor-backed fields.

The response contains only the reviewed lane-activity fields. It carries zero work/dispatch authority.

No externally-connectable endpoint, native messaging channel, network call, storage write, or automatic lifecycle effect is introduced.

## Boot path

`content.ts` loads `chatgpt-lane-activity-producer.js` through the same local extension-module pattern used by the existing slim-content controller.

The module is added to the current ChatGPT-only web-accessible resource group so the content-script dynamic import can load it. Existing host permissions are unchanged.

## Current evidence ceiling

This producer is expected to block real active states under physical dogfood. Its quiet observation remains conservative and therefore cannot earn `freezeEligibility=allowed` through the v1 activity assessor.

That is useful evidence: #116 can measure which live states the inexpensive producer classifies reliably and which remain unknown before Elatura spends more permission, adapter, or browser complexity.

## Next gate

Exercise the producer during the frozen ChatGPT benchmark stages across:

- active generation;
- typed-but-unsent composer text;
- IME composition;
- open modal UI;
- active media where reproducible;
- ordinary idle background residency;
- Keep warm reload/recovery.

Record only the fixed activity tokens, confidence, freshness, and canonical blocker outcomes. If quiet-state unknowns dominate useful lifecycle decisions, the next packet should target the smallest missing signal with measured value.
