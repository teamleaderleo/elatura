// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { classifyGoogleDocsLifecycleEligibilityV1 } from "../src/google-docs-lifecycle-facts.js";

function quietProbe(overrides: Record<string, unknown> = {}): any {
  return {
    autosaveState: "saved",
    localEditPending: "no",
    compositionActive: "no",
    selectionPresent: "no",
    transientEditorActive: "no",
    collaborationActive: "no",
    viewportAnchorAvailable: "yes",
    discardFidelityVerified: "yes",
    manualProtected: "no",
    ...structuredClone(overrides),
  };
}

describe("Google Docs lifecycle eligibility classifier", () => {
  it("allows freeze and discard only for a saved quiescent reload-verified probe", () => {
    expect(classifyGoogleDocsLifecycleEligibilityV1(quietProbe())).toEqual({
      freezeEligibility: "allowed",
      discardEligibility: "allowed",
      blockers: [],
    });
  });

  it("allows the freeze experiment while discard fidelity remains unearned", () => {
    expect(
      classifyGoogleDocsLifecycleEligibilityV1(
        quietProbe({ discardFidelityVerified: "no" }),
      ),
    ).toEqual({
      freezeEligibility: "allowed",
      discardEligibility: "unknown",
      blockers: ["application_unknown"],
    });
  });

  it("blocks unsaved, saving, composition, modal, collaboration, and manual-protection states", () => {
    const result = classifyGoogleDocsLifecycleEligibilityV1(
      quietProbe({
        localEditPending: "yes",
        autosaveState: "saving",
        compositionActive: "yes",
        transientEditorActive: "yes",
        collaborationActive: "yes",
        manualProtected: "yes",
      }),
    );
    expect(result.freezeEligibility).toBe("blocked");
    expect(result.discardEligibility).toBe("blocked");
    expect(result.blockers).toEqual([
      "collaboration_active",
      "composition_active",
      "manual_protection",
      "modal_interaction",
      "save_in_progress",
      "unsaved_interaction",
    ]);
  });

  it("protects a live selection conservatively in the first policy", () => {
    expect(
      classifyGoogleDocsLifecycleEligibilityV1(
        quietProbe({ selectionPresent: "yes" }),
      ),
    ).toEqual({
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
      blockers: ["manual_protection"],
    });
  });

  it("keeps offline or unknown application state at unknown eligibility", () => {
    expect(
      classifyGoogleDocsLifecycleEligibilityV1(quietProbe({ autosaveState: "offline" })),
    ).toEqual({
      freezeEligibility: "unknown",
      discardEligibility: "unknown",
      blockers: ["application_unknown"],
    });
    expect(
      classifyGoogleDocsLifecycleEligibilityV1(
        quietProbe({ collaborationActive: "unknown" }),
      ),
    ).toEqual({
      freezeEligibility: "unknown",
      discardEligibility: "unknown",
      blockers: ["application_unknown"],
    });
  });

  it("requires a recoverable viewport anchor before discard is allowed", () => {
    expect(
      classifyGoogleDocsLifecycleEligibilityV1(
        quietProbe({ viewportAnchorAvailable: "no" }),
      ),
    ).toEqual({
      freezeEligibility: "allowed",
      discardEligibility: "unknown",
      blockers: ["application_unknown"],
    });
  });

  it("rejects unknown fields instead of widening the research policy", () => {
    expect(() =>
      classifyGoogleDocsLifecycleEligibilityV1(
        quietProbe({ privateDocumentState: "unexpected" }),
      ),
    ).toThrow(/unsupported field/u);
  });
});
