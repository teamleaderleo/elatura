// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseApplicationLaneDescriptorV1 } from "@elatura/core/application-lane";
import { createApplicationLaneResidencyRequestV1 } from "@elatura/core/application-lane-lifecycle";
import { ChromiumBindingRuntime } from "../src/binding-runtime.js";
import type { ChromiumBoundApplicationFactsV1 } from "../src/binding.js";
import { projectChromiumTab } from "../src/projection.js";

function descriptor(generation: number, laneRef = "elatura:lane:tombstone") {
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

function projection(tabId = 7) {
  return projectChromiumTab(
    {
      id: tabId,
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      lastAccessed: 1_000,
      windowId: 1,
      index: 0,
      status: "complete",
    },
    false,
  );
}

const facts: ChromiumBoundApplicationFactsV1 = {
  recovery: "verified",
  freezeEligibility: "allowed",
  discardEligibility: "allowed",
  blockers: [],
};

describe("unbound generation tombstones", () => {
  it("remembers an observed generation before any projection is bound", () => {
    const runtime = new ChromiumBindingRuntime();
    expect(runtime.observeDescriptor(descriptor(2))).toMatchObject({
      status: "observed",
      reason: "binding-missing",
      laneGeneration: 2,
      binding: null,
    });
    expect(runtime.trackedLaneCount).toBe(1);

    expect(runtime.bind(descriptor(1), projection())).toMatchObject({
      status: "refused",
      reason: "stale-generation",
      binding: null,
    });
    expect(runtime.bind(descriptor(2), projection())).toMatchObject({
      status: "bound",
      reason: "binding-created",
      laneGeneration: 2,
    });
  });

  it("remembers an unbound current generation discovered by a plan attempt", () => {
    const runtime = new ChromiumBindingRuntime();
    const laneV2 = descriptor(2);
    expect(
      runtime.planCurrent(
        laneV2,
        projection(),
        createApplicationLaneResidencyRequestV1(laneV2, "responsive"),
        facts,
      ),
    ).toMatchObject({
      status: "refused",
      reason: "binding-missing",
      laneGeneration: 2,
      binding: null,
      plan: null,
    });
    expect(runtime.trackedLaneCount).toBe(1);
    expect(runtime.bind(descriptor(1), projection())).toMatchObject({
      status: "refused",
      reason: "stale-generation",
    });
  });

  it("reports capacity instead of silently dropping anti-replay history", () => {
    const runtime = new ChromiumBindingRuntime(1);
    expect(runtime.observeDescriptor(descriptor(2, "elatura:lane:one"))).toMatchObject({
      status: "observed",
      reason: "binding-missing",
    });
    expect(runtime.observeDescriptor(descriptor(1, "elatura:lane:two"))).toMatchObject({
      status: "refused",
      reason: "binding-capacity",
    });
    expect(runtime.trackedLaneCount).toBe(1);
  });
});
