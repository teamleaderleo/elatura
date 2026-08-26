// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  LaneLeaseLedger,
  evaluateLane,
  parseLaneLifecycle,
  parseLaneSignals,
  type LaneLifecycle,
  type LaneSignals,
} from "../src/lane-governor.js";

const NOW = 1_000_000;

function lifecycle(overrides: Partial<LaneLifecycle> = {}): LaneLifecycle {
  return {
    laneId: "lane-1",
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    lastAccessedMs: NOW - 600_000,
    ...overrides,
  };
}

function signals(overrides: Partial<LaneSignals> = {}): LaneSignals {
  return {
    generating: false,
    unsaved: false,
    needsAttention: false,
    safeToDiscard: "yes",
    ...overrides,
  };
}

describe("lane governor parsing", () => {
  it("rejects unknown fields and accessors without invoking them", () => {
    expect(() => parseLaneSignals({ ...signals(), extra: true })).toThrow("unexpected or missing fields");

    let invoked = false;
    const input = { ...lifecycle() } as Record<string, unknown>;
    Object.defineProperty(input, "laneId", {
      enumerable: true,
      get() {
        invoked = true;
        return "lane-secret";
      },
    });

    expect(() => parseLaneLifecycle(input)).toThrow("Expected own data property: laneId");
    expect(invoked).toBe(false);
  });

  it("rejects malformed tokens and non-finite timestamps", () => {
    expect(() => parseLaneLifecycle(lifecycle({ laneId: "lane with spaces" }))).toThrow("bounded token");
    expect(() => parseLaneLifecycle(lifecycle({ lastAccessedMs: Number.NaN }))).toThrow("bounded safe integer");
  });
});

describe("lane governor decisions", () => {
  it("uses native discard candidacy only for idle lanes with explicit safety", () => {
    expect(evaluateLane(lifecycle(), signals(), NOW)).toEqual({
      action: "discard-candidate",
      reason: "idle-and-safe",
      idleMs: 600_000,
    });
  });

  it("keeps recently accessed safe lanes resident", () => {
    expect(
      evaluateLane(lifecycle({ lastAccessedMs: NOW - 10_000 }), signals(), NOW, { minIdleMs: 60_000 }),
    ).toMatchObject({ action: "keep-resident", reason: "recently-accessed", idleMs: 10_000 });
  });

  it("keeps the active lane resident", () => {
    expect(evaluateLane(lifecycle({ active: true }), signals(), NOW)).toMatchObject({
      action: "keep-resident",
      reason: "active-lane",
    });
  });

  it("protects pinned, audible, generating, and unsaved lanes", () => {
    expect(evaluateLane(lifecycle({ pinned: true }), signals(), NOW).reason).toBe("pinned-lane");
    expect(evaluateLane(lifecycle({ audible: true }), signals(), NOW).reason).toBe("audible-lane");
    expect(evaluateLane(lifecycle(), signals({ generating: true }), NOW).reason).toBe("generation-active");
    expect(evaluateLane(lifecycle(), signals({ unsaved: true }), NOW).reason).toBe("unsaved-state");
  });

  it("lets protected signals override an explicit safe-to-discard hint", () => {
    expect(evaluateLane(lifecycle(), signals({ generating: true, safeToDiscard: "yes" }), NOW)).toMatchObject({
      action: "protect-from-discard",
      reason: "generation-active",
    });
    expect(evaluateLane(lifecycle(), signals({ unsaved: true, safeToDiscard: "yes" }), NOW)).toMatchObject({
      action: "protect-from-discard",
      reason: "unsaved-state",
    });
  });

  it("treats unknown safety conservatively even when Chromium reports the tab frozen", () => {
    expect(
      evaluateLane(lifecycle({ frozen: true }), signals({ generating: null, unsaved: null, safeToDiscard: "unknown" }), NOW),
    ).toMatchObject({ action: "protect-from-discard", reason: "unknown-discard-safety" });
  });

  it("respects browser discard protection", () => {
    expect(evaluateLane(lifecycle({ autoDiscardable: false }), signals(), NOW)).toMatchObject({
      action: "protect-from-discard",
      reason: "browser-discard-protected",
    });
  });

  it("wakes a discarded lane when attention or protected application state appears", () => {
    expect(evaluateLane(lifecycle({ discarded: true }), signals({ needsAttention: true }), NOW)).toMatchObject({
      action: "wake-candidate",
      reason: "discarded-needs-attention",
    });
    expect(evaluateLane(lifecycle({ discarded: true }), signals({ unsaved: true }), NOW)).toMatchObject({
      action: "wake-candidate",
      reason: "discarded-protected-signal",
    });
  });

  it("observes an already discarded lane when no wake signal exists", () => {
    expect(evaluateLane(lifecycle({ discarded: true }), signals({ safeToDiscard: "unknown" }), NOW)).toMatchObject({
      action: "observe-only",
      reason: "already-discarded",
    });
  });

  it("keeps an attention-bearing resident lane warm", () => {
    expect(evaluateLane(lifecycle(), signals({ needsAttention: true }), NOW)).toMatchObject({
      action: "keep-resident",
      reason: "attention-required",
    });
  });

  it("protects against a future last-access timestamp", () => {
    expect(evaluateLane(lifecycle({ lastAccessedMs: NOW + 1 }), signals(), NOW)).toEqual({
      action: "protect-from-discard",
      reason: "future-last-access",
      idleMs: null,
    });
  });
});

describe("human and agent lane leases", () => {
  it("acquires and renews one agent lease deterministically", () => {
    const leases = new LaneLeaseLedger({ maxActiveLeases: 2, maxLeaseTtlMs: 10_000 });
    const request = { laneId: "lane-1", leaseId: "agent-1", owner: "agent" as const, ttlMs: 5_000 };

    const first = leases.acquire(request, NOW);
    expect(first).toMatchObject({ status: "acquired", reason: "lease-acquired" });
    expect(first.lease).toMatchObject({ issuedAtMs: NOW, expiresAtMs: NOW + 5_000 });

    const renewed = leases.acquire(request, NOW + 1_000);
    expect(renewed).toMatchObject({ status: "acquired", reason: "lease-renewed" });
    expect(renewed.lease).toMatchObject({ issuedAtMs: NOW, expiresAtMs: NOW + 6_000 });
    expect(Object.isFrozen(renewed.lease)).toBe(true);
  });

  it("lets a human lease preempt an agent lease immediately", () => {
    const leases = new LaneLeaseLedger();
    leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 5_000 }, NOW);

    const result = leases.acquire({ laneId: "lane-1", leaseId: "human-1", owner: "human", ttlMs: 5_000 }, NOW + 1);
    expect(result).toMatchObject({ status: "preempted", reason: "human-preempted-agent" });
    expect(result.lease).toMatchObject({ owner: "human", leaseId: "human-1" });
  });

  it("lets direct human activity revoke an agent lease", () => {
    const leases = new LaneLeaseLedger();
    leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 5_000 }, NOW);

    expect(leases.humanActivity("lane-1", NOW + 1)).toEqual({
      status: "preempted",
      reason: "human-activity-preempted-agent",
      lease: null,
    });
    expect(leases.snapshot("lane-1", NOW + 1)).toBeNull();
  });

  it("refuses an agent while a human lease is current", () => {
    const leases = new LaneLeaseLedger();
    leases.acquire({ laneId: "lane-1", leaseId: "human-1", owner: "human", ttlMs: 5_000 }, NOW);

    expect(
      leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 5_000 }, NOW + 1),
    ).toMatchObject({ status: "denied", reason: "human-holds-lease" });
  });

  it("expires old leases before admitting replacements", () => {
    const leases = new LaneLeaseLedger({ maxActiveLeases: 1, maxLeaseTtlMs: 100 });
    leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 10 }, NOW);

    expect(
      leases.acquire({ laneId: "lane-2", leaseId: "agent-2", owner: "agent", ttlMs: 10 }, NOW + 10),
    ).toMatchObject({ status: "acquired", reason: "lease-acquired" });
    expect(leases.size).toBe(1);
  });

  it("enforces the active-lease bound", () => {
    const leases = new LaneLeaseLedger({ maxActiveLeases: 1 });
    leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 5_000 }, NOW);

    expect(
      leases.acquire({ laneId: "lane-2", leaseId: "agent-2", owner: "agent", ttlMs: 5_000 }, NOW + 1),
    ).toEqual({ status: "denied", reason: "lease-capacity", lease: null });
  });

  it("requires the current lease id for scoped revocation", () => {
    const leases = new LaneLeaseLedger();
    leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 5_000 }, NOW);

    expect(leases.revoke("lane-1", "agent-2", NOW + 1)).toMatchObject({
      status: "denied",
      reason: "lease-id-mismatch",
    });
    expect(leases.revoke("lane-1", "agent-1", NOW + 2)).toEqual({
      status: "revoked",
      reason: "lease-revoked",
      lease: null,
    });
  });

  it("rejects overlong lease duration before state changes", () => {
    const leases = new LaneLeaseLedger({ maxLeaseTtlMs: 100 });
    expect(() =>
      leases.acquire({ laneId: "lane-1", leaseId: "agent-1", owner: "agent", ttlMs: 101 }, NOW),
    ).toThrow("bounded safe integer");
    expect(leases.size).toBe(0);
  });
});
