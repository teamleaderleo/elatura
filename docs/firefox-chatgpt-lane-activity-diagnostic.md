# Firefox ChatGPT activity diagnostic export

Status: supplemental physical probe for #116  
Producer: #168  
Exact-target route: #172  
Document/route projection fence: #173  
Volatile operator binding: #174  
Canonical observation contract: `@elatura/adapter-chatgpt/lane-activity`

## Purpose

The Firefox popup can export one fresh, canonical, content-free ChatGPT activity observation from the exact page epoch currently bound to an Elatura lane generation.

This export is a physical-dogfood aid for the frozen live application-lane benchmark. It gives the operator a machine-checkable record of the same blocker state shown in the popup while preserving the producer's original observation timestamp.

The diagnostic is supplemental evidence. It does not extend the preregistered resource-run or projection-ledger schemas and does not change the benchmark treatment.

## When to collect

For Firefox+Elatura ChatGPT resource subruns, collect activity diagnostics only after the primary resource sampler has stopped, alongside the other optional DOM/runtime and recovery probes.

Do not sample or export from this panel during the primary 2-second process-tree resource interval unless a later preregistered experiment explicitly includes that observer cost as part of the treatment.

Useful physical states to sample across matched attempts include:

- active generation;
- dirty composer;
- IME/composition activity;
- modal activity;
- active media;
- quiet foreground/background residency;
- post-reload or post-route-change recovery after explicit rebind.

## Operator sequence

1. Open the intended ChatGPT page in Firefox.
2. Open the Elatura popup.
3. Enter the canonical Elatura `laneRef` and positive `laneGeneration` for that run. The benchmark pairing token is a separate identity and must not be substituted here.
4. Choose **Bind active page**.
5. Use **Sample state** when a visible fixed-token readout is useful.
6. Choose **Export diagnostic** to request a new sample and download the canonical observation JSON.
7. If the page route, reload, or document epoch changed, the binding becomes stale. Bind the active page again before collecting another diagnostic.

The diagnostic exporter maintains its own popup-lifetime binding and clears it when either lane-target input changes or a stale/unavailable/invalid sample is returned.

## Exported record

The downloaded JSON is exactly the reviewed ChatGPT activity observation shape:

```text
version
laneRef
laneGeneration
observedAtMs
source
confidence
generation
composer
composition
modal
mediaOrDevice
download
otherTransient
grantsWorkAuthority
authorizesWorkDispatch
```

It contains no Firefox tab id, private document projection reference, profile id, URL, page title, transcript text, prompt text, generated answer, DOM selector, cookie, credential, or request body.

The exported `observedAtMs` comes from the page producer. The filename timestamp records only when the operator downloaded the file.

## Validate offline

Run the canonical adapter parser over one or more exported diagnostics:

```sh
npm run benchmark:chatgpt-activity -- \
  artifacts/live-application-lane/diagnostics/chatgpt-single/<run-id>/elatura-chatgpt-activity-....json
```

A valid file emits a fixed content-free receipt such as:

```text
pass source=reviewed-live-sentinel confidence=probable privacy=content-free
```

Invalid/decorated records fail with fixed tokens. The checker never prints lane references or observation payload values.

## Artifact placement

Keep these files outside every resource-stage `final/` directory. A suggested layout is:

```text
artifacts/live-application-lane/
  diagnostics/
    chatgpt-single/
      <run-id>/
    chatgpt-switch-8/
      <run-id>/
```

The strict `live-lane:check` final bundles remain limited to their preregistered run manifest and projection ledger files.

## Interpretation ceiling

The exported observation is activity evidence only. The canonical transition assessor also requires a matching verified conversation-recovery assessment and a fresh assessment time.

The current Firefox producer is intentionally conservative. Quiet pages can remain `probable` because download/device/other transient dimensions are only partially observable. Active signals can therefore establish blockers, while a quiet sample may still leave transition eligibility unknown.

ChatGPT v1 destructive discard eligibility remains `unknown` even after verified continuity plus an exact fully idle observation. This diagnostic export grants zero lifecycle authority, zero work authority, and zero dispatch authority.
