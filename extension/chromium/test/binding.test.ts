// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseApplicationLaneDescriptorV1,
  type ApplicationLaneDescriptorV1,
} from "@elatura/core/application-lane";
import {
  createApplicationLaneResidencyRequestV1,
  type ApplicationLaneLifecycleBlocker,
  type ApplicationLaneResidencyIntent,
} from "@elatura/core/application-lane-lifecycle";
import {
  createChromiumLaneBindingV1,
  matchChromiumLaneBindingV1,
  planBoundChromiumResidencyV1,
  type ChromiumBoundApplicationFactsV1,
} from "../src/binding.js";
import { projectChromiumTab, type ChromiumTabLike } from "../src/projection.js";

const NOW = 1_000_000;

function descriptor(generation = 7): ApplicationLaneDescriptorV1 {
  return parseApplicationLaneDescriptorV1({
    version: 1,
    laneRef: "elatura:lane:chat-a",
    generation,
    adapter: { id: "chatgpt", version: "1" },
    capabilities: ["events", "observe", "activate", "screenshot"],
    state: "active",
    observedAt: "2026-08-26T17:00:00.000Z",
  });
}

function tab(overrides: Partial<ChromiumTabLike> = {}): ChromiumTabLike {
  return {
    id: 7,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    lastAccessed: NOW - 60_000,
    windowId: 2,
    index: 3,
    status: "complete",
    ...overrides,
  };
}

function projection(overrides: Partial<ChromiumTabLike> = {}) {
  return projectChromiumTab(tab(overrides), false);
}

function appFacts(
  overrides: Partial<ChromiumBoundApplicationFactsV1> = {},
): ChromiumBoundApplicationFactsV1 {
  return {
    recovery: overrides.recovery ?? "verified",
    freezeEligibility: overrides.freezeEligibility ?? "allowed",
    discardEligibility: overrides.discardEligibility ?? "allowed",
    blockers: overrides.blockers ?? [],
  };
}

function request(lane: ApplicationLaneDescriptorV1, intent: ApplicationLaneResidencyIntent) {
  return createApplicationLaneResidencyRequestV1(lane, intent);
}

describe("Chromium application-lane projection binding", () => {
  it("binds exact durable lane generation to current private projection only", () => {
    const lane = descriptor();
    const current = projection();
    const binding = createChromiumLaneBindingV1(lane, current);

    expect(binding).toEqual({
      version: 1,
      laneRef: lane.laneRef,
      laneGeneration: 7,
      projectionRef: current.projectionRef,
      tabId: 7,
      source: "explicit-local-binding",
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(matchChromiumLaneBindingV1(lane, binding, current)).toEqual({
      version: 1,
      matched: true,
      reason: "matched",
    });
  });

  it("refuses stale durable generation before application facts are used", () => {
    const oldLane = descriptor(7);
    const currentLane = descriptor(8);
    const current = projection();
    const binding = createChromiumLaneBindingV1(oldLane, current);

    const plan = planBoundChromiumResidencyV1(
      currentLane,
      binding,
      current,
      request(currentLane, "responsive"),
      appFacts(),
    );
    expect(plan.binding).toMatchObject({ matched: false, reason: "lane_generation_mismatch" });
    expect(plan.facts).toBeNull();
    expect(plan.decision).toBeNull();
    expect(plan.effect).toBe("none");
  });

  it("refuses a replaced/swapped browser projection", () => {
    const lane = descriptor();
    const original = projection({ id: 7 });
    const replacement = projection({ id: 8 });
    const binding = createChromiumLaneBindingV1(lane, original);

    expect(matchChromiumLaneBindingV1(lane, binding, replacement)).toMatchObject({
      matched: false,
      reason: "projection_mismatch",
    });
  });
});

describe("bound browser + application lifecycle facts", () => {
  it("resolves application_unknown only after exact binding and retains an auditable fact set", () => {
    const lane = descriptor();
    const current = projection();
    const binding = createChromiumLaneBindingV1(lane, current);
    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      current,
      request(lane, "responsive"),
      appFacts(),
    );

    expect(current.blockers).toContain("application_unknown");
    expect(plan.facts).toMatchObject({
      freezeEligibility: "allowed",
      discardEligibility: "allowed",
      blockers: [],
    });
    expect(plan.decision).toMatchObject({ action: "none", reason: "already_satisfied" });
    expect(plan.effect).toBe("keep_warm");
  });

  it("keeps browser media protection stronger than optimistic application facts", () => {
    const lane = descriptor();
    const current = projection({ audible: true });
    const binding = createChromiumLaneBindingV1(lane, current);
    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      current,
      request(lane, "reclaimable"),
      appFacts(),
    );

    expect(plan.facts).toMatchObject({
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
    });
    expect(plan.facts?.blockers).toContain("media_or_device_active");
    expect(plan.facts?.blockers).not.toContain("application_unknown");
    expect(plan.decision).toMatchObject({ action: "none", reason: "discard_blocked" });
    expect(plan.effect).toBe("none");
  });

  it("keeps browser manual protection stronger than application discard permission", () => {
    const lane = descriptor();
    const current = projection({ autoDiscardable: false });
    const binding = createChromiumLaneBindingV1(lane, current);
    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      current,
      request(lane, "reclaimable"),
      appFacts(),
    );

    expect(plan.facts?.blockers).toContain("manual_protection");
    expect(plan.facts?.discardEligibility).toBe("blocked");
    expect(plan.effect).toBe("none");
  });

  it("preserves application-specific blockers and conservative eligibility", () => {
    const lane = descriptor();
    const current = projection();
    const binding = createChromiumLaneBindingV1(lane, current);
    const blockers: readonly ApplicationLaneLifecycleBlocker[] = ["unsaved_interaction"];
    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      current,
      request(lane, "reclaimable"),
      appFacts({ discardEligibility: "blocked", blockers }),
    );

    expect(plan.facts?.blockers).toEqual(["unsaved_interaction"]);
    expect(plan.decision).toMatchObject({ action: "none", reason: "discard_blocked" });
    expect(plan.effect).toBe("none");
  });
});

describe("bound Chromium residency effects", () => {
  it("maps responsive loaded residency to Keep warm without foreground activation", () => {
    const lane = descriptor();
    const current = projection();
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(lane, "responsive"),
      appFacts(),
    );

    expect(plan.decision).toMatchObject({ action: "none", reason: "already_satisfied" });
    expect(plan.effect).toBe("keep_warm");
  });

  it("maps responsive discarded residency to background Keep warm recovery", () => {
    const lane = descriptor();
    const current = projection({ discarded: true, status: "unloaded" });
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(lane, "responsive"),
      appFacts({ recovery: "recoverable" }),
    );

    expect(plan.decision).toMatchObject({ action: "wake", reason: "wake_required" });
    expect(plan.effect).toBe("keep_warm");
  });

  it("maps exact app-approved reclaimable residency to native discard", () => {
    const lane = descriptor();
    const current = projection();
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(lane, "reclaimable"),
      appFacts(),
    );

    expect(plan.decision).toMatchObject({ action: "discard", reason: "discard_eligible" });
    expect(plan.effect).toBe("discard");
  });

  it("reports suspended as unsupported until Chromium force-freeze is separately earned", () => {
    const lane = descriptor();
    const current = projection();
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(lane, "suspended"),
      appFacts(),
    );

    expect(plan.decision).toMatchObject({ action: "none", reason: "capability_unavailable" });
    expect(plan.effect).toBe("unsupported");
  });

  it("recognizes an already-frozen suspended projection without another effect", () => {
    const lane = descriptor();
    const current = projection({ frozen: true });
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(lane, "suspended"),
      appFacts(),
    );

    expect(plan.decision).toMatchObject({ action: "none", reason: "already_satisfied" });
    expect(plan.effect).toBe("none");
  });

  it("keeps recovery-required lanes effect-free", () => {
    const lane = descriptor();
    const current = projection();
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(lane, "responsive"),
      appFacts({ recovery: "attention_required" }),
    );

    expect(plan.decision).toMatchObject({ action: "attention_required", reason: "recovery_required" });
    expect(plan.effect).toBe("none");
  });

  it("keeps stale consumer requests effect-free after an exact current binding", () => {
    const oldLane = descriptor(7);
    const lane = descriptor(8);
    const current = projection();
    const plan = planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      request(oldLane, "reclaimable"),
      appFacts(),
    );

    expect(plan.decision).toMatchObject({ action: "none", reason: "stale_generation" });
    expect(plan.effect).toBe("none");
  });
});
