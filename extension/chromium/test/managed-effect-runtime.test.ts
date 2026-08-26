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
import type { ChromiumBoundApplicationFactsV1 } from "../src/binding.js";
import { ChromiumBindingRuntime } from "../src/binding-runtime.js";
import {
  createChromiumEffectReceiptV1,
  type ChromiumEffectRequestV1,
} from "../src/effect.js";
import {
  ChromiumManagedEffectRuntime,
  type ChromiumManagedEffectResultV1,
} from "../src/managed-effect-runtime.js";
import {
  projectChromiumTab,
  type ChromiumProjection,
  type ChromiumTabLike,
} from "../src/projection.js";

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

function projection(overrides: Partial<ChromiumTabLike> = {}): ChromiumProjection {
  return projectChromiumTab(
    {
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
    },
    false,
  );
}

function residencyRequest(
  lane: ApplicationLaneDescriptorV1,
  intent: ApplicationLaneResidencyIntent,
) {
  return createApplicationLaneResidencyRequestV1(lane, intent);
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

function expectZeroAuthority(result: ChromiumManagedEffectResultV1): void {
  expect(result.grantsWorkAuthority).toBe(false);
  expect(result.authorizesWorkDispatch).toBe(false);
}

function issuedRequest(result: ChromiumManagedEffectResultV1): ChromiumEffectRequestV1 {
  expect(result.status).toBe("issued");
  expect(result.request).not.toBeNull();
  return result.request!;
}

function boundRuntime(
  lane = descriptor(),
  current = projection(),
  maxPending = 64,
  maxRefs = 4_096,
) {
  const bindings = new ChromiumBindingRuntime();
  bindings.bind(lane, current);
  const effects = new ChromiumManagedEffectRuntime(bindings, maxPending, maxRefs);
  return { bindings, effects, lane, current };
}

describe("ChromiumManagedEffectRuntime issuance", () => {
  it("issues a browser-local Keep warm request only from the retained current binding", () => {
    const { effects, lane, current } = boundRuntime();
    const result = effects.begin(
      lane,
      current,
      residencyRequest(lane, "responsive"),
      appFacts(),
      "effect:one",
    );

    expect(result).toMatchObject({
      status: "issued",
      reason: "effect-issued",
      laneRef: lane.laneRef,
      laneGeneration: 1,
      plan: { effect: "keep_warm" },
      request: {
        requestRef: "effect:one",
        projectionRef: current.projectionRef,
        tabId: current.tabId,
        effect: "keep_warm",
      },
      receipt: null,
    });
    expect("laneRef" in result.request!).toBe(false);
    expectZeroAuthority(result);
    expect(effects.pendingEffectCount).toBe(1);
    expect(effects.claimedRequestRefCount).toBe(1);
  });

  it("issues native discard only from an exact current reclaimable plan", () => {
    const { effects, lane, current } = boundRuntime();
    expect(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "reclaimable"),
        appFacts(),
        "effect:discard",
      ),
    ).toMatchObject({
      status: "issued",
      plan: { effect: "discard" },
      request: { effect: "discard" },
    });
  });

  it("keeps application-blocked plans effect-free and unclaimed", () => {
    const { effects, lane, current } = boundRuntime();
    const result = effects.begin(
      lane,
      current,
      residencyRequest(lane, "reclaimable"),
      appFacts({
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
        blockers: ["unsaved_interaction"],
      }),
      "effect:blocked",
    );

    expect(result).toMatchObject({
      status: "refused",
      reason: "no-executable-effect",
      plan: { effect: "none" },
      request: null,
    });
    expect(effects.pendingEffectCount).toBe(0);
    expect(effects.claimedRequestRefCount).toBe(0);
  });

  it("allows at most one current effect per lane", () => {
    const { effects, lane, current } = boundRuntime();
    effects.begin(
      lane,
      current,
      residencyRequest(lane, "responsive"),
      appFacts(),
      "effect:first",
    );
    expect(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "reclaimable"),
        appFacts(),
        "effect:second",
      ),
    ).toMatchObject({
      status: "refused",
      reason: "lane-effect-in-flight",
      request: { requestRef: "effect:first" },
    });
    expect(effects.pendingEffectCount).toBe(1);
    expect(effects.claimedRequestRefCount).toBe(1);
  });

  it("bounds pending effects independently across lanes", () => {
    const bindings = new ChromiumBindingRuntime();
    const laneA = descriptor("elatura:lane:a");
    const laneB = descriptor("elatura:lane:b");
    const projectionA = projection({ id: 7 });
    const projectionB = projection({ id: 8 });
    bindings.bind(laneA, projectionA);
    bindings.bind(laneB, projectionB);
    const effects = new ChromiumManagedEffectRuntime(bindings, 1, 2);

    expect(
      effects.begin(
        laneA,
        projectionA,
        residencyRequest(laneA, "responsive"),
        appFacts(),
        "effect:a",
      ),
    ).toMatchObject({ status: "issued" });
    expect(
      effects.begin(
        laneB,
        projectionB,
        residencyRequest(laneB, "responsive"),
        appFacts(),
        "effect:b",
      ),
    ).toMatchObject({ status: "refused", reason: "pending-effect-capacity" });
    expect(effects.claimedRequestRefCount).toBe(1);

    effects.cancel("effect:a");
    expect(
      effects.begin(
        laneB,
        projectionB,
        residencyRequest(laneB, "responsive"),
        appFacts(),
        "effect:b",
      ),
    ).toMatchObject({ status: "issued" });
  });
});

describe("ChromiumManagedEffectRuntime receipt admission", () => {
  it("accepts an exact current applied receipt and consumes pending ownership", () => {
    const { effects, lane, current } = boundRuntime();
    const request = issuedRequest(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:one",
      ),
    );
    const receipt = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      current,
    );

    const result = effects.acceptReceipt(lane, receipt);
    expect(result).toMatchObject({
      status: "accepted",
      reason: "receipt-accepted",
      request: { requestRef: "effect:one" },
      receipt: { requestRef: "effect:one", outcome: "applied" },
    });
    expectZeroAuthority(result);
    expect(effects.pendingEffectCount).toBe(0);
    expect(effects.claimedRequestRefCount).toBe(1);
  });

  it("preserves browser refusal/error outcomes after exact current correlation", () => {
    for (const [outcome, reason] of [
      ["refused", "browser_preflight_refused"],
      ["stale_projection", "projection_mismatch"],
      ["browser_error", "operation_failed"],
    ] as const) {
      const { effects, lane, current } = boundRuntime();
      const request = issuedRequest(
        effects.begin(
          lane,
          current,
          residencyRequest(lane, "reclaimable"),
          appFacts(),
          `effect:${outcome}`,
        ),
      );
      const receipt = createChromiumEffectReceiptV1(request, outcome, reason, null);
      expect(effects.acceptReceipt(lane, receipt)).toMatchObject({
        status: "accepted",
        reason: "receipt-accepted",
        receipt: { outcome, reason },
      });
    }
  });

  it("does not consume pending state for a mismatched receipt", () => {
    const { effects, lane, current } = boundRuntime();
    const request = issuedRequest(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:one",
      ),
    );
    const valid = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      current,
    );
    const mismatched = Object.freeze({ ...valid, effect: "discard" as const });

    expect(effects.acceptReceipt(lane, mismatched)).toMatchObject({
      status: "refused",
      reason: "receipt-mismatch",
    });
    expect(effects.pendingEffectCount).toBe(1);
    expect(effects.acceptReceipt(lane, valid)).toMatchObject({ status: "accepted" });
  });

  it("contains malformed receipt inspection without consuming pending state", () => {
    const { effects, lane, current } = boundRuntime();
    const request = issuedRequest(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:one",
      ),
    );
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("PRIVATE_RECEIPT_TRAP");
      },
    });
    let text = "";
    try {
      effects.acceptReceipt(lane, hostile);
    } catch (error) {
      text = String(error);
    }
    expect(text).toContain("receipt is invalid");
    expect(text).not.toContain("PRIVATE_RECEIPT_TRAP");
    expect(effects.pendingEffectCount).toBe(1);

    const valid = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      current,
    );
    expect(effects.acceptReceipt(lane, valid)).toMatchObject({ status: "accepted" });
  });

  it("makes an old receipt stale after lane generation advances", () => {
    const laneV1 = descriptor("elatura:lane:test-a", 1);
    const laneV2 = descriptor("elatura:lane:test-a", 2);
    const current = projection({ id: 7 });
    const { bindings, effects } = boundRuntime(laneV1, current);
    const request = issuedRequest(
      effects.begin(
        laneV1,
        current,
        residencyRequest(laneV1, "responsive"),
        appFacts(),
        "effect:old-generation",
      ),
    );
    const receipt = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      current,
    );

    bindings.observeDescriptor(laneV2);
    expect(effects.acceptReceipt(laneV2, receipt)).toMatchObject({
      status: "stale",
      reason: "stale-generation",
      receipt: null,
    });
    expect(effects.pendingEffectCount).toBe(0);
  });

  it("makes an old receipt stale after same-generation projection replacement", () => {
    const lane = descriptor();
    const oldProjection = projection({ id: 7 });
    const newProjection = projection({ id: 8 });
    const { bindings, effects } = boundRuntime(lane, oldProjection);
    const request = issuedRequest(
      effects.begin(
        lane,
        oldProjection,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:old-projection",
      ),
    );
    const receipt = createChromiumEffectReceiptV1(
      request,
      "applied",
      "effect_applied",
      oldProjection,
    );

    bindings.rebindProjection(lane, oldProjection.projectionRef, newProjection);
    expect(effects.acceptReceipt(lane, receipt)).toMatchObject({
      status: "stale",
      reason: "stale-projection",
    });
    expect(effects.pendingEffectCount).toBe(0);
  });

  it("drops a stale pending effect before issuing one for the replacement projection", () => {
    const lane = descriptor();
    const oldProjection = projection({ id: 7 });
    const newProjection = projection({ id: 8 });
    const { bindings, effects } = boundRuntime(lane, oldProjection);
    effects.begin(
      lane,
      oldProjection,
      residencyRequest(lane, "responsive"),
      appFacts(),
      "effect:old",
    );
    bindings.rebindProjection(lane, oldProjection.projectionRef, newProjection);

    expect(
      effects.begin(
        lane,
        newProjection,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:new",
      ),
    ).toMatchObject({
      status: "issued",
      request: { requestRef: "effect:new", projectionRef: newProjection.projectionRef },
    });
    expect(effects.pendingEffectCount).toBe(1);
    expect(effects.claimedRequestRefCount).toBe(2);
  });
});

describe("ChromiumManagedEffectRuntime anti-replay and cleanup", () => {
  it("never reuses an issued request reference after completion or cancellation", () => {
    const { effects, lane, current } = boundRuntime();
    const request = issuedRequest(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:once",
      ),
    );
    effects.acceptReceipt(
      lane,
      createChromiumEffectReceiptV1(request, "applied", "effect_applied", current),
    );
    expect(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:once",
      ),
    ).toMatchObject({ status: "refused", reason: "request-ref-reused" });

    const issued = effects.begin(
      lane,
      current,
      residencyRequest(lane, "responsive"),
      appFacts(),
      "effect:cancel",
    );
    expect(issued.status).toBe("issued");
    expect(effects.cancel("effect:cancel")).toMatchObject({
      status: "cancelled",
      reason: "effect-cancelled",
    });
    expect(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:cancel",
      ),
    ).toMatchObject({ status: "refused", reason: "request-ref-reused" });
  });

  it("keeps claimed refs through clear so late receipts cannot match reused refs", () => {
    const { effects, lane, current } = boundRuntime();
    effects.begin(
      lane,
      current,
      residencyRequest(lane, "responsive"),
      appFacts(),
      "effect:before-clear",
    );
    effects.clear();
    expect(effects.pendingEffectCount).toBe(0);
    expect(effects.claimedRequestRefCount).toBe(1);
    expect(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:before-clear",
      ),
    ).toMatchObject({ status: "refused", reason: "request-ref-reused" });
  });

  it("bounds request-ref anti-replay history explicitly", () => {
    const { effects, lane, current } = boundRuntime(
      descriptor(),
      projection(),
      1,
      1,
    );
    const first = effects.begin(
      lane,
      current,
      residencyRequest(lane, "responsive"),
      appFacts(),
      "effect:first",
    );
    expect(first.status).toBe("issued");
    effects.cancel("effect:first");

    expect(
      effects.begin(
        lane,
        current,
        residencyRequest(lane, "responsive"),
        appFacts(),
        "effect:second",
      ),
    ).toMatchObject({
      status: "refused",
      reason: "request-history-capacity",
    });
  });
});
