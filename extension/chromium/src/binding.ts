// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "@elatura/core/application-lane";
import {
  createApplicationLaneLifecycleFactsV1,
  planApplicationLaneResidencyV1,
  type ApplicationLaneEligibilityState,
  type ApplicationLaneLifecycleBlocker,
  type ApplicationLaneLifecycleDecisionV1,
  type ApplicationLaneLifecycleFactsV1,
  type ApplicationLaneRecoveryState,
  type ApplicationLaneResidencyRequestV1,
} from "@elatura/core/application-lane-lifecycle";
import type { ChromiumProjection } from "./projection.js";

export const CHROMIUM_LANE_BINDING_VERSION = 1 as const;

/**
 * Private transport binding between one exact durable lane generation and one
 * current Chromium projection. Creating this record asserts only local identity
 * association; application readiness and discard/freeze fidelity arrive through
 * separate application facts below.
 */
export type ChromiumLaneBindingV1 = Readonly<{
  version: typeof CHROMIUM_LANE_BINDING_VERSION;
  laneRef: string;
  laneGeneration: number;
  projectionRef: string;
  tabId: number;
  source: "explicit-local-binding";
}>;

export type ChromiumBoundApplicationFactsV1 = Readonly<{
  recovery: ApplicationLaneRecoveryState;
  freezeEligibility: ApplicationLaneEligibilityState;
  discardEligibility: ApplicationLaneEligibilityState;
  blockers: readonly ApplicationLaneLifecycleBlocker[];
}>;

export const chromiumLaneBindingMatchReasons = [
  "matched",
  "lane_ref_mismatch",
  "lane_generation_mismatch",
  "projection_mismatch",
] as const;
export type ChromiumLaneBindingMatchReason =
  (typeof chromiumLaneBindingMatchReasons)[number];

export type ChromiumLaneBindingMatchV1 = Readonly<{
  version: typeof CHROMIUM_LANE_BINDING_VERSION;
  matched: boolean;
  reason: ChromiumLaneBindingMatchReason;
}>;

export const chromiumResidencyEffects = [
  "none",
  "keep_warm",
  "discard",
  "unsupported",
] as const;
export type ChromiumResidencyEffect = (typeof chromiumResidencyEffects)[number];

export type BoundChromiumResidencyPlanV1 = Readonly<{
  version: typeof CHROMIUM_LANE_BINDING_VERSION;
  laneRef: string;
  laneGeneration: number;
  projectionRef: string;
  binding: ChromiumLaneBindingMatchV1;
  facts: ApplicationLaneLifecycleFactsV1 | null;
  decision: ApplicationLaneLifecycleDecisionV1 | null;
  effect: ChromiumResidencyEffect;
}>;

const CHROMIUM_BOUND_CAPABILITIES = Object.freeze({
  canWake: true,
  canFreeze: false,
  canDiscard: true,
  canRecoverProjection: false,
});

/**
 * Create an explicit ephemeral transport binding. The caller is responsible for
 * proving that the selected browser projection corresponds to this logical lane;
 * this function never infers identity from tab metadata.
 */
export function createChromiumLaneBindingV1(
  descriptor: ApplicationLaneDescriptorV1,
  projection: ChromiumProjection,
): ChromiumLaneBindingV1 {
  return Object.freeze({
    version: CHROMIUM_LANE_BINDING_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    projectionRef: projection.projectionRef,
    tabId: projection.tabId,
    source: "explicit-local-binding",
  });
}

export function matchChromiumLaneBindingV1(
  descriptor: ApplicationLaneDescriptorV1,
  binding: ChromiumLaneBindingV1,
  projection: ChromiumProjection,
): ChromiumLaneBindingMatchV1 {
  if (binding.laneRef !== descriptor.laneRef) {
    return bindingMatch(false, "lane_ref_mismatch");
  }
  if (binding.laneGeneration !== descriptor.generation) {
    return bindingMatch(false, "lane_generation_mismatch");
  }
  if (
    binding.projectionRef !== projection.projectionRef ||
    binding.tabId !== projection.tabId
  ) {
    return bindingMatch(false, "projection_mismatch");
  }
  return bindingMatch(true, "matched");
}

/**
 * Reconcile one exact application-lane request with one exact current Chromium
 * projection and application-supplied fidelity facts.
 *
 * The Chromium projection's `application_unknown` token is replaced only by
 * the supplied application facts after an exact binding match. Browser blockers
 * such as media activity or manual protection remain authoritative and cannot
 * be weakened by application claims.
 */
export function planBoundChromiumResidencyV1(
  descriptor: ApplicationLaneDescriptorV1,
  binding: ChromiumLaneBindingV1,
  projection: ChromiumProjection,
  request: ApplicationLaneResidencyRequestV1,
  applicationFacts: ChromiumBoundApplicationFactsV1,
): BoundChromiumResidencyPlanV1 {
  const matched = matchChromiumLaneBindingV1(descriptor, binding, projection);
  if (!matched.matched) {
    return Object.freeze({
      version: CHROMIUM_LANE_BINDING_VERSION,
      laneRef: descriptor.laneRef,
      laneGeneration: descriptor.generation,
      projectionRef: projection.projectionRef,
      binding: matched,
      facts: null,
      decision: null,
      effect: "none",
    });
  }

  const browserBlockers = projection.blockers.filter(
    (blocker) => blocker !== "application_unknown",
  );
  const blockers = Object.freeze([
    ...new Set<ApplicationLaneLifecycleBlocker>([
      ...browserBlockers,
      ...applicationFacts.blockers,
    ]),
  ]);
  const lifecycleFacts = createApplicationLaneLifecycleFactsV1(descriptor, {
    browserResidency: projection.browserResidency,
    recovery: applicationFacts.recovery,
    freezeEligibility: combineEligibility(
      projection.freezeEligibility,
      applicationFacts.freezeEligibility,
    ),
    discardEligibility: combineEligibility(
      projection.discardEligibility,
      applicationFacts.discardEligibility,
    ),
    blockers,
  });

  const decision = planApplicationLaneResidencyV1(
    descriptor,
    lifecycleFacts,
    request,
    CHROMIUM_BOUND_CAPABILITIES,
  );

  return Object.freeze({
    version: CHROMIUM_LANE_BINDING_VERSION,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    projectionRef: projection.projectionRef,
    binding: matched,
    facts: lifecycleFacts,
    decision,
    effect: effectFor(request, decision),
  });
}

function combineEligibility(
  browser: ApplicationLaneEligibilityState,
  application: ApplicationLaneEligibilityState,
): ApplicationLaneEligibilityState {
  if (browser === "blocked" || application === "blocked") return "blocked";
  if (application === "unknown") return "unknown";
  // Current unbound Chromium projections report `unknown` solely because
  // `application_unknown` has not yet been resolved. Exact binding plus
  // application facts may therefore promote that unknown to the application
  // value, while browser-level blocked state above always wins.
  return application;
}

function effectFor(
  request: ApplicationLaneResidencyRequestV1,
  decision: ApplicationLaneLifecycleDecisionV1,
): ChromiumResidencyEffect {
  if (
    decision.action === "attention_required" ||
    decision.action === "wait" ||
    decision.action === "recover_projection"
  ) {
    return "none";
  }

  if (request.intent === "responsive") {
    if (
      decision.action === "wake" ||
      (decision.action === "none" && decision.reason === "already_satisfied")
    ) {
      return "keep_warm";
    }
    return "none";
  }

  if (request.intent === "reclaimable") {
    return decision.action === "discard" ? "discard" : "none";
  }

  if (
    request.intent === "suspended" &&
    decision.action === "none" &&
    decision.reason === "already_satisfied"
  ) {
    return "none";
  }
  return request.intent === "suspended" ? "unsupported" : "none";
}

function bindingMatch(
  matched: boolean,
  reason: ChromiumLaneBindingMatchReason,
): ChromiumLaneBindingMatchV1 {
  return Object.freeze({
    version: CHROMIUM_LANE_BINDING_VERSION,
    matched,
    reason,
  });
}
