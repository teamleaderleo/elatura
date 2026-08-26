// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseApplicationLaneDescriptorV1,
  type ApplicationLaneDescriptorV1,
} from "@elatura/core/application-lane";
import {
  createApplicationLaneResidencyRequestV1,
  type ApplicationLaneResidencyIntent,
} from "@elatura/core/application-lane-lifecycle";
import {
  ChromiumBindingRuntime,
  type ChromiumBindingRuntimeReceiptV1,
} from "../src/binding-runtime.js";
import type { ChromiumBoundApplicationFactsV1 } from "../src/binding.js";
import { projectChromiumTab, type ChromiumProjection, type ChromiumTabLike } from "../src/projection.js";

const NOW = 1_000_000;

function descriptor(
  laneRef = "elatura:lane:test-a",
  generation = 1,
): ApplicationLaneDescriptorV1 {
  return parseApplicationLaneDescriptorV1({
    version: 1,
    laneRef,
    generation,
    adapter: { id: "synthetic", version: "1" },
    capabilities: ["events", "observe", "activate", "screenshot"],
    state: "active",
    observedAt: "2026-08-27T00:00:00.000Z",
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

function projection(overrides: Partial<ChromiumTabLike> = {}): ChromiumProjection {
  return projectChromiumTab(tab(overrides), false);
}

function request(
  lane: ApplicationLaneDescriptorV1,
  intent: ApplicationLaneResidencyIntent,
) {
  return createApplicationLaneResidencyRequestV1(lane, intent);
}

function applicationFacts(
  overrides: Partial<ChromiumBoundApplicationFactsV1> = {},
): ChromiumBoundApplicationFactsV1 {
  return {
    recovery: overrides.recovery ?? "verified",
    freezeEligibility: overrides.freezeEligibility ?? "allowed",
    discardEligibility: overrides.discardEligibility ?? "allowed",
    blockers: overrides.blockers ?? [],
  };
}

function expectZeroAuthority(value: ChromiumBindingRuntimeReceiptV1): void {
  expect(value.grantsWorkAuthority).toBe(false);
  expect(value.authorizesWorkDispatch).toBe(false);
}

function thrownText(operation: () => unknown): string {
  try {
    operation();
    return "";
  } catch (error) {
    return String(error);
  }
}

describe("ChromiumBindingRuntime currentness", () => {
  it("binds one exact generation to one projection and reports zero work authority", () => {
    const runtime = new ChromiumBindingRuntime();
    const result = runtime.bind(descriptor(), projection());

    expect(result).toMatchObject({
      status: "bound",
      reason: "binding-created",
      laneRef: "elatura:lane:test-a",
      laneGeneration: 1,
      binding: {
        laneRef: "elatura:lane:test-a",
        laneGeneration: 1,
        projectionRef: "chrome-session-tab-7",
        tabId: 7,
      },
      plan: null,
    });
    expectZeroAuthority(result);
    expect(runtime.trackedLaneCount).toBe(1);
    expect(runtime.activeBindingCount).toBe(1);
  });

  it("keeps projection ownership one-to-one", () => {
    const runtime = new ChromiumBindingRuntime();
    runtime.bind(descriptor("elatura:lane:one"), projection({ id: 7 }));

    expect(
      runtime.bind(descriptor("elatura:lane:two"), projection({ id: 7 })),
    ).toMatchObject({ status: "refused", reason: "projection-collision" });
    expect(
      runtime.bind(descriptor("elatura:lane:one"), projection({ id: 8 })),
    ).toMatchObject({
      status: "refused",
      reason: "projection-rebind-required",
      binding: { projectionRef: "chrome-session-tab-7" },
    });
    expect(runtime.activeBindingCount).toBe(1);
  });

  it("invalidates the old projection immediately when a newer generation is observed", () => {
    const runtime = new ChromiumBindingRuntime();
    runtime.bind(descriptor("elatura:lane:one", 1), projection({ id: 7 }));

    expect(runtime.observeDescriptor(descriptor("elatura:lane:one", 2))).toMatchObject({
      status: "observed",
      reason: "generation-advanced-unbound",
      binding: null,
      laneGeneration: 2,
    });
    expect(runtime.activeBindingCount).toBe(0);
    expect(runtime.observeDescriptor(descriptor("elatura:lane:one", 1))).toMatchObject({
      status: "refused",
      reason: "stale-generation",
    });
  });

  it("preserves the newer tombstone when replacement projection binding collides", () => {
    const runtime = new ChromiumBindingRuntime();
    runtime.bind(descriptor("elatura:lane:one", 1), projection({ id: 7 }));
    runtime.bind(descriptor("elatura:lane:two", 1), projection({ id: 8 }));

    expect(
      runtime.bind(descriptor("elatura:lane:one", 2), projection({ id: 8 })),
    ).toMatchObject({
      status: "refused",
      reason: "projection-collision",
      binding: null,
      laneGeneration: 2,
    });
    expect(runtime.observeDescriptor(descriptor("elatura:lane:one", 1))).toMatchObject({
      status: "refused",
      reason: "stale-generation",
    });
    expect(runtime.currentBinding(descriptor("elatura:lane:one", 2))).toBeNull();
  });

  it("requires exact old projection proof for same-generation replacement", () => {
    const runtime = new ChromiumBindingRuntime();
    runtime.bind(descriptor(), projection({ id: 7 }));

    expect(
      runtime.rebindProjection(
        descriptor(),
        "chrome-session-tab-6",
        projection({ id: 8 }),
      ),
    ).toMatchObject({ status: "refused", reason: "old-projection-mismatch" });

    expect(
      runtime.rebindProjection(
        descriptor(),
        "chrome-session-tab-7",
        projection({ id: 8 }),
      ),
    ).toMatchObject({
      status: "rebound",
      reason: "projection-rebound",
      binding: { projectionRef: "chrome-session-tab-8", tabId: 8 },
    });
  });

  it("turns a generation change seen during projection replacement into unbound authority", () => {
    const runtime = new ChromiumBindingRuntime();
    runtime.bind(descriptor("elatura:lane:test-a", 1), projection({ id: 7 }));

    expect(
      runtime.rebindProjection(
        descriptor("elatura:lane:test-a", 2),
        "chrome-session-tab-7",
        projection({ id: 8 }),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "generation-advanced-unbound",
      binding: null,
    });
    expect(runtime.activeBindingCount).toBe(0);
  });

  it("models worker/runtime restart by clearing all current binding authority", () => {
    const runtime = new ChromiumBindingRuntime();
    runtime.bind(descriptor(), projection());
    runtime.clear();

    expect(runtime.trackedLaneCount).toBe(0);
    expect(runtime.activeBindingCount).toBe(0);
    expect(runtime.observeDescriptor(descriptor())).toMatchObject({
      status: "observed",
      reason: "binding-missing",
      binding: null,
    });
  });

  it("bounds tracked lane refs without consuming a slot on a collision refusal", () => {
    const runtime = new ChromiumBindingRuntime(2);
    runtime.bind(descriptor("elatura:lane:one"), projection({ id: 7 }));
    expect(
      runtime.bind(descriptor("elatura:lane:two"), projection({ id: 7 })),
    ).toMatchObject({ status: "refused", reason: "projection-collision" });
    expect(runtime.trackedLaneCount).toBe(1);

    expect(
      runtime.bind(descriptor("elatura:lane:two"), projection({ id: 8 })),
    ).toMatchObject({ status: "bound" });
    expect(runtime.trackedLaneCount).toBe(2);
    expect(
      runtime.bind(descriptor("elatura:lane:three"), projection({ id: 9 })),
    ).toMatchObject({ status: "refused", reason: "binding-capacity" });
  });
});

describe("ChromiumBindingRuntime current planning", () => {
  it("plans responsive Keep warm only through the retained current binding", () => {
    const runtime = new ChromiumBindingRuntime();
    const lane = descriptor();
    const current = projection();
    runtime.bind(lane, current);

    const result = runtime.planCurrent(
      lane,
      current,
      request(lane, "responsive"),
      applicationFacts(),
    );
    expect(result).toMatchObject({
      status: "planned",
      reason: "plan-ready",
      binding: { projectionRef: current.projectionRef },
      plan: {
        binding: { matched: true, reason: "matched" },
        decision: { action: "none", reason: "already_satisfied" },
        effect: "keep_warm",
      },
    });
    expectZeroAuthority(result);
  });

  it("plans native discard only through an exact current generation and projection", () => {
    const runtime = new ChromiumBindingRuntime();
    const lane = descriptor();
    const current = projection();
    runtime.bind(lane, current);

    expect(
      runtime.planCurrent(
        lane,
        current,
        request(lane, "reclaimable"),
        applicationFacts(),
      ),
    ).toMatchObject({
      status: "planned",
      reason: "plan-ready",
      plan: {
        decision: { action: "discard", reason: "discard_eligible" },
        effect: "discard",
      },
    });
  });

  it("refuses a replaced browser projection before calling the pure planner", () => {
    const runtime = new ChromiumBindingRuntime();
    const lane = descriptor();
    runtime.bind(lane, projection({ id: 7 }));

    expect(
      runtime.planCurrent(
        lane,
        projection({ id: 8 }),
        request(lane, "reclaimable"),
        applicationFacts(),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "projection-mismatch",
      plan: null,
    });
  });

  it("makes detached historical binding values powerless after generation advance", () => {
    const runtime = new ChromiumBindingRuntime();
    const laneV1 = descriptor("elatura:lane:test-a", 1);
    const laneV2 = descriptor("elatura:lane:test-a", 2);
    runtime.bind(laneV1, projection({ id: 7 }));
    const detachedOldBinding = runtime.currentBinding(laneV1);
    expect(detachedOldBinding).not.toBeNull();

    runtime.observeDescriptor(laneV2);
    expect(
      runtime.planCurrent(
        laneV1,
        projection({ id: 7 }),
        request(laneV1, "reclaimable"),
        applicationFacts(),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "stale-generation",
      binding: null,
      plan: null,
    });
    expect(detachedOldBinding).toMatchObject({
      laneGeneration: 1,
      projectionRef: "chrome-session-tab-7",
    });
  });

  it("valid newer descriptor invalidates old authority before a stale residency request can plan", () => {
    const runtime = new ChromiumBindingRuntime();
    const laneV1 = descriptor("elatura:lane:test-a", 1);
    const laneV2 = descriptor("elatura:lane:test-a", 2);
    runtime.bind(laneV1, projection());

    expect(
      runtime.planCurrent(
        laneV2,
        projection(),
        request(laneV1, "reclaimable"),
        applicationFacts(),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "generation-advanced-unbound",
      binding: null,
      plan: null,
    });
    expect(runtime.observeDescriptor(laneV1)).toMatchObject({
      status: "refused",
      reason: "stale-generation",
    });
  });

  it("requires rebind after clear before any plan can be produced", () => {
    const runtime = new ChromiumBindingRuntime();
    const lane = descriptor();
    const current = projection();
    runtime.bind(lane, current);
    runtime.clear();

    expect(
      runtime.planCurrent(
        lane,
        current,
        request(lane, "responsive"),
        applicationFacts(),
      ),
    ).toMatchObject({
      status: "refused",
      reason: "binding-missing",
      plan: null,
    });
  });

  it("keeps application-blocked residency effect-free while still returning a current plan", () => {
    const runtime = new ChromiumBindingRuntime();
    const lane = descriptor();
    const current = projection();
    runtime.bind(lane, current);

    expect(
      runtime.planCurrent(
        lane,
        current,
        request(lane, "reclaimable"),
        applicationFacts({
          discardEligibility: "blocked",
          blockers: ["unsaved_interaction"],
        }),
      ),
    ).toMatchObject({
      status: "planned",
      reason: "plan-ready",
      plan: {
        decision: { action: "none", reason: "discard_blocked" },
        effect: "none",
      },
    });
  });
});

describe("ChromiumBindingRuntime parser and mutation containment", () => {
  it("contains hostile descriptor trap text", () => {
    const runtime = new ChromiumBindingRuntime();
    const hostile = new Proxy(descriptor(), {
      getPrototypeOf() {
        throw new Error("PRIVATE_DESCRIPTOR_TRAP");
      },
    });

    const text = thrownText(() => runtime.bind(hostile, projection()));
    expect(text).toContain("descriptor is invalid");
    expect(text).not.toContain("PRIVATE_DESCRIPTOR_TRAP");
    expect(runtime.trackedLaneCount).toBe(0);
  });

  it("validates a hostile projection before a newer generation can revoke current binding", () => {
    const runtime = new ChromiumBindingRuntime();
    const laneV1 = descriptor("elatura:lane:test-a", 1);
    const laneV2 = descriptor("elatura:lane:test-a", 2);
    runtime.bind(laneV1, projection());

    const hostile = new Proxy(projection(), {
      get(target, property, receiver) {
        if (property === "projectionRef") throw new Error("PRIVATE_PROJECTION_TRAP");
        return Reflect.get(target, property, receiver);
      },
    });
    const text = thrownText(() =>
      runtime.planCurrent(
        laneV2,
        hostile,
        request(laneV2, "responsive"),
        applicationFacts(),
      ),
    );
    expect(text).toContain("projection is invalid");
    expect(text).not.toContain("PRIVATE_PROJECTION_TRAP");
    expect(runtime.observeDescriptor(laneV1)).toMatchObject({
      status: "observed",
      reason: "binding-current",
    });
  });
});
