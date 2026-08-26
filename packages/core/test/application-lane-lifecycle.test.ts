// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseApplicationLaneDescriptorV1,
  type ApplicationLaneDescriptorV1,
} from "../src/application-lane.js";
import {
  createApplicationLaneLifecycleFactsV1,
  createApplicationLaneResidencyRequestV1,
  planApplicationLaneResidencyV1,
  type ApplicationLaneLifecycleCapabilities,
  type ApplicationLaneLifecycleFactsV1,
  type ApplicationLaneResidencyRequestV1,
} from "../src/application-lane-lifecycle.js";

const ALL_CAPABILITIES: ApplicationLaneLifecycleCapabilities = Object.freeze({
  canWake: true,
  canFreeze: true,
  canDiscard: true,
  canRecoverProjection: true,
});

function descriptor(
  state: "active" | "parked" | "unavailable" | "drifted" | "recovery_needed" = "active",
  generation = 7,
): ApplicationLaneDescriptorV1 {
  return parseApplicationLaneDescriptorV1({
    version: 1,
    laneRef: "elatura:lane:chat-a",
    generation,
    adapter: { id: "chatgpt", version: "1" },
    capabilities: ["events", "observe", "activate", "screenshot"],
    state,
    observedAt: "2026-08-26T17:00:00.000Z",
  });
}

function facts(
  lane = descriptor(),
  options: Partial<{
    browserResidency: "foreground" | "background" | "frozen" | "discarded" | "reloading" | "missing";
    recovery: "verified" | "recoverable" | "recovering" | "attention_required" | "unavailable";
    freezeEligibility: "allowed" | "blocked" | "unknown";
    discardEligibility: "allowed" | "blocked" | "unknown";
    blockers: readonly (
      | "active_generation"
      | "unsaved_interaction"
      | "save_in_progress"
      | "composition_active"
      | "modal_interaction"
      | "collaboration_active"
      | "media_or_device_active"
      | "download_active"
      | "application_unknown"
      | "manual_protection"
    )[];
  }> = {},
): ApplicationLaneLifecycleFactsV1 {
  return createApplicationLaneLifecycleFactsV1(lane, {
    browserResidency: options.browserResidency ?? "background",
    recovery: options.recovery ?? "verified",
    freezeEligibility: options.freezeEligibility ?? "allowed",
    discardEligibility: options.discardEligibility ?? "allowed",
    blockers: options.blockers ?? [],
  });
}

function request(
  lane: ApplicationLaneDescriptorV1,
  intent: "responsive" | "suspended" | "reclaimable",
): ApplicationLaneResidencyRequestV1 {
  return createApplicationLaneResidencyRequestV1(lane, intent);
}

describe("application lane lifecycle facts", () => {
  it("binds requested residency to the exact durable lane generation", () => {
    const lane = descriptor();
    expect(request(lane, "responsive")).toEqual({
      version: 1,
      laneRef: lane.laneRef,
      laneGeneration: 7,
      intent: "responsive",
    });
  });

  it("keeps browser projection handles outside lifecycle facts", () => {
    const lane = descriptor();
    const current = facts(lane);
    expect(current).toEqual({
      version: 1,
      laneRef: lane.laneRef,
      laneGeneration: 7,
      browserResidency: "background",
      recovery: "verified",
      freezeEligibility: "allowed",
      discardEligibility: "allowed",
      blockers: [],
    });
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.blockers)).toBe(true);
    expect("tabId" in current).toBe(false);
    expect("targetId" in current).toBe(false);
  });

  it("bounds, validates, sorts, and deduplicates blocker facts", () => {
    const lane = descriptor();
    expect(
      facts(lane, {
        blockers: ["manual_protection", "active_generation"],
      }).blockers,
    ).toEqual(["active_generation", "manual_protection"]);

    expect(() =>
      facts(lane, {
        blockers: ["active_generation", "active_generation"],
      }),
    ).toThrow("must be unique");

    expect(() =>
      facts(lane, {
        blockers: Array.from({ length: 17 }, () => "manual_protection"),
      }),
    ).toThrow("exceed 16 entries");
  });
});

describe("responsive warm residency", () => {
  it("leaves already loaded foreground/background lanes alone", () => {
    const lane = descriptor();
    for (const browserResidency of ["foreground", "background"] as const) {
      expect(
        planApplicationLaneResidencyV1(
          lane,
          facts(lane, { browserResidency }),
          request(lane, "responsive"),
          ALL_CAPABILITIES,
        ),
      ).toMatchObject({ action: "none", reason: "already_satisfied" });
    }
  });

  it("wakes frozen and discarded lanes without requesting foreground focus", () => {
    const lane = descriptor("parked");
    for (const browserResidency of ["frozen", "discarded"] as const) {
      expect(
        planApplicationLaneResidencyV1(
          lane,
          facts(lane, { browserResidency, recovery: "recoverable" }),
          request(lane, "responsive"),
          ALL_CAPABILITIES,
        ),
      ).toMatchObject({ action: "wake", reason: "wake_required" });
    }
  });

  it("surfaces missing wake capability instead of pretending the lane is warm", () => {
    const lane = descriptor("parked");
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, { browserResidency: "discarded", recovery: "recoverable" }),
        request(lane, "responsive"),
        { ...ALL_CAPABILITIES, canWake: false },
      ),
    ).toMatchObject({
      action: "attention_required",
      reason: "capability_unavailable",
    });
  });
});

describe("resident suspended residency", () => {
  it("freezes a background lane only after explicit workload eligibility", () => {
    const lane = descriptor();
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane),
        request(lane, "suspended"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "freeze", reason: "freeze_eligible" });

    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, { freezeEligibility: "unknown" }),
        request(lane, "suspended"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "eligibility_unknown" });

    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, {
          freezeEligibility: "blocked",
          blockers: ["active_generation"],
        }),
        request(lane, "suspended"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "freeze_blocked" });
  });

  it("wakes a discarded lane because suspended means resident", () => {
    const lane = descriptor("parked");
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, { browserResidency: "discarded", recovery: "recoverable" }),
        request(lane, "suspended"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "wake", reason: "wake_required" });
  });
});

describe("reclaimable residency", () => {
  it("discards an eligible background or frozen lane", () => {
    const lane = descriptor("parked");
    for (const browserResidency of ["background", "frozen"] as const) {
      expect(
        planApplicationLaneResidencyV1(
          lane,
          facts(lane, { browserResidency }),
          request(lane, "reclaimable"),
          ALL_CAPABILITIES,
        ),
      ).toMatchObject({ action: "discard", reason: "discard_eligible" });
    }
  });

  it("uses resident freeze as the safer background fallback when discard is blocked", () => {
    const lane = descriptor("parked");
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, {
          discardEligibility: "blocked",
          freezeEligibility: "allowed",
          blockers: ["unsaved_interaction"],
        }),
        request(lane, "reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "freeze", reason: "discard_fallback_freeze" });
  });

  it("refuses aggressive action when discard eligibility is unknown", () => {
    const lane = descriptor("parked");
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, {
          discardEligibility: "unknown",
          freezeEligibility: "unknown",
        }),
        request(lane, "reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "eligibility_unknown" });
  });

  it("never freezes or discards the foreground lane", () => {
    const lane = descriptor();
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, { browserResidency: "foreground" }),
        request(lane, "reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "foreground_protected" });
  });
});

describe("generation and recovery truth", () => {
  it("rejects a stale consumer request after the lane generation changes", () => {
    const oldLane = descriptor("active", 7);
    const currentLane = descriptor("active", 8);
    expect(
      planApplicationLaneResidencyV1(
        currentLane,
        facts(currentLane),
        request(oldLane, "reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "stale_generation" });
  });

  it("surfaces lifecycle facts from an older projection generation", () => {
    const oldLane = descriptor("active", 7);
    const currentLane = descriptor("active", 8);
    expect(
      planApplicationLaneResidencyV1(
        currentLane,
        facts(oldLane),
        request(currentLane, "responsive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({
      action: "attention_required",
      reason: "stale_projection_facts",
    });
  });

  it("leaves a missing reclaimable lane cheap and recovers it only for a warmer request", () => {
    const lane = descriptor("parked");
    const missing = facts(lane, {
      browserResidency: "missing",
      recovery: "recoverable",
    });

    expect(
      planApplicationLaneResidencyV1(
        lane,
        missing,
        request(lane, "reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "already_reclaimed" });

    expect(
      planApplicationLaneResidencyV1(
        lane,
        missing,
        request(lane, "responsive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({
      action: "recover_projection",
      reason: "projection_recovery_required",
    });
  });

  it("waits for recovery already in progress", () => {
    const lane = descriptor("parked");
    expect(
      planApplicationLaneResidencyV1(
        lane,
        facts(lane, { recovery: "recovering", browserResidency: "reloading" }),
        request(lane, "responsive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "wait", reason: "recovery_in_progress" });
  });

  it("surfaces descriptor drift/unavailability before resource intervention", () => {
    for (const state of ["unavailable", "drifted", "recovery_needed"] as const) {
      const lane = descriptor(state);
      expect(
        planApplicationLaneResidencyV1(
          lane,
          facts(lane),
          request(lane, "responsive"),
          ALL_CAPABILITIES,
        ),
      ).toMatchObject({
        action: "attention_required",
        reason: "recovery_required",
      });
    }
  });
});
