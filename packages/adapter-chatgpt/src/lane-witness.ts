// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "@elatura/core/application-lane";
import type {
  ApplicationLaneEligibilityState,
  ApplicationLaneLifecycleBlocker,
  ApplicationLaneRecoveryState,
} from "@elatura/core/application-lane-lifecycle";
import type { ChatGptConversation, ChatGptNode } from "./index.js";
import { CHATGPT_ADAPTER_ID, CHATGPT_ADAPTER_VERSION } from "./identities.js";

export const CHATGPT_LANE_WITNESS_VERSION = 1 as const;
export const CHATGPT_LANE_WITNESS_MAX_ANCHOR_REF_LENGTH = 1_024;
export const CHATGPT_LANE_WITNESS_MAX_ACTIVE_PATH_DEPTH = 100_000;

/**
 * Private local continuity witness derived from an already validated ChatGPT
 * conversation graph. `anchorRef` is application-private and must stay inside
 * the trusted local binding/runtime path; committed evidence should retain only
 * the content-free recovery assessment below.
 */
export type ChatGptLaneWitnessV1 = Readonly<{
  version: typeof CHATGPT_LANE_WITNESS_VERSION;
  laneRef: string;
  laneGeneration: number;
  adapter: Readonly<{
    id: typeof CHATGPT_ADAPTER_ID;
    version: typeof CHATGPT_ADAPTER_VERSION;
  }>;
  source: "validated-chatgpt-active-path";
  anchorRef: string;
  nodeCount: number;
  activePathDepth: number;
  observedAtMs: number;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export const chatGptLaneRecoveryStatuses = [
  "verified",
  "attention_required",
  "stale_generation",
  "stale_observation",
] as const;
export type ChatGptLaneRecoveryStatus =
  (typeof chatGptLaneRecoveryStatuses)[number];

export const chatGptLaneRecoveryReasons = [
  "anchor_match",
  "anchor_changed",
  "lane_mismatch",
  "generation_mismatch",
  "adapter_mismatch",
  "observation_regressed",
] as const;
export type ChatGptLaneRecoveryReason =
  (typeof chatGptLaneRecoveryReasons)[number];

/**
 * Content-free application facts suitable for the canonical lane lifecycle
 * planner / Chromium binding seam.
 */
export type ChatGptLaneFidelityV1 = Readonly<{
  recovery: ApplicationLaneRecoveryState;
  freezeEligibility: ApplicationLaneEligibilityState;
  discardEligibility: ApplicationLaneEligibilityState;
  blockers: readonly ApplicationLaneLifecycleBlocker[];
}>;

export type ChatGptLaneRecoveryAssessmentV1 = Readonly<{
  version: typeof CHATGPT_LANE_WITNESS_VERSION;
  laneRef: string;
  laneGeneration: number;
  status: ChatGptLaneRecoveryStatus;
  reason: ChatGptLaneRecoveryReason;
  identityContinuity: "verified" | "attention_required";
  fidelity: ChatGptLaneFidelityV1;
  observedAtMs: number;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;

/**
 * Create the private anchor witness for one exact canonical lane generation.
 * The source must already have passed `validateChatGptConversation`.
 */
export function createChatGptLaneWitnessV1(
  descriptor: ApplicationLaneDescriptorV1,
  source: ChatGptConversation,
  observedAtMsInput: unknown,
): ChatGptLaneWitnessV1 {
  requireChatGptDescriptor(descriptor);
  const observedAtMs = nonNegativeInteger(observedAtMsInput, "ChatGPT witness observation time");
  const activePath = traceValidatedActivePath(source);
  const anchorRef = boundedPrivateRef(activePath.root.id, "ChatGPT active-root reference");
  const nodeCount = safeNodeCount(source.mapping);

  return Object.freeze({
    version: CHATGPT_LANE_WITNESS_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    adapter: Object.freeze({
      id: CHATGPT_ADAPTER_ID,
      version: CHATGPT_ADAPTER_VERSION,
    }),
    source: "validated-chatgpt-active-path",
    anchorRef,
    nodeCount,
    activePathDepth: activePath.depth,
    observedAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

/**
 * Verify that the current validated ChatGPT graph is the same application graph
 * previously witnessed for this exact lane generation.
 *
 * A matching graph proves continuity/recovery only. It deliberately leaves
 * freeze/discard eligibility `unknown`; static conversation JSON cannot prove
 * that generation, composition, uploads, or other transient interaction state
 * is safe to suspend/reclaim.
 */
export function assessChatGptLaneRecoveryV1(
  descriptor: ApplicationLaneDescriptorV1,
  expected: ChatGptLaneWitnessV1,
  current: ChatGptConversation,
  observedAtMsInput: unknown,
): ChatGptLaneRecoveryAssessmentV1 {
  const observedAtMs = nonNegativeInteger(observedAtMsInput, "ChatGPT recovery observation time");

  if (descriptor.adapter.id !== CHATGPT_ADAPTER_ID || descriptor.adapter.version !== CHATGPT_ADAPTER_VERSION) {
    return assessment(descriptor, "attention_required", "adapter_mismatch", observedAtMs, blockedFidelity());
  }
  if (expected.laneRef !== descriptor.laneRef) {
    return assessment(descriptor, "attention_required", "lane_mismatch", observedAtMs, blockedFidelity());
  }
  if (expected.laneGeneration !== descriptor.generation) {
    return assessment(descriptor, "stale_generation", "generation_mismatch", observedAtMs, blockedFidelity());
  }
  if (observedAtMs < expected.observedAtMs) {
    return assessment(descriptor, "stale_observation", "observation_regressed", observedAtMs, blockedFidelity());
  }

  const currentWitness = createChatGptLaneWitnessV1(descriptor, current, observedAtMs);
  if (currentWitness.anchorRef !== expected.anchorRef) {
    return assessment(descriptor, "attention_required", "anchor_changed", observedAtMs, blockedFidelity());
  }

  return assessment(descriptor, "verified", "anchor_match", observedAtMs, verifiedContinuityFidelity());
}

function assessment(
  descriptor: ApplicationLaneDescriptorV1,
  status: ChatGptLaneRecoveryStatus,
  reason: ChatGptLaneRecoveryReason,
  observedAtMs: number,
  fidelity: ChatGptLaneFidelityV1,
): ChatGptLaneRecoveryAssessmentV1 {
  return Object.freeze({
    version: CHATGPT_LANE_WITNESS_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    status,
    reason,
    identityContinuity: status === "verified" ? "verified" : "attention_required",
    fidelity,
    observedAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function verifiedContinuityFidelity(): ChatGptLaneFidelityV1 {
  return Object.freeze({
    recovery: "verified",
    freezeEligibility: "unknown",
    discardEligibility: "unknown",
    blockers: Object.freeze([]),
  });
}

function blockedFidelity(): ChatGptLaneFidelityV1 {
  return Object.freeze({
    recovery: "attention_required",
    freezeEligibility: "blocked",
    discardEligibility: "blocked",
    blockers: Object.freeze(["application_unknown"] as const),
  });
}

function requireChatGptDescriptor(descriptor: ApplicationLaneDescriptorV1): void {
  if (descriptor.adapter.id !== CHATGPT_ADAPTER_ID || descriptor.adapter.version !== CHATGPT_ADAPTER_VERSION) {
    throw new TypeError("Application lane descriptor does not use the current ChatGPT adapter identity");
  }
}

function traceValidatedActivePath(source: ChatGptConversation): Readonly<{
  root: ChatGptNode;
  depth: number;
}> {
  let cursor = source.currentNode;
  let depth = 0;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(cursor)) {
      throw new TypeError("Validated ChatGPT active path contains a cycle");
    }
    visited.add(cursor);
    depth += 1;
    if (depth > CHATGPT_LANE_WITNESS_MAX_ACTIVE_PATH_DEPTH) {
      throw new RangeError("ChatGPT witness active path exceeds the local witness bound");
    }

    const node = source.mapping[cursor];
    if (node === undefined) {
      throw new TypeError("Validated ChatGPT active path does not resolve");
    }
    if (node.parent === null) return Object.freeze({ root: node, depth });
    cursor = node.parent;
  }
}

function safeNodeCount(mapping: Readonly<Record<string, ChatGptNode>>): number {
  let count = 0;
  for (const key of Object.keys(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(mapping, key)) continue;
    count += 1;
    if (!Number.isSafeInteger(count)) throw new RangeError("ChatGPT witness node count overflowed");
  }
  return count;
}

function boundedPrivateRef(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > CHATGPT_LANE_WITNESS_MAX_ANCHOR_REF_LENGTH ||
    UNSAFE_TEXT.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}
