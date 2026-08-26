// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "@elatura/core/application-lane";
import type {
  ApplicationLaneEligibilityState,
  ApplicationLaneLifecycleBlocker,
  ApplicationLaneRecoveryState,
} from "@elatura/core/application-lane-lifecycle";
import type {
  ChatGptLaneFidelityV1,
  ChatGptLaneRecoveryAssessmentV1,
} from "./lane-witness.js";

export const CHATGPT_LANE_ACTIVITY_VERSION = 1 as const;
export const DEFAULT_CHATGPT_LANE_ACTIVITY_MAX_AGE_MS = 5_000;
export const MAX_CHATGPT_LANE_ACTIVITY_MAX_AGE_MS = 60_000;

export const chatGptLaneActivityConfidences = ["exact", "probable", "unknown"] as const;
export type ChatGptLaneActivityConfidence =
  (typeof chatGptLaneActivityConfidences)[number];

export const chatGptLaneBinaryActivities = ["active", "inactive", "unknown"] as const;
export type ChatGptLaneBinaryActivity =
  (typeof chatGptLaneBinaryActivities)[number];

export const chatGptLaneComposerStates = ["clean", "dirty", "unknown"] as const;
export type ChatGptLaneComposerState = (typeof chatGptLaneComposerStates)[number];

/**
 * Content-free, generation-bound current ChatGPT application activity.
 *
 * A browser/content producer may populate this record only from a separately
 * reviewed live sentinel. The contract contains no text, URL, account, message,
 * DOM selector, browser handle, or provider credential.
 */
export type ChatGptLaneActivityObservationV1 = Readonly<{
  version: typeof CHATGPT_LANE_ACTIVITY_VERSION;
  laneRef: string;
  laneGeneration: number;
  observedAtMs: number;
  source: "reviewed-live-sentinel";
  confidence: ChatGptLaneActivityConfidence;
  generation: ChatGptLaneBinaryActivity;
  composer: ChatGptLaneComposerState;
  composition: ChatGptLaneBinaryActivity;
  modal: ChatGptLaneBinaryActivity;
  mediaOrDevice: ChatGptLaneBinaryActivity;
  download: ChatGptLaneBinaryActivity;
  otherTransient: ChatGptLaneBinaryActivity;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export const chatGptLaneTransitionStatuses = [
  "clear",
  "blocked",
  "unknown",
  "stale",
  "mismatched",
  "recovery_required",
] as const;
export type ChatGptLaneTransitionStatus =
  (typeof chatGptLaneTransitionStatuses)[number];

export const chatGptLaneTransitionReasons = [
  "idle_exact",
  "active_blocker",
  "unknown_activity",
  "weak_confidence",
  "stale_activity",
  "future_activity",
  "lane_mismatch",
  "generation_mismatch",
  "recovery_unverified",
] as const;
export type ChatGptLaneTransitionReason =
  (typeof chatGptLaneTransitionReasons)[number];

export type ChatGptLaneTransitionAssessmentV1 = Readonly<{
  version: typeof CHATGPT_LANE_ACTIVITY_VERSION;
  laneRef: string;
  laneGeneration: number;
  status: ChatGptLaneTransitionStatus;
  reason: ChatGptLaneTransitionReason;
  fidelity: ChatGptLaneFidelityV1;
  activityObservedAtMs: number;
  assessedAtMs: number;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

const ACTIVITY_KEYS = [
  "version",
  "laneRef",
  "laneGeneration",
  "observedAtMs",
  "source",
  "confidence",
  "generation",
  "composer",
  "composition",
  "modal",
  "mediaOrDevice",
  "download",
  "otherTransient",
  "grantsWorkAuthority",
  "authorizesWorkDispatch",
] as const;

const BLOCKER_ORDER: readonly ApplicationLaneLifecycleBlocker[] = Object.freeze([
  "active_generation",
  "unsaved_interaction",
  "composition_active",
  "modal_interaction",
  "media_or_device_active",
  "download_active",
  "application_unknown",
]);

export function parseChatGptLaneActivityObservationV1(
  value: unknown,
): ChatGptLaneActivityObservationV1 {
  const input = ownDataRecord(value, "ChatGPT lane activity observation", ACTIVITY_KEYS);
  if (input.version !== CHATGPT_LANE_ACTIVITY_VERSION) {
    throw new TypeError("ChatGPT lane activity version is invalid");
  }
  if (input.source !== "reviewed-live-sentinel") {
    throw new TypeError("ChatGPT lane activity source is invalid");
  }
  if (input.grantsWorkAuthority !== false) {
    throw new TypeError("ChatGPT lane activity must grant zero work authority");
  }
  if (input.authorizesWorkDispatch !== false) {
    throw new TypeError("ChatGPT lane activity must authorize zero work dispatch");
  }

  return Object.freeze({
    version: CHATGPT_LANE_ACTIVITY_VERSION,
    laneRef: boundedLaneRef(input.laneRef),
    laneGeneration: positiveInteger(input.laneGeneration, "ChatGPT lane generation"),
    observedAtMs: nonNegativeInteger(input.observedAtMs, "ChatGPT activity observation time"),
    source: "reviewed-live-sentinel",
    confidence: exactEnum(
      input.confidence,
      chatGptLaneActivityConfidences,
      "ChatGPT activity confidence",
    ),
    generation: exactEnum(
      input.generation,
      chatGptLaneBinaryActivities,
      "ChatGPT generation activity",
    ),
    composer: exactEnum(
      input.composer,
      chatGptLaneComposerStates,
      "ChatGPT composer state",
    ),
    composition: exactEnum(
      input.composition,
      chatGptLaneBinaryActivities,
      "ChatGPT composition activity",
    ),
    modal: exactEnum(
      input.modal,
      chatGptLaneBinaryActivities,
      "ChatGPT modal activity",
    ),
    mediaOrDevice: exactEnum(
      input.mediaOrDevice,
      chatGptLaneBinaryActivities,
      "ChatGPT media/device activity",
    ),
    download: exactEnum(
      input.download,
      chatGptLaneBinaryActivities,
      "ChatGPT download activity",
    ),
    otherTransient: exactEnum(
      input.otherTransient,
      chatGptLaneBinaryActivities,
      "ChatGPT other transient activity",
    ),
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

/**
 * Convert one current activity observation into canonical transition fidelity.
 *
 * V1 may earn resident freeze eligibility from an exact, fresh, fully idle
 * observation after conversation continuity is verified. Destructive discard
 * eligibility deliberately remains `unknown` even in the clear case; reload
 * fidelity plus current activity need a later evidence-backed contract before
 * ChatGPT can authorize reclaim.
 */
export function assessChatGptLaneTransitionV1(
  descriptor: ApplicationLaneDescriptorV1,
  recovery: ChatGptLaneRecoveryAssessmentV1,
  activityInput: unknown,
  assessedAtMsInput: unknown,
  maxAgeMsInput: unknown = DEFAULT_CHATGPT_LANE_ACTIVITY_MAX_AGE_MS,
): ChatGptLaneTransitionAssessmentV1 {
  const activity = parseChatGptLaneActivityObservationV1(activityInput);
  const assessedAtMs = nonNegativeInteger(assessedAtMsInput, "ChatGPT transition assessment time");
  const maxAgeMs = positiveIntegerAtMost(
    maxAgeMsInput,
    "ChatGPT activity maximum age",
    MAX_CHATGPT_LANE_ACTIVITY_MAX_AGE_MS,
  );

  // Recovery evidence belongs to one exact canonical lane generation. Refuse a
  // cross-lane/cross-generation recovery result before its verified status can
  // influence current transition permission.
  if (recovery.laneRef !== descriptor.laneRef) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "mismatched",
      "lane_mismatch",
      blockedFidelity("attention_required", ["application_unknown"]),
    );
  }
  if (recovery.laneGeneration !== descriptor.generation) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "mismatched",
      "generation_mismatch",
      blockedFidelity("attention_required", ["application_unknown"]),
    );
  }
  if (recovery.status !== "verified" || recovery.identityContinuity !== "verified") {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "recovery_required",
      "recovery_unverified",
      recovery.fidelity,
    );
  }
  if (activity.laneRef !== descriptor.laneRef) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "mismatched",
      "lane_mismatch",
      blockedFidelity(recovery.fidelity.recovery, ["application_unknown"]),
    );
  }
  if (activity.laneGeneration !== descriptor.generation) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "mismatched",
      "generation_mismatch",
      blockedFidelity(recovery.fidelity.recovery, ["application_unknown"]),
    );
  }
  if (activity.observedAtMs > assessedAtMs) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "unknown",
      "future_activity",
      unknownFidelity(recovery.fidelity.recovery),
    );
  }
  if (assessedAtMs - activity.observedAtMs > maxAgeMs) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "stale",
      "stale_activity",
      unknownFidelity(recovery.fidelity.recovery),
    );
  }

  const blockers = activeBlockers(activity);
  if (blockers.length > 0) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "blocked",
      "active_blocker",
      blockedFidelity(recovery.fidelity.recovery, blockers),
    );
  }

  if (activity.confidence !== "exact") {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "unknown",
      "weak_confidence",
      unknownFidelity(recovery.fidelity.recovery),
    );
  }
  if (hasUnknownActivity(activity)) {
    return assessment(
      descriptor,
      activity,
      assessedAtMs,
      "unknown",
      "unknown_activity",
      unknownFidelity(recovery.fidelity.recovery),
    );
  }

  return assessment(
    descriptor,
    activity,
    assessedAtMs,
    "clear",
    "idle_exact",
    Object.freeze({
      recovery: recovery.fidelity.recovery,
      freezeEligibility: "allowed",
      discardEligibility: "unknown",
      blockers: Object.freeze([]),
    }),
  );
}

function activeBlockers(
  activity: ChatGptLaneActivityObservationV1,
): readonly ApplicationLaneLifecycleBlocker[] {
  const blockers = new Set<ApplicationLaneLifecycleBlocker>();
  if (activity.generation === "active") blockers.add("active_generation");
  if (activity.composer === "dirty") blockers.add("unsaved_interaction");
  if (activity.composition === "active") blockers.add("composition_active");
  if (activity.modal === "active") blockers.add("modal_interaction");
  if (activity.mediaOrDevice === "active") blockers.add("media_or_device_active");
  if (activity.download === "active") blockers.add("download_active");
  if (activity.otherTransient === "active") blockers.add("application_unknown");
  return Object.freeze(BLOCKER_ORDER.filter((blocker) => blockers.has(blocker)));
}

function hasUnknownActivity(activity: ChatGptLaneActivityObservationV1): boolean {
  return (
    activity.generation === "unknown" ||
    activity.composer === "unknown" ||
    activity.composition === "unknown" ||
    activity.modal === "unknown" ||
    activity.mediaOrDevice === "unknown" ||
    activity.download === "unknown" ||
    activity.otherTransient === "unknown"
  );
}

function blockedFidelity(
  recovery: ApplicationLaneRecoveryState,
  blockers: readonly ApplicationLaneLifecycleBlocker[],
): ChatGptLaneFidelityV1 {
  return Object.freeze({
    recovery,
    freezeEligibility: "blocked" as ApplicationLaneEligibilityState,
    discardEligibility: "blocked" as ApplicationLaneEligibilityState,
    blockers: Object.freeze([...blockers]),
  });
}

function unknownFidelity(recovery: ApplicationLaneRecoveryState): ChatGptLaneFidelityV1 {
  return Object.freeze({
    recovery,
    freezeEligibility: "unknown",
    discardEligibility: "unknown",
    blockers: Object.freeze(["application_unknown"] as const),
  });
}

function assessment(
  descriptor: ApplicationLaneDescriptorV1,
  activity: ChatGptLaneActivityObservationV1,
  assessedAtMs: number,
  status: ChatGptLaneTransitionStatus,
  reason: ChatGptLaneTransitionReason,
  fidelity: ChatGptLaneFidelityV1,
): ChatGptLaneTransitionAssessmentV1 {
  return Object.freeze({
    version: CHATGPT_LANE_ACTIVITY_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    status,
    reason,
    fidelity,
    activityObservedAtMs: activity.observedAtMs,
    assessedAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function ownDataRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      throw new TypeError();
    }
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw new TypeError();
      }
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
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

function boundedLaneRef(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 240 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/u.test(value)
  ) {
    throw new TypeError("ChatGPT lane reference is invalid");
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function positiveIntegerAtMost(
  value: unknown,
  label: string,
  maximum: number,
): number {
  const parsed = positiveInteger(value, label);
  if (parsed > maximum) throw new TypeError(`${label} exceeds ${maximum}`);
  return parsed;
}
