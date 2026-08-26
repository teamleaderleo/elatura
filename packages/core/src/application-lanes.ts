// SPDX-License-Identifier: MPL-2.0

/**
 * Consumer-neutral application-lane contracts and pure planning helpers.
 *
 * This module owns no browser effects and no work scheduling. A caller supplies
 * current browser/application facts plus a requested residency or observation
 * intent; Elatura returns the smallest proposed action that is supported by
 * those facts. Browser transports remain responsible for executing any action
 * through their separately reviewed authorization and recovery paths.
 */
export const APPLICATION_LANE_CONTRACT_VERSION = 1 as const;

export type LaneResidencyState =
  | "foreground"
  | "background"
  | "frozen"
  | "discarded"
  | "reloading"
  | "missing";

export type LaneRecoveryState =
  | "verified"
  | "recoverable"
  | "recovering"
  | "attention-required"
  | "drifted"
  | "unavailable";

export type LaneSignalClass =
  | "none"
  | "changed"
  | "generating"
  | "idle"
  | "possible-completion"
  | "error"
  | "drifted"
  | "parked"
  | "discarded-or-unavailable"
  | "recovery-needed";

export type LaneSignalConfidence = "exact" | "probable" | "unknown";

export type LaneInterventionLevel =
  | "stock"
  | "browser-lifecycle"
  | "render-suppression"
  | "dom-window"
  | "bounded-representation"
  | "response-transform";

export type LaneEligibilityState = "allowed" | "blocked" | "unknown";

export type LaneLifecycleBlocker =
  | "active-generation"
  | "unsaved-interaction"
  | "save-in-progress"
  | "composition-active"
  | "modal-interaction"
  | "collaboration-active"
  | "media-or-device-active"
  | "download-active"
  | "application-unknown"
  | "manual-protection";

export type ApplicationLaneProjection = Readonly<{
  projectionKey: string | null;
  residency: LaneResidencyState;
  recovery: LaneRecoveryState;
}>;

export type ApplicationLaneSignal = Readonly<{
  kind: LaneSignalClass;
  confidence: LaneSignalConfidence;
  observedAt: number;
}>;

export type ApplicationLaneEligibility = Readonly<{
  freeze: LaneEligibilityState;
  discard: LaneEligibilityState;
  blockers: readonly LaneLifecycleBlocker[];
}>;

export type ApplicationLaneSnapshot = Readonly<{
  contractVersion: typeof APPLICATION_LANE_CONTRACT_VERSION;
  laneKey: string;
  applicationClass: string;
  generation: number;
  observedAt: number;
  intervention: LaneInterventionLevel;
  projection: ApplicationLaneProjection;
  signal: ApplicationLaneSignal;
  eligibility: ApplicationLaneEligibility;
}>;

/**
 * Requested resource posture from an external consumer.
 *
 * `responsive` is the intentionally small "keep this lane warm" primitive:
 * loaded and runnable, without requiring foreground focus. `suspended` permits
 * a resident browser freeze when the workload has earned that transition.
 * `reclaimable` permits the browser to discard the page when reload fidelity
 * has been proven by the application-specific eligibility probe.
 */
export type LaneResidencyIntent =
  | "interactive"
  | "responsive"
  | "suspended"
  | "reclaimable";

export type ApplicationLaneLifecycleRequest = Readonly<{
  contractVersion: typeof APPLICATION_LANE_CONTRACT_VERSION;
  laneKey: string;
  expectedGeneration: number;
  intent: LaneResidencyIntent;
}>;

export type ApplicationLaneLifecycleCapabilities = Readonly<{
  canWake: boolean;
  canActivate: boolean;
  canFreeze: boolean;
  canDiscard: boolean;
  canRecoverProjection: boolean;
}>;

export type LaneLifecycleAction =
  | "none"
  | "wake"
  | "activate"
  | "freeze"
  | "discard"
  | "recover-projection"
  | "wait"
  | "attention-required";

export type LaneLifecycleReason =
  | "already-satisfied"
  | "already-reclaimed"
  | "lane-mismatch"
  | "stale-generation"
  | "recovery-in-progress"
  | "recovery-required"
  | "projection-recovery-required"
  | "foreground-protected"
  | "wake-required"
  | "activation-required"
  | "freeze-eligible"
  | "discard-eligible"
  | "discard-fallback-freeze"
  | "freeze-blocked"
  | "discard-blocked"
  | "eligibility-unknown"
  | "capability-unavailable";

export type ApplicationLaneLifecycleDecision = Readonly<{
  laneKey: string;
  generation: number;
  action: LaneLifecycleAction;
  reason: LaneLifecycleReason;
}>;

export type LaneObservationLevel =
  | "signal"
  | "bounded-view"
  | "screenshot"
  | "activation";

export type LaneBoundedViewState = "fresh" | "stale" | "unavailable";

export type ApplicationLaneObservationRequest = Readonly<{
  requested: LaneObservationLevel;
  allowStaleBoundedView: boolean;
}>;

export type ApplicationLaneObservationCapabilities = Readonly<{
  boundedView: LaneBoundedViewState;
  canScreenshot: boolean;
  canActivate: boolean;
}>;

export type LaneObservationAction = LaneObservationLevel | "attention-required";

export type LaneObservationReason =
  | "signal-sufficient"
  | "fresh-bounded-view"
  | "stale-bounded-view-admitted"
  | "screenshot-required"
  | "activation-required"
  | "recovery-required"
  | "capability-unavailable";

export type ApplicationLaneObservationDecision = Readonly<{
  laneKey: string;
  generation: number;
  action: LaneObservationAction;
  reason: LaneObservationReason;
}>;

const LANE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const APPLICATION_CLASS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PROJECTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const RESIDENCY_STATES: readonly LaneResidencyState[] = Object.freeze([
  "foreground",
  "background",
  "frozen",
  "discarded",
  "reloading",
  "missing",
]);
const RECOVERY_STATES: readonly LaneRecoveryState[] = Object.freeze([
  "verified",
  "recoverable",
  "recovering",
  "attention-required",
  "drifted",
  "unavailable",
]);
const SIGNAL_CLASSES: readonly LaneSignalClass[] = Object.freeze([
  "none",
  "changed",
  "generating",
  "idle",
  "possible-completion",
  "error",
  "drifted",
  "parked",
  "discarded-or-unavailable",
  "recovery-needed",
]);
const SIGNAL_CONFIDENCES: readonly LaneSignalConfidence[] = Object.freeze([
  "exact",
  "probable",
  "unknown",
]);
const INTERVENTION_LEVELS: readonly LaneInterventionLevel[] = Object.freeze([
  "stock",
  "browser-lifecycle",
  "render-suppression",
  "dom-window",
  "bounded-representation",
  "response-transform",
]);
const ELIGIBILITY_STATES: readonly LaneEligibilityState[] = Object.freeze([
  "allowed",
  "blocked",
  "unknown",
]);
const LIFECYCLE_BLOCKERS: readonly LaneLifecycleBlocker[] = Object.freeze([
  "active-generation",
  "unsaved-interaction",
  "save-in-progress",
  "composition-active",
  "modal-interaction",
  "collaboration-active",
  "media-or-device-active",
  "download-active",
  "application-unknown",
  "manual-protection",
]);
const RESIDENCY_INTENTS: readonly LaneResidencyIntent[] = Object.freeze([
  "interactive",
  "responsive",
  "suspended",
  "reclaimable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const expected = new Set(allowed);
  const actual = Object.keys(value);
  if (actual.length !== allowed.length || actual.some((key) => !expected.has(key))) {
    throw new TypeError(`${name} contains missing or unknown fields.`);
  }
}

function ownData(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`Expected own data property: ${key}`);
  }
  return descriptor.value;
}

function finiteInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function boundedToken(
  value: unknown,
  pattern: RegExp,
  name: string,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${name} must be a bounded opaque token.`);
  }
  return value;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${name} has an unsupported value.`);
  }
  return value as T;
}

function parseProjection(input: unknown): ApplicationLaneProjection {
  if (!isRecord(input)) {
    throw new TypeError("projection must be an object.");
  }
  exactKeys(input, ["projectionKey", "residency", "recovery"], "projection");
  const projectionKeyInput = ownData(input, "projectionKey");
  const projectionKey = projectionKeyInput === null
    ? null
    : boundedToken(projectionKeyInput, PROJECTION_KEY_PATTERN, "projectionKey");
  return Object.freeze({
    projectionKey,
    residency: parseEnum(ownData(input, "residency"), RESIDENCY_STATES, "residency"),
    recovery: parseEnum(ownData(input, "recovery"), RECOVERY_STATES, "recovery"),
  });
}

function parseSignal(input: unknown): ApplicationLaneSignal {
  if (!isRecord(input)) {
    throw new TypeError("signal must be an object.");
  }
  exactKeys(input, ["kind", "confidence", "observedAt"], "signal");
  return Object.freeze({
    kind: parseEnum(ownData(input, "kind"), SIGNAL_CLASSES, "signal.kind"),
    confidence: parseEnum(
      ownData(input, "confidence"),
      SIGNAL_CONFIDENCES,
      "signal.confidence",
    ),
    observedAt: finiteInteger(ownData(input, "observedAt"), "signal.observedAt"),
  });
}

function parseBlockers(input: unknown): readonly LaneLifecycleBlocker[] {
  if (!Array.isArray(input) || input.length > 16) {
    throw new RangeError("eligibility.blockers must contain at most 16 entries.");
  }
  const result: LaneLifecycleBlocker[] = [];
  const seen = new Set<LaneLifecycleBlocker>();
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError("eligibility.blockers must contain data elements only.");
    }
    const blocker = parseEnum(
      descriptor.value,
      LIFECYCLE_BLOCKERS,
      `eligibility.blockers[${index}]`,
    );
    if (seen.has(blocker)) {
      throw new TypeError("eligibility.blockers contains a duplicate value.");
    }
    seen.add(blocker);
    result.push(blocker);
  }
  return Object.freeze(result);
}

function parseEligibility(input: unknown): ApplicationLaneEligibility {
  if (!isRecord(input)) {
    throw new TypeError("eligibility must be an object.");
  }
  exactKeys(input, ["freeze", "discard", "blockers"], "eligibility");
  return Object.freeze({
    freeze: parseEnum(ownData(input, "freeze"), ELIGIBILITY_STATES, "eligibility.freeze"),
    discard: parseEnum(
      ownData(input, "discard"),
      ELIGIBILITY_STATES,
      "eligibility.discard",
    ),
    blockers: parseBlockers(ownData(input, "blockers")),
  });
}

/** Parse a content-minimized lane snapshot without admitting free-form page data. */
export function parseApplicationLaneSnapshot(input: unknown): ApplicationLaneSnapshot {
  if (!isRecord(input)) {
    throw new TypeError("Application lane snapshot must be an object.");
  }
  exactKeys(
    input,
    [
      "contractVersion",
      "laneKey",
      "applicationClass",
      "generation",
      "observedAt",
      "intervention",
      "projection",
      "signal",
      "eligibility",
    ],
    "Application lane snapshot",
  );
  if (ownData(input, "contractVersion") !== APPLICATION_LANE_CONTRACT_VERSION) {
    throw new TypeError("Unsupported application lane contract version.");
  }

  const observedAt = finiteInteger(ownData(input, "observedAt"), "observedAt");
  const signal = parseSignal(ownData(input, "signal"));
  if (signal.observedAt > observedAt) {
    throw new RangeError("signal.observedAt cannot be newer than the lane snapshot.");
  }

  return Object.freeze({
    contractVersion: APPLICATION_LANE_CONTRACT_VERSION,
    laneKey: boundedToken(ownData(input, "laneKey"), LANE_KEY_PATTERN, "laneKey"),
    applicationClass: boundedToken(
      ownData(input, "applicationClass"),
      APPLICATION_CLASS_PATTERN,
      "applicationClass",
    ),
    generation: finiteInteger(ownData(input, "generation"), "generation"),
    observedAt,
    intervention: parseEnum(
      ownData(input, "intervention"),
      INTERVENTION_LEVELS,
      "intervention",
    ),
    projection: parseProjection(ownData(input, "projection")),
    signal,
    eligibility: parseEligibility(ownData(input, "eligibility")),
  });
}

export function parseApplicationLaneLifecycleRequest(
  input: unknown,
): ApplicationLaneLifecycleRequest {
  if (!isRecord(input)) {
    throw new TypeError("Application lane lifecycle request must be an object.");
  }
  exactKeys(
    input,
    ["contractVersion", "laneKey", "expectedGeneration", "intent"],
    "Application lane lifecycle request",
  );
  if (ownData(input, "contractVersion") !== APPLICATION_LANE_CONTRACT_VERSION) {
    throw new TypeError("Unsupported application lane lifecycle request version.");
  }
  return Object.freeze({
    contractVersion: APPLICATION_LANE_CONTRACT_VERSION,
    laneKey: boundedToken(ownData(input, "laneKey"), LANE_KEY_PATTERN, "laneKey"),
    expectedGeneration: finiteInteger(
      ownData(input, "expectedGeneration"),
      "expectedGeneration",
    ),
    intent: parseEnum(ownData(input, "intent"), RESIDENCY_INTENTS, "intent"),
  });
}

function lifecycleDecision(
  snapshot: ApplicationLaneSnapshot,
  action: LaneLifecycleAction,
  reason: LaneLifecycleReason,
): ApplicationLaneLifecycleDecision {
  return Object.freeze({
    laneKey: snapshot.laneKey,
    generation: snapshot.generation,
    action,
    reason,
  });
}

function recoveryBlocksLifecycle(recovery: LaneRecoveryState): boolean {
  return recovery === "attention-required" || recovery === "drifted" || recovery === "unavailable";
}

/**
 * Propose a browser residency transition from explicit current facts.
 *
 * Attention signals never grant lifecycle eligibility. For example,
 * `possible-completion` can influence an external consumer's desired intent,
 * while `eligibility.discard` independently decides whether Elatura may
 * propose a discard. This keeps attention routing separate from application
 * fidelity.
 */
export function planApplicationLaneLifecycle(
  snapshot: ApplicationLaneSnapshot,
  request: ApplicationLaneLifecycleRequest,
  capabilities: ApplicationLaneLifecycleCapabilities,
): ApplicationLaneLifecycleDecision {
  if (request.laneKey !== snapshot.laneKey) {
    return lifecycleDecision(snapshot, "none", "lane-mismatch");
  }
  if (request.expectedGeneration !== snapshot.generation) {
    return lifecycleDecision(snapshot, "none", "stale-generation");
  }

  const { residency, recovery } = snapshot.projection;
  if (recoveryBlocksLifecycle(recovery)) {
    return lifecycleDecision(snapshot, "attention-required", "recovery-required");
  }
  if (recovery === "recovering" || residency === "reloading") {
    return lifecycleDecision(snapshot, "wait", "recovery-in-progress");
  }
  if (residency === "missing") {
    if (request.intent === "reclaimable" && recovery === "recoverable") {
      return lifecycleDecision(snapshot, "none", "already-reclaimed");
    }
    if (capabilities.canRecoverProjection && recovery === "recoverable") {
      return lifecycleDecision(
        snapshot,
        "recover-projection",
        "projection-recovery-required",
      );
    }
    return lifecycleDecision(snapshot, "attention-required", "recovery-required");
  }

  switch (request.intent) {
    case "interactive":
      if (residency === "foreground") {
        return lifecycleDecision(snapshot, "none", "already-satisfied");
      }
      if (capabilities.canActivate) {
        return lifecycleDecision(snapshot, "activate", "activation-required");
      }
      return lifecycleDecision(snapshot, "attention-required", "capability-unavailable");

    case "responsive":
      if (residency === "foreground" || residency === "background") {
        return lifecycleDecision(snapshot, "none", "already-satisfied");
      }
      if (capabilities.canWake) {
        return lifecycleDecision(snapshot, "wake", "wake-required");
      }
      return lifecycleDecision(snapshot, "attention-required", "capability-unavailable");

    case "suspended":
      if (residency === "foreground") {
        return lifecycleDecision(snapshot, "none", "foreground-protected");
      }
      if (residency === "frozen" || residency === "discarded") {
        return lifecycleDecision(snapshot, "none", "already-satisfied");
      }
      if (snapshot.eligibility.freeze === "unknown") {
        return lifecycleDecision(snapshot, "none", "eligibility-unknown");
      }
      if (snapshot.eligibility.freeze === "blocked") {
        return lifecycleDecision(snapshot, "none", "freeze-blocked");
      }
      if (capabilities.canFreeze) {
        return lifecycleDecision(snapshot, "freeze", "freeze-eligible");
      }
      return lifecycleDecision(snapshot, "none", "capability-unavailable");

    case "reclaimable":
      if (residency === "foreground") {
        return lifecycleDecision(snapshot, "none", "foreground-protected");
      }
      if (residency === "discarded") {
        return lifecycleDecision(snapshot, "none", "already-reclaimed");
      }
      if (snapshot.eligibility.discard === "allowed" && capabilities.canDiscard) {
        return lifecycleDecision(snapshot, "discard", "discard-eligible");
      }
      if (
        residency === "background" &&
        snapshot.eligibility.freeze === "allowed" &&
        capabilities.canFreeze
      ) {
        return lifecycleDecision(snapshot, "freeze", "discard-fallback-freeze");
      }
      if (snapshot.eligibility.discard === "unknown") {
        return lifecycleDecision(snapshot, "none", "eligibility-unknown");
      }
      if (snapshot.eligibility.discard === "blocked") {
        return lifecycleDecision(snapshot, "none", "discard-blocked");
      }
      return lifecycleDecision(snapshot, "none", "capability-unavailable");
  }
}

function observationDecision(
  snapshot: ApplicationLaneSnapshot,
  action: LaneObservationAction,
  reason: LaneObservationReason,
): ApplicationLaneObservationDecision {
  return Object.freeze({
    laneKey: snapshot.laneKey,
    generation: snapshot.generation,
    action,
    reason,
  });
}

function isResidentPage(residency: LaneResidencyState): boolean {
  return residency === "foreground" || residency === "background" || residency === "frozen";
}

/**
 * Plan one observation rung. Unsupported cheaper views escalate toward visual
 * inspection and then genuine application activation; the planner never
 * fabricates semantic state to satisfy a request.
 */
export function planApplicationLaneObservation(
  snapshot: ApplicationLaneSnapshot,
  request: ApplicationLaneObservationRequest,
  capabilities: ApplicationLaneObservationCapabilities,
): ApplicationLaneObservationDecision {
  if (request.requested === "signal") {
    return observationDecision(snapshot, "signal", "signal-sufficient");
  }
  if (recoveryBlocksLifecycle(snapshot.projection.recovery)) {
    return observationDecision(snapshot, "attention-required", "recovery-required");
  }

  if (request.requested === "bounded-view") {
    if (capabilities.boundedView === "fresh") {
      return observationDecision(snapshot, "bounded-view", "fresh-bounded-view");
    }
    if (capabilities.boundedView === "stale" && request.allowStaleBoundedView) {
      return observationDecision(
        snapshot,
        "bounded-view",
        "stale-bounded-view-admitted",
      );
    }
    if (capabilities.canScreenshot && isResidentPage(snapshot.projection.residency)) {
      return observationDecision(snapshot, "screenshot", "screenshot-required");
    }
    if (capabilities.canActivate) {
      return observationDecision(snapshot, "activation", "activation-required");
    }
    return observationDecision(snapshot, "attention-required", "capability-unavailable");
  }

  if (request.requested === "screenshot") {
    if (capabilities.canScreenshot && isResidentPage(snapshot.projection.residency)) {
      return observationDecision(snapshot, "screenshot", "screenshot-required");
    }
    if (capabilities.canActivate) {
      return observationDecision(snapshot, "activation", "activation-required");
    }
    return observationDecision(snapshot, "attention-required", "capability-unavailable");
  }

  if (capabilities.canActivate) {
    return observationDecision(snapshot, "activation", "activation-required");
  }
  return observationDecision(snapshot, "attention-required", "capability-unavailable");
}
