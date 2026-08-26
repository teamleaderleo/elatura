// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseApplicationLaneDescriptorV1,
  type ApplicationLaneDescriptorV1,
} from "@elatura/core/application-lane";
import {
  createApplicationLaneResidencyRequestV1,
} from "@elatura/core/application-lane-lifecycle";
import {
  createChromiumLaneBindingV1,
  planBoundChromiumResidencyV1,
} from "../src/binding.js";
import {
  createChromiumEffectReceiptV1,
  createChromiumEffectRequestV1,
  matchChromiumEffectReceiptV1,
  parseChromiumEffectReceiptV1,
  parseChromiumEffectRequestV1,
  projectionMatchesChromiumEffectRequestV1,
  toChromiumEffectProjectionV1,
} from "../src/effect.js";
import {
  projectChromiumTab,
  type ChromiumProjection,
  type ChromiumTabLike,
} from "../src/projection.js";

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

function projection(overrides: Partial<ChromiumTabLike> = {}): ChromiumProjection {
  return projectChromiumTab(tab(overrides), false);
}

function plan(
  intent: "responsive" | "reclaimable" | "suspended",
  current = projection(),
) {
  const lane = descriptor();
  return {
    lane,
    current,
    plan: planBoundChromiumResidencyV1(
      lane,
      createChromiumLaneBindingV1(lane, current),
      current,
      createApplicationLaneResidencyRequestV1(lane, intent),
      {
        recovery: "verified",
        freezeEligibility: "allowed",
        discardEligibility: "allowed",
        blockers: [],
      },
    ),
  };
}

describe("Chromium effect request derivation", () => {
  it("removes durable lane identity at the browser-local effect boundary", () => {
    const current = projection();
    const planned = plan("responsive", current).plan;
    const request = createChromiumEffectRequestV1(planned, current, "effect-0001");

    expect(request).toEqual({
      version: 1,
      requestRef: "effect-0001",
      projectionRef: current.projectionRef,
      tabId: current.tabId,
      effect: "keep_warm",
    });
    expect(request && "laneRef" in request).toBe(false);
    expect(request && "laneGeneration" in request).toBe(false);
  });

  it("creates native discard only from an already-approved bound plan", () => {
    const current = projection();
    const planned = plan("reclaimable", current).plan;
    expect(createChromiumEffectRequestV1(planned, current, "effect-0002")).toMatchObject({
      effect: "discard",
      projectionRef: current.projectionRef,
    });
  });

  it("refuses unsupported/no-effect plans and a replaced current projection", () => {
    const suspended = plan("suspended");
    expect(
      createChromiumEffectRequestV1(suspended.plan, suspended.current, "effect-0003"),
    ).toBeNull();

    const responsive = plan("responsive");
    expect(
      createChromiumEffectRequestV1(
        responsive.plan,
        projection({ id: 8 }),
        "effect-0004",
      ),
    ).toBeNull();
  });

  it("parses exact browser-local requests and rejects unknown fields/accessors", () => {
    const parsed = parseChromiumEffectRequestV1({
      version: 1,
      requestRef: "effect-0005",
      projectionRef: "chrome-session-tab-7",
      tabId: 7,
      effect: "keep_warm",
    });
    expect(Object.isFrozen(parsed)).toBe(true);

    expect(() =>
      parseChromiumEffectRequestV1({ ...parsed, laneRef: "elatura:lane:chat-a" }),
    ).toThrow("Chromium effect request is invalid");

    let invoked = false;
    const accessor = { ...parsed } as Record<string, unknown>;
    Object.defineProperty(accessor, "tabId", {
      enumerable: true,
      get() {
        invoked = true;
        return 7;
      },
    });
    expect(() => parseChromiumEffectRequestV1(accessor)).toThrow(
      "Chromium effect request is invalid",
    );
    expect(invoked).toBe(false);
  });
});

describe("Chromium effect projection revalidation", () => {
  it("matches exact current projection and refuses replacement", () => {
    const current = projection();
    const request = createChromiumEffectRequestV1(
      plan("responsive", current).plan,
      current,
      "effect-0006",
    );
    if (request === null) throw new Error("Expected effect request");

    expect(projectionMatchesChromiumEffectRequestV1(request, current)).toBe(true);
    expect(
      projectionMatchesChromiumEffectRequestV1(request, projection({ id: 8 })),
    ).toBe(false);
  });

  it("reduces post-effect projection receipts to lifecycle essentials", () => {
    const reduced = toChromiumEffectProjectionV1(projection());
    expect(reduced).toEqual({
      projectionRef: "chrome-session-tab-7",
      tabId: 7,
      browserResidency: "background",
      autoDiscardable: true,
    });
    expect("blockers" in reduced).toBe(false);
    expect("lastAccessedMs" in reduced).toBe(false);
  });
});

describe("Chromium effect receipts", () => {
  it("creates, parses, and matches an applied receipt", () => {
    const current = projection();
    const request = createChromiumEffectRequestV1(
      plan("responsive", current).plan,
      current,
      "effect-0007",
    );
    if (request === null) throw new Error("Expected effect request");

    const resulting = projection({ autoDiscardable: false });
    const receipt = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      resulting,
    );
    const parsed = parseChromiumEffectReceiptV1(receipt);

    expect(parsed.projection).toMatchObject({
      projectionRef: request.projectionRef,
      autoDiscardable: false,
    });
    expect(matchChromiumEffectReceiptV1(request, parsed)).toEqual({
      matched: true,
      reason: "matched",
    });
  });

  it("permits a stale-projection receipt while preserving the original correlation", () => {
    const current = projection();
    const request = createChromiumEffectRequestV1(
      plan("responsive", current).plan,
      current,
      "effect-0008",
    );
    if (request === null) throw new Error("Expected effect request");

    const receipt = createChromiumEffectReceiptV1(
      request,
      "stale_projection",
      "projection_mismatch",
      projection({ id: 8 }),
    );
    expect(receipt.outcome).toBe("stale_projection");
    expect(matchChromiumEffectReceiptV1(request, receipt).matched).toBe(true);
  });

  it("rejects an applied receipt that does not describe the requested projection", () => {
    const current = projection();
    const request = createChromiumEffectRequestV1(
      plan("responsive", current).plan,
      current,
      "effect-0009",
    );
    if (request === null) throw new Error("Expected effect request");

    expect(() =>
      createChromiumEffectReceiptV1(
        request,
        "applied",
        "effect_applied",
        projection({ id: 8 }),
      ),
    ).toThrow("requires the requested projection");
  });

  it("detects a correlation/effect mismatch", () => {
    const current = projection();
    const request = createChromiumEffectRequestV1(
      plan("responsive", current).plan,
      current,
      "effect-0010",
    );
    if (request === null) throw new Error("Expected effect request");
    const receipt = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      projection({ autoDiscardable: false }),
    );

    const different = parseChromiumEffectRequestV1({
      ...request,
      requestRef: "effect-0011",
    });
    expect(matchChromiumEffectReceiptV1(different, receipt)).toEqual({
      matched: false,
      reason: "request_mismatch",
    });
  });
});
