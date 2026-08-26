// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "./application-lane.js";

export const APPLICATION_LANE_LIFECYCLE_VERSION = 1 as const;

/**
 * Consumer-requested resource posture.
 *
 * These values express desired availability, not browser implementation state.
 * `responsive` is the initial warm-lane primitive: keep the lane loaded and
 * runnable without requiring foreground focus. `suspended` allows an earned
 * resident browser freeze. `reclaimable` allows page discard when reload
 * fidelity has been proven for the current workload.
 */
export const applicationLaneResidencyIntents = [
  "responsive",
  "suspended",
  "reclaimable",
] as const;
export type ApplicationLaneResidencyIntent =
  (typeof applicationLaneResidencyIntents)[number];

/** Browser projection facts remain local implementation detail. */
export const applicationLaneBrowserResidencies = [
  "foreground",
  "background",
  "frozen",
  "discarded",
  "reloading",
  "missing",
] as const;
export type ApplicationLaneBrowserResidency =
  (typeof applicationLaneBrowserResidencies)[number];

export const applicationLaneRecoveryStates = [
  "verified",
  "recoverable",
  "recovering",
  "attention_required",
  "unavailable",
] as const;
export type ApplicationLaneRecoveryState =
  (typeof applicationLaneRecoveryStates)[number];

export const applicationLaneEligibilityStates = [
  "allowed",
  "blocked",
  "unknown",
] as const;
export type ApplicationLaneEligibilityState =
  (typeof applicationLaneEligibilityStates)[number];

export const applicationLaneLifecycleBlockers = [
  "active_generation",
  "unsaved_interaction",
  "save_in_progress",
  "composition_active",
  "modal_interaction",
  "collaboration_active",
  "media_or_device_active",
  "download_active",
  "application_unknown",
  "manual_protection",
] as const;
export type ApplicationLaneLifecycleBlocker =
  (typeof applicationLaneLifecycleBlockers)[number];

export type ApplicationLaneResidencyRequestV1 = Readonly<{
  version: typeof APPLICATION_LANE_LIFECYCLE_VERSION;
  laneRef: string;
  laneGeneration: number;
  intent: ApplicationLaneResidencyIntent;
}>;

export type ApplicationLaneLifecycleFactsV1 = Readonly<{
  version: typeof APPLICATION_LANE_LIFECYCLE_VERSION;
  laneRef: string;
  laneGeneration: number;
  browserResidency: ApplicationLaneBrowserResidency;
  recovery: ApplicationLaneRecoveryState;
  freezeEligibility: ApplicationLaneEligibilityState;
  discardEligibility: ApplicationLaneEligibilityState;
  blockers: readonly ApplicationLaneLifecycleBlocker[];
}>;

export type ApplicationLaneLifecycleCapabilities = Readonly<{
  canWake: boolean;
  canFreeze: boolean;
  canDiscard: boolean;
  canRecoverProjection: boolean;
}>;

export const applicationLaneLifecycleActions = [
  "none",
  "wake",
  "freeze",
  "discard",
  "recover_projection",
  "wait",
  "attention_required",
] as const;
export type ApplicationLaneLifecycleAction =
  (typeof applicationLaneLifecycleActions)[number];

export const applicationLaneLifecycleReasons = [
  "already_satisfied",
  "already_reclaimed",
  "lane_mismatch",
  "stale_generation",
  "stale_projection_facts",
  "recovery_in_progress",
  "recovery_required",
  "projection_recovery_required",
  "foreground_protected",
  "wake_required",
  "freeze_eligible",
  "discard_eligible",
  "discard_fallback_freeze",
  "freeze_blocked",
  "discard_blocked",
  "eligibility_unknown",
  "capability_unavailable",
] as const;
export type ApplicationLaneLifecycleReason =
  (typeof applicationLaneLifecycleReasons)[number];

export type ApplicationLaneLifecycleDecisionV1 = Readonly<{
  version: typeof APPLICATION_LANE_LIFECYCLE_VERSION;
  laneRef: string;
  laneGeneration: number;
  action: ApplicationLaneLifecycleAction;
  reason: ApplicationLaneLifecycleReason;
}>;

const MAX_BLOCKERS = 16;

/**
 * Bind a requested resource posture to the exact durable lane generation that
 * an external consumer previously observed through the application-lane
 * protocol. The returned request carries zero browser projection handles.
 */
export function createApplicationLaneResidencyRequestV1(
  descriptor: ApplicationLaneDescriptorV1,
  intent: ApplicationLaneResidencyIntent,
): ApplicationLaneResidencyRequestV1 {
  if (!applicationLaneResidencyIntents.includes(intent)) {
    throw new TypeError("Application lane residency intent is invalid");
  }
  return Object.freeze({
    version: APPLICATION_LANE_LIFECYCLE_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    intent,
  });
}

/**
 * Create content-minimized browser/application lifecycle facts for one exact
 * lane generation. Browser transports may retain tab/target/process handles
 * privately; none enter this contract.
 */
export function createApplicationLaneLifecycleFactsV1(
  descriptor: ApplicationLaneDescriptorV1,
  input: Readonly<{
    browserResidency: ApplicationLaneBrowserResidency;
    recovery: ApplicationLaneRecoveryState;
    freezeEligibility: ApplicationLaneEligibilityState;
    discardEligibility: ApplicationLaneEligibilityState;
    blockers?: readonly ApplicationLaneLifecycleBlocker[];
  }>,
): ApplicationLaneLifecycleFactsV1 {
  const browserResidency = exactEnum(
    input.browserResidency,
    applicationLaneBrowserResidencies,
    "Browser residency",
  );
  const recovery = exactEnum(
    input.recovery,
    applicationLaneRecoveryStates,
    "Lane recovery state",
  );
  const freezeEligibility = exactEnum(
    input.freezeEligibility,
    applicationLaneEligibilityStates,
    "Freeze eligibility",
  );
  const discardEligibility = exactEnum(
    input.discardEligibility,
    applicationLaneEligibilityStates,
    "Discard eligibility",
  );
  const blockers = lifecycleBlockers(input.blockers ?? []);

  return Object.freeze({
    version: APPLICATION_LANE_LIFECYCLE_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    browserResidency,
    recovery,
    freezeEligibility,
    discardEligibility,
    blockers,
  });
}

/**
 * Decide one browser-resource transition from an already parsed lane descriptor,
 * a generation-bound residency request, current content-minimized lifecycle
 * facts, and transport capabilities.
 *
 * This function performs no browser action. It intentionally does not inspect
 * lane events such as `possible_completion`: events may influence which intent
 * an external consumer requests, while freeze/discard eligibility independently
 * decides whether an aggressive resource transition is safe.
 */
export function planApplicationLaneResidencyV1(
  descriptor: ApplicationLaneDescriptorV1,
  facts: ApplicationLaneLifecycleFactsV1,
  request: ApplicationLaneResidencyRequestV1,
  capabilities: ApplicationLaneLifecycleCapabilities,
): ApplicationLaneLifecycleDecisionV1 {
  if (request.laneRef !== descriptor.laneRef) {
    return decision(descriptor, "none", "lane_mismatch");
  }
  if (request.laneGeneration !== descriptor.generation) {
    return decision(descriptor, "none", "stale_generation");
  }
  if (
    facts.laneRef !== descriptor.laneRef ||
    facts.laneGeneration !== descriptor.generation
  ) {
    return decision(descriptor, "attention_required", "stale_projection_facts");
  }

  if (
    descriptor.state === "unavailable" ||
    descriptor.state === "drifted" ||
    descriptor.state === "recovery_needed" ||
    facts.recovery === "attention_required" ||
    facts.recovery === "unavailable"
  ) {
    return decision(descriptor, "attention_required", "recovery_required");
  }

  if (
    facts.recovery === "recovering" ||
    facts.browserResidency === "reloading"
  ) {
    return decision(descriptor, "wait", "recovery_in_progress");
  }

  if (facts.browserResidency === "missing") {
    if (request.intent === "reclaimable") {
      return decision(descriptor, "none", "already_reclaimed");
    }
    if (
      facts.recovery === "recoverable" &&
      capabilities.canRecoverProjection
    ) {
      return decision(
        descriptor,
        "recover_projection",
        "projection_recovery_required",
      );
    }
    return decision(descriptor, "attention_required", "recovery_required");
  }

  switch (request.intent) {
    case "responsive":
      return planResponsive(descriptor, facts, capabilities);
    case "suspended":
      return planSuspended(descriptor, facts, capabilities);
    case "reclaimable":
      return planReclaimable(descriptor, facts, capabilities);
  }
}

function planResponsive(
  descriptor: ApplicationLaneDescriptorV1,
  facts: ApplicationLaneLifecycleFactsV1,
  capabilities: ApplicationLaneLifecycleCapabilities,
): ApplicationLaneLifecycleDecisionV1 {
  if (
    facts.browserResidency === "foreground" ||
    facts.browserResidency === "background"
  ) {
    return decision(descriptor, "none", "already_satisfied");
  }
  if (
    facts.browserResidency === "frozen" ||
    facts.browserResidency === "discarded"
  ) {
    if (capabilities.canWake) {
      return decision(descriptor, "wake", "wake_required");
    }
    return decision(descriptor, "attention_required", "capability_unavailable");
  }
  return decision(descriptor, "wait", "recovery_in_progress");
}

function planSuspended(
  descriptor: ApplicationLaneDescriptorV1,
  facts: ApplicationLaneLifecycleFactsV1,
  capabilities: ApplicationLaneLifecycleCapabilities,
): ApplicationLaneLifecycleDecisionV1 {
  if (facts.browserResidency === "foreground") {
    return decision(descriptor, "none", "foreground_protected");
  }
  if (facts.browserResidency === "frozen") {
    return decision(descriptor, "none", "already_satisfied");
  }
  if (facts.browserResidency === "discarded") {
    if (capabilities.canWake) {
      return decision(descriptor, "wake", "wake_required");
    }
    return decision(descriptor, "attention_required", "capability_unavailable");
  }

  if (facts.freezeEligibility === "unknown") {
    return decision(descriptor, "none", "eligibility_unknown");
  }
  if (facts.freezeEligibility === "blocked") {
    return decision(descriptor, "none", "freeze_blocked");
  }
  if (capabilities.canFreeze) {
    return decision(descriptor, "freeze", "freeze_eligible");
  }
  return decision(descriptor, "none", "capability_unavailable");
}

function planReclaimable(
  descriptor: ApplicationLaneDescriptorV1,
  facts: ApplicationLaneLifecycleFactsV1,
  capabilities: ApplicationLaneLifecycleCapabilities,
): ApplicationLaneLifecycleDecisionV1 {
  if (facts.browserResidency === "foreground") {
    return decision(descriptor, "none", "foreground_protected");
  }
  if (facts.browserResidency === "discarded") {
    return decision(descriptor, "none", "already_reclaimed");
  }

  if (
    facts.discardEligibility === "allowed" &&
    capabilities.canDiscard
  ) {
    return decision(descriptor, "discard", "discard_eligible");
  }

  if (
    facts.browserResidency === "background" &&
    facts.freezeEligibility === "allowed" &&
    capabilities.canFreeze
  ) {
    return decision(descriptor, "freeze", "discard_fallback_freeze");
  }

  if (facts.browserResidency === "frozen") {
    if (facts.discardEligibility === "unknown") {
      return decision(descriptor, "none", "eligibility_unknown");
    }
    if (facts.discardEligibility === "blocked") {
      return decision(descriptor, "none", "discard_blocked");
    }
    return decision(descriptor, "none", "capability_unavailable");
  }

  if (facts.discardEligibility === "unknown") {
    return decision(descriptor, "none", "eligibility_unknown");
  }
  if (facts.discardEligibility === "blocked") {
    return decision(descriptor, "none", "discard_blocked");
  }
  return decision(descriptor, "none", "capability_unavailable");
}

function decision(
  descriptor: ApplicationLaneDescriptorV1,
  action: ApplicationLaneLifecycleAction,
  reason: ApplicationLaneLifecycleReason,
): ApplicationLaneLifecycleDecisionV1 {
  return Object.freeze({
    version: APPLICATION_LANE_LIFECYCLE_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    action,
    reason,
  });
}

function lifecycleBlockers(
  value: readonly ApplicationLaneLifecycleBlocker[],
): readonly ApplicationLaneLifecycleBlocker[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Application lane lifecycle blockers must be an array");
  }
  if (value.length > MAX_BLOCKERS) {
    throw new RangeError(
      `Application lane lifecycle blockers exceed ${MAX_BLOCKERS} entries`,
    );
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: ApplicationLaneLifecycleBlocker[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Application lane lifecycle blockers must be dense data");
    }
    output.push(
      exactEnum(
        descriptor.value,
        applicationLaneLifecycleBlockers,
        `Application lane lifecycle blocker ${index + 1}`,
      ),
    );
  }
  if (new Set(output).size !== output.length) {
    throw new RangeError("Application lane lifecycle blockers must be unique");
  }
  output.sort(compareCodeUnits);
  return Object.freeze(output);
}

function exactEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Values[number];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
