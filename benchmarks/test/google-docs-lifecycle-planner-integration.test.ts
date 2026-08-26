// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "@elatura/core/application-lane";
import {
  createApplicationLaneLifecycleFactsV1,
  createApplicationLaneResidencyRequestV1,
  planApplicationLaneResidencyV1,
  type ApplicationLaneLifecycleCapabilities,
} from "@elatura/core/application-lane-lifecycle";
import { describe, expect, it } from "vitest";
import { classifyGoogleDocsLifecycleEligibilityV1 } from "../src/google-docs-lifecycle-facts.js";

const CAPABILITIES: ApplicationLaneLifecycleCapabilities = Object.freeze({
  canWake: true,
  canFreeze: true,
  canDiscard: true,
  canRecoverProjection: true,
});

function descriptor(generation = 1): ApplicationLaneDescriptorV1 {
  return Object.freeze({
    version: 1,
    laneRef: "gdocs-research-switch-01",
    generation,
    adapter: Object.freeze({ id: "google-docs-research", version: "0.0.0" }),
    capabilities: Object.freeze(["events", "observe", "activate", "screenshot"]),
    state: "parked",
    observedAt: "2026-08-27T00:00:00.000Z",
  });
}

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

function facts(
  lane: ApplicationLaneDescriptorV1,
  overrides: Record<string, unknown> = {},
) {
  const eligibility = classifyGoogleDocsLifecycleEligibilityV1(
    quietProbe(overrides),
  );
  return createApplicationLaneLifecycleFactsV1(lane, {
    browserResidency: "background",
    recovery: "verified",
    freezeEligibility: eligibility.freezeEligibility,
    discardEligibility: eligibility.discardEligibility,
    blockers: eligibility.blockers,
  });
}

describe("Google Docs human facts through the application-lane lifecycle planner", () => {
  it("turns a saved quiescent suspended request into an earned freeze decision", () => {
    const lane = descriptor();
    const decision = planApplicationLaneResidencyV1(
      lane,
      facts(lane),
      createApplicationLaneResidencyRequestV1(lane, "suspended"),
      CAPABILITIES,
    );
    expect(decision).toMatchObject({
      laneRef: lane.laneRef,
      laneGeneration: lane.generation,
      action: "freeze",
      reason: "freeze_eligible",
    });
  });

  it("falls back to freeze while discard reload fidelity remains unearned", () => {
    const lane = descriptor();
    const decision = planApplicationLaneResidencyV1(
      lane,
      facts(lane, { discardFidelityVerified: "no" }),
      createApplicationLaneResidencyRequestV1(lane, "reclaimable"),
      CAPABILITIES,
    );
    expect(decision).toMatchObject({
      action: "freeze",
      reason: "discard_fallback_freeze",
    });
  });

  it("allows discard only after the generated workload has earned reload fidelity", () => {
    const lane = descriptor();
    const decision = planApplicationLaneResidencyV1(
      lane,
      facts(lane),
      createApplicationLaneResidencyRequestV1(lane, "reclaimable"),
      CAPABILITIES,
    );
    expect(decision).toMatchObject({
      action: "discard",
      reason: "discard_eligible",
    });
  });

  it("keeps a live selection protected from both suspended and reclaimable transitions", () => {
    const lane = descriptor();
    const protectedFacts = facts(lane, { selectionPresent: "yes" });
    expect(
      planApplicationLaneResidencyV1(
        lane,
        protectedFacts,
        createApplicationLaneResidencyRequestV1(lane, "suspended"),
        CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "freeze_blocked" });
    expect(
      planApplicationLaneResidencyV1(
        lane,
        protectedFacts,
        createApplicationLaneResidencyRequestV1(lane, "reclaimable"),
        CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "discard_blocked" });
  });

  it("refuses an old generation request after the research binding advances", () => {
    const first = descriptor(1);
    const staleRequest = createApplicationLaneResidencyRequestV1(
      first,
      "reclaimable",
    );
    const current = descriptor(2);
    const decision = planApplicationLaneResidencyV1(
      current,
      facts(current),
      staleRequest,
      CAPABILITIES,
    );
    expect(decision).toMatchObject({
      laneRef: current.laneRef,
      laneGeneration: current.generation,
      action: "none",
      reason: "stale_generation",
    });
  });
});
