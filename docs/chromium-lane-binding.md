# Chromium application-lane binding

Status: pure reconciliation seam for #123/#129/#117  
Durable lane contract: `@elatura/core/application-lane`  
Residency policy: `@elatura/core/application-lane-lifecycle`

## Purpose

The zero-content Chromium host exposes browser-session projections such as:

```text
chrome-session-tab-17
```

The consumer-facing application-lane protocol exposes durable logical identity:

```text
laneRef + laneGeneration
```

`extension/chromium/src/binding.ts` is the pure seam between them. It does not discover which tab represents a chat/document/application lane. A trusted local binding source must explicitly associate one exact lane generation with one current projection.

The binding is ephemeral transport state. It contains the private `projectionRef` and numeric tab id alongside the exact durable lane generation. It grants zero work, provider, browser-profile, or application authority by itself.

## Exact reconciliation

A binding matches only when all of these remain true:

- `laneRef` matches the current canonical descriptor;
- `laneGeneration` matches the current generation;
- `projectionRef` matches the current browser projection;
- numeric tab id matches that projection.

Generation advance or browser projection replacement makes the binding unusable before application lifecycle facts are considered.

## Combining browser and application fidelity

The unbound Chromium projection intentionally carries:

```text
application_unknown
freezeEligibility = unknown
 discardEligibility = unknown
```

After an exact binding match, a reviewed application adapter may supply generation-bound recovery and freeze/discard eligibility facts. The pure binding planner then:

1. removes only the `application_unknown` blocker;
2. retains browser blockers such as media/device activity and manual protection;
3. unions application-specific blockers such as unsaved interaction;
4. lets any browser or application `blocked` result win;
5. runs the canonical `planApplicationLaneResidencyV1()` planner;
6. emits the exact combined fact set, lifecycle decision, and Chromium transport effect.

The application cannot weaken a browser-level blocked state.

## Current effect mapping

### `responsive`

A loaded or wakeable bound lane maps to:

```text
keep_warm
```

The reviewed Chromium host implements that as protection from automatic discard plus background reload request when already discarded. Foreground Wake remains a different action.

### `reclaimable`

A bound lane maps to:

```text
discard
```

only when the canonical planner returns `discard` after both browser and application eligibility are reconciled. Media activity, manual protection, unsaved state, stale generation, recovery-needed state, or unknown application safety prevents that effect.

### `suspended`

The current stock-extension host has no reviewed forced-freeze actuator. The binding plan reports `unsupported` when a new freeze would be required. A projection already observed as frozen satisfies the posture with no further effect.

## Pure boundary

The binding module:

- calls no Chrome API;
- reads no URL/title/content/DOM/storage/network data;
- persists no binding;
- performs no browser effect;
- owns no discovery logic;
- owns no scheduler/priority/work authority.

The Chromium repository gate scans the binding source and refuses browser API growth there.

## Next physical seam

A later transport executor may consume a **matched plan** and current projection, execute only the selected reviewed effect (`keep_warm` or `discard`), then return a generation-bound effect receipt.

The trusted binding source remains the harder application-specific question. ChatGPT/Google Docs experiments should earn that source through existing adapter/fidelity work rather than inferring logical identity from browser tab ids, titles, or URLs.
