// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  APPLICATION_LANE_CONTRACT_VERSION,
  parseApplicationLaneLifecycleRequest,
  parseApplicationLaneSnapshot,
  planApplicationLaneLifecycle,
  planApplicationLaneObservation,
  type ApplicationLaneLifecycleCapabilities,
  type ApplicationLaneSnapshot,
} from "../src/application-lanes.js";

const NOW = 1_000_000;

const ALL_CAPABILITIES: ApplicationLaneLifecycleCapabilities = Object.freeze({
  canWake: true,
  canActivate: true,
  canFreeze: true,
  canDiscard: true,
  canRecoverProjection: true,
});

function snapshot(
  options: {
    generation?: number;
    residency?: ApplicationLaneSnapshot["projection"]["residency"];
    recovery?: ApplicationLaneSnapshot["projection"]["recovery"];
    signal?: ApplicationLaneSnapshot["signal"]["kind"];
    freeze?: ApplicationLaneSnapshot["eligibility"]["freeze"];
    discard?: ApplicationLaneSnapshot["eligibility"]["discard"];
    blockers?: ApplicationLaneSnapshot["eligibility"]["blockers"];
  } = {},
): ApplicationLaneSnapshot {
  return {
    contractVersion: APPLICATION_LANE_CONTRACT_VERSION,
    laneKey: "lane.chat-01",
    applicationClass: "chatgpt-conversation",
    generation: options.generation ?? 7,
    observedAt: NOW,
    intervention: "browser-lifecycle",
    projection: {
      projectionKey: options.residency === "missing" ? null : "projection.tab-19",
      residency: options.residency ?? "background",
      recovery: options.recovery ?? "verified",
    },
    signal: {
      kind: options.signal ?? "idle",
      confidence: "probable",
      observedAt: NOW - 10,
    },
    eligibility: {
      freeze: options.freeze ?? "allowed",
      discard: options.discard ?? "allowed",
      blockers: options.blockers ?? [],
    },
  };
}

function request(
  intent: "interactive" | "responsive" | "suspended" | "reclaimable",
  expectedGeneration = 7,
) {
  return {
    contractVersion: APPLICATION_LANE_CONTRACT_VERSION,
    laneKey: "lane.chat-01",
    expectedGeneration,
    intent,
  } as const;
}

describe("application lane contract parsing", () => {
  it("accepts a content-minimized snapshot and freezes nested records", () => {
    const parsed = parseApplicationLaneSnapshot(snapshot());
    expect(parsed.laneKey).toBe("lane.chat-01");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.projection)).toBe(true);
    expect(Object.isFrozen(parsed.signal)).toBe(true);
    expect(Object.isFrozen(parsed.eligibility)).toBe(true);
    expect(Object.isFrozen(parsed.eligibility.blockers)).toBe(true);
  });

  it("rejects unknown fields instead of admitting arbitrary page data", () => {
    expect(() =>
      parseApplicationLaneSnapshot({
        ...snapshot(),
        transcript: "private page content",
      }),
    ).toThrow("contains missing or unknown fields");
  });

  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const input = { ...snapshot() } as Record<string, unknown>;
    Object.defineProperty(input, "applicationClass", {
      enumerable: true,
      get() {
        invoked = true;
        return "chatgpt-conversation";
      },
    });

    expect(() => parseApplicationLaneSnapshot(input)).toThrow(
      "Expected own data property: applicationClass",
    );
    expect(invoked).toBe(false);
  });

  it("rejects a signal newer than its enclosing snapshot", () => {
    const input = snapshot() as unknown as Record<string, unknown>;
    input.signal = {
      kind: "changed",
      confidence: "exact",
      observedAt: NOW + 1,
    };
    expect(() => parseApplicationLaneSnapshot(input)).toThrow(
      "signal.observedAt cannot be newer than the lane snapshot",
    );
  });

  it("rejects duplicate lifecycle blockers", () => {
    expect(() =>
      parseApplicationLaneSnapshot(
        snapshot({ blockers: ["active-generation", "active-generation"] }),
      ),
    ).toThrow("eligibility.blockers contains a duplicate value");
  });

  it("parses generation-bound lifecycle requests", () => {
    expect(parseApplicationLaneLifecycleRequest(request("responsive"))).toEqual(
      request("responsive"),
    );
    expect(() =>
      parseApplicationLaneLifecycleRequest({
        ...request("responsive"),
        expectedGeneration: -1,
      }),
    ).toThrow("expectedGeneration must be a non-negative safe integer");
  });
});

describe("application lane lifecycle planning", () => {
  it("activates a background lane when interactive access is requested", () => {
    expect(
      planApplicationLaneLifecycle(snapshot(), request("interactive"), ALL_CAPABILITIES),
    ).toMatchObject({ action: "activate", reason: "activation-required" });
  });

  it("wakes a frozen or discarded lane for responsive warm residency", () => {
    expect(
      planApplicationLaneLifecycle(
        snapshot({ residency: "frozen" }),
        request("responsive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "wake", reason: "wake-required" });
    expect(
      planApplicationLaneLifecycle(
        snapshot({ residency: "discarded", recovery: "recoverable" }),
        request("responsive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "wake", reason: "wake-required" });
  });

  it("freezes only when the application explicitly admits freeze", () => {
    expect(
      planApplicationLaneLifecycle(snapshot(), request("suspended"), ALL_CAPABILITIES),
    ).toMatchObject({ action: "freeze", reason: "freeze-eligible" });
    expect(
      planApplicationLaneLifecycle(
        snapshot({ freeze: "unknown" }),
        request("suspended"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "eligibility-unknown" });
    expect(
      planApplicationLaneLifecycle(
        snapshot({ freeze: "blocked", blockers: ["active-generation"] }),
        request("suspended"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "freeze-blocked" });
  });

  it("uses discard for reclaimable lanes and freeze as the safer fallback", () => {
    expect(
      planApplicationLaneLifecycle(snapshot(), request("reclaimable"), ALL_CAPABILITIES),
    ).toMatchObject({ action: "discard", reason: "discard-eligible" });
    expect(
      planApplicationLaneLifecycle(
        snapshot({ discard: "blocked", freeze: "allowed" }),
        request("reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "freeze", reason: "discard-fallback-freeze" });
  });

  it("never freezes or discards the currently foreground lane", () => {
    expect(
      planApplicationLaneLifecycle(
        snapshot({ residency: "foreground" }),
        request("reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "foreground-protected" });
  });

  it("refuses stale generation requests", () => {
    expect(
      planApplicationLaneLifecycle(snapshot(), request("reclaimable", 6), ALL_CAPABILITIES),
    ).toMatchObject({ action: "none", reason: "stale-generation", generation: 7 });
  });

  it("surfaces recovery and drift instead of pretending a lane can resume", () => {
    expect(
      planApplicationLaneLifecycle(
        snapshot({ recovery: "drifted" }),
        request("interactive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "attention-required", reason: "recovery-required" });
    expect(
      planApplicationLaneLifecycle(
        snapshot({ recovery: "recovering" }),
        request("interactive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "wait", reason: "recovery-in-progress" });
  });

  it("recovers a missing browser projection only when the lane is wanted again", () => {
    expect(
      planApplicationLaneLifecycle(
        snapshot({ residency: "missing", recovery: "recoverable" }),
        request("responsive"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({
      action: "recover-projection",
      reason: "projection-recovery-required",
    });
    expect(
      planApplicationLaneLifecycle(
        snapshot({ residency: "missing", recovery: "recoverable" }),
        request("reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "none", reason: "already-reclaimed" });
  });

  it("keeps attention signals separate from lifecycle safety", () => {
    expect(
      planApplicationLaneLifecycle(
        snapshot({ signal: "possible-completion", discard: "allowed" }),
        request("reclaimable"),
        ALL_CAPABILITIES,
      ),
    ).toMatchObject({ action: "discard", reason: "discard-eligible" });
  });
});

describe("application lane observation ladder", () => {
  it("returns the signal without forcing a page read", () => {
    expect(
      planApplicationLaneObservation(
        snapshot({ signal: "changed" }),
        { requested: "signal", allowStaleBoundedView: false },
        { boundedView: "unavailable", canScreenshot: false, canActivate: false },
      ),
    ).toMatchObject({ action: "signal", reason: "signal-sufficient" });
  });

  it("uses a fresh bounded view before pixels", () => {
    expect(
      planApplicationLaneObservation(
        snapshot(),
        { requested: "bounded-view", allowStaleBoundedView: false },
        { boundedView: "fresh", canScreenshot: true, canActivate: true },
      ),
    ).toMatchObject({ action: "bounded-view", reason: "fresh-bounded-view" });
  });

  it("admits stale bounded state only when the consumer explicitly allows it", () => {
    expect(
      planApplicationLaneObservation(
        snapshot(),
        { requested: "bounded-view", allowStaleBoundedView: true },
        { boundedView: "stale", canScreenshot: true, canActivate: true },
      ),
    ).toMatchObject({
      action: "bounded-view",
      reason: "stale-bounded-view-admitted",
    });
    expect(
      planApplicationLaneObservation(
        snapshot(),
        { requested: "bounded-view", allowStaleBoundedView: false },
        { boundedView: "stale", canScreenshot: true, canActivate: true },
      ),
    ).toMatchObject({ action: "screenshot", reason: "screenshot-required" });
  });

  it("escalates from unavailable semantic state to screenshot and then activation", () => {
    expect(
      planApplicationLaneObservation(
        snapshot(),
        { requested: "bounded-view", allowStaleBoundedView: false },
        { boundedView: "unavailable", canScreenshot: true, canActivate: true },
      ),
    ).toMatchObject({ action: "screenshot", reason: "screenshot-required" });
    expect(
      planApplicationLaneObservation(
        snapshot({ residency: "discarded", recovery: "recoverable" }),
        { requested: "screenshot", allowStaleBoundedView: false },
        { boundedView: "unavailable", canScreenshot: true, canActivate: true },
      ),
    ).toMatchObject({ action: "activation", reason: "activation-required" });
  });

  it("surfaces recovery-needed state before higher-cost observation", () => {
    expect(
      planApplicationLaneObservation(
        snapshot({ recovery: "attention-required" }),
        { requested: "bounded-view", allowStaleBoundedView: false },
        { boundedView: "fresh", canScreenshot: true, canActivate: true },
      ),
    ).toMatchObject({ action: "attention-required", reason: "recovery-required" });
  });
});
