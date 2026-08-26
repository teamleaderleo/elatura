// SPDX-License-Identifier: MPL-2.0
import {
  type ApplicationLaneEligibilityState,
  type ApplicationLaneLifecycleBlocker,
} from "@elatura/core/application-lane-lifecycle";
import {
  AUTOSAVE_STATES,
  YES_NO_UNKNOWN,
  type AutosaveState,
  type YesNoUnknown,
} from "./google-docs-live-manifest.js";

/**
 * Content-free, research-only mapping from human-observed Google Docs fidelity
 * facts into the generic #132 lifecycle eligibility vocabulary.
 *
 * This function has no browser/application authority. It performs no DOM read,
 * provider request, browser action, or application mutation. Its conservative
 * defaults are intended for generated #118 dogfood documents only.
 */
export type GoogleDocsHumanLifecycleProbeV1 = Readonly<{
  autosaveState: AutosaveState;
  localEditPending: YesNoUnknown;
  compositionActive: YesNoUnknown;
  selectionPresent: YesNoUnknown;
  transientEditorActive: YesNoUnknown;
  collaborationActive: YesNoUnknown;
  viewportAnchorAvailable: YesNoUnknown;
  discardFidelityVerified: YesNoUnknown;
  manualProtected: YesNoUnknown;
}>;

export type GoogleDocsLifecycleEligibilityV1 = Readonly<{
  freezeEligibility: ApplicationLaneEligibilityState;
  discardEligibility: ApplicationLaneEligibilityState;
  blockers: readonly ApplicationLaneLifecycleBlocker[];
}>;

const APPLICATION_UNKNOWN_BLOCKERS: readonly ApplicationLaneLifecycleBlocker[] =
  Object.freeze(["application_unknown"]);

function exactEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as T;
}

function normalizeProbe(input: GoogleDocsHumanLifecycleProbeV1): GoogleDocsHumanLifecycleProbeV1 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Google Docs lifecycle probe must be an object.");
  }
  const allowed = [
    "autosaveState",
    "localEditPending",
    "compositionActive",
    "selectionPresent",
    "transientEditorActive",
    "collaborationActive",
    "viewportAnchorAvailable",
    "discardFidelityVerified",
    "manualProtected",
  ] as const;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowed.includes(key as (typeof allowed)[number]))) {
    throw new TypeError("Google Docs lifecycle probe contains an unsupported field.");
  }
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError(`Google Docs lifecycle probe field ${key} must be own data.`);
    }
  }
  return Object.freeze({
    autosaveState: exactEnum(input.autosaveState, AUTOSAVE_STATES, "autosaveState"),
    localEditPending: exactEnum(input.localEditPending, YES_NO_UNKNOWN, "localEditPending"),
    compositionActive: exactEnum(input.compositionActive, YES_NO_UNKNOWN, "compositionActive"),
    selectionPresent: exactEnum(input.selectionPresent, YES_NO_UNKNOWN, "selectionPresent"),
    transientEditorActive: exactEnum(
      input.transientEditorActive,
      YES_NO_UNKNOWN,
      "transientEditorActive",
    ),
    collaborationActive: exactEnum(
      input.collaborationActive,
      YES_NO_UNKNOWN,
      "collaborationActive",
    ),
    viewportAnchorAvailable: exactEnum(
      input.viewportAnchorAvailable,
      YES_NO_UNKNOWN,
      "viewportAnchorAvailable",
    ),
    discardFidelityVerified: exactEnum(
      input.discardFidelityVerified,
      YES_NO_UNKNOWN,
      "discardFidelityVerified",
    ),
    manualProtected: exactEnum(input.manualProtected, YES_NO_UNKNOWN, "manualProtected"),
  });
}

export function classifyGoogleDocsLifecycleEligibilityV1(
  input: GoogleDocsHumanLifecycleProbeV1,
): GoogleDocsLifecycleEligibilityV1 {
  const probe = normalizeProbe(input);
  const blockers = new Set<ApplicationLaneLifecycleBlocker>();

  if (probe.manualProtected === "yes") blockers.add("manual_protection");
  if (probe.localEditPending === "yes") blockers.add("unsaved_interaction");
  if (probe.autosaveState === "saving") blockers.add("save_in_progress");
  if (probe.compositionActive === "yes") blockers.add("composition_active");
  if (probe.transientEditorActive === "yes") blockers.add("modal_interaction");
  if (probe.collaborationActive === "yes") blockers.add("collaboration_active");

  // V1 protects an active selection conservatively. The adversarial #118 probe
  // can later earn a narrower rule for freeze/discard independently.
  if (probe.selectionPresent === "yes") blockers.add("manual_protection");

  const hardBlocked = blockers.size > 0;
  if (hardBlocked) {
    return Object.freeze({
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
      blockers: Object.freeze([...blockers].sort()),
    });
  }

  const applicationUnknown =
    probe.autosaveState === "unknown" ||
    probe.autosaveState === "offline" ||
    probe.localEditPending === "unknown" ||
    probe.compositionActive === "unknown" ||
    probe.selectionPresent === "unknown" ||
    probe.transientEditorActive === "unknown" ||
    probe.collaborationActive === "unknown" ||
    probe.viewportAnchorAvailable === "unknown" ||
    probe.manualProtected === "unknown";

  if (applicationUnknown) {
    return Object.freeze({
      freezeEligibility: "unknown",
      discardEligibility: "unknown",
      blockers: APPLICATION_UNKNOWN_BLOCKERS,
    });
  }

  // At this point the generated Doc is saved, quiescent, unprotected, and has
  // no observed transient editing/collaboration state. Freeze can be tested.
  const freezeEligibility: ApplicationLaneEligibilityState = "allowed";

  // Discard needs one additional earned fact: the current fixture class has
  // already demonstrated reload fidelity and the current region can be
  // reacquired. Until then the generic planner sees unknown discard eligibility.
  if (
    probe.viewportAnchorAvailable !== "yes" ||
    probe.discardFidelityVerified !== "yes"
  ) {
    return Object.freeze({
      freezeEligibility,
      discardEligibility: "unknown",
      blockers: APPLICATION_UNKNOWN_BLOCKERS,
    });
  }

  return Object.freeze({
    freezeEligibility,
    discardEligibility: "allowed",
    blockers: Object.freeze([]),
  });
}
