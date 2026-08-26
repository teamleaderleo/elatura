// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type { ApplicationLaneDescriptorV1 } from "../src/application-lane.js";
import {
  ApplicationLaneInteractionLedger,
  parseApplicationLaneInteractionLeaseV1,
  parseApplicationLaneInteractionRequestV1,
} from "../src/application-lane-interaction.js";

const NOW = 1_000_000;

function descriptor(laneRef = "lane:test", generation = 1): ApplicationLaneDescriptorV1 {
  return Object.freeze({
    version: 1,
    laneRef,
    generation,
    adapter: Object.freeze({ id: "test-adapter", version: "1.0.0" }),
    capabilities: Object.freeze([]),
    state: "active",
    observedAt: "2026-08-27T00:00:00.000Z",
  });
}

function request(
  overrides: Partial<{
    version: 1;
    laneRef: string;
    laneGeneration: number;
    leaseRef: string;
    owner: "human" | "agent";
    ttlMs: number;
  }> = {},
) {
  return {
    version: 1 as const,
    laneRef: "lane:test",
    laneGeneration: 1,
    leaseRef: "lease:agent:1",
    owner: "agent" as const,
    ttlMs: 5_000,
    ...overrides,
  };
}

describe("application lane interaction parsing", () => {
  it("parses a strict acquisition request", () => {
    expect(parseApplicationLaneInteractionRequestV1(request())).toEqual(request());
  });

  it("contains hostile proxy inspection failures behind fixed errors", () => {
    const traps = [
      new Proxy(request(), {
        getPrototypeOf() {
          throw new Error("PRIVATE getPrototypeOf trap");
        },
      }),
      new Proxy(request(), {
        ownKeys() {
          throw new Error("PRIVATE ownKeys trap");
        },
      }),
      new Proxy(request(), {
        getOwnPropertyDescriptor() {
          throw new Error("PRIVATE getOwnPropertyDescriptor trap");
        },
      }),
    ];

    for (const value of traps) {
      let message = "";
      try {
        parseApplicationLaneInteractionRequestV1(value);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("inspection failed");
      expect(message).not.toContain("PRIVATE");
    }
  });

  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const value = { ...request() } as Record<string, unknown>;
    Object.defineProperty(value, "leaseRef", {
      enumerable: true,
      get() {
        invoked = true;
        return "lease:secret";
      },
    });

    expect(() => parseApplicationLaneInteractionRequestV1(value)).toThrow("enumerable data properties");
    expect(invoked).toBe(false);
  });

  it("pins zero work and dispatch authority on lease admission", () => {
    const lease = {
      version: 1,
      laneRef: "lane:test",
      laneGeneration: 1,
      leaseRef: "lease:agent:1",
      owner: "agent",
      issuedAtMs: NOW,
      expiresAtMs: NOW + 1_000,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    };
    expect(parseApplicationLaneInteractionLeaseV1(lease)).toEqual(lease);
    expect(() => parseApplicationLaneInteractionLeaseV1({ ...lease, grantsWorkAuthority: true })).toThrow(
      "zero work authority",
    );
    expect(() => parseApplicationLaneInteractionLeaseV1({ ...lease, authorizesWorkDispatch: true })).toThrow(
      "zero work dispatch",
    );
  });

  it("contains hostile ledger-option inspection failures", () => {
    const options = new Proxy(
      { maxActiveLeases: 1 },
      {
        ownKeys() {
          throw new Error("PRIVATE options trap");
        },
      },
    );
    let message = "";
    try {
      new ApplicationLaneInteractionLedger(options);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("inspection failed");
    expect(message).not.toContain("PRIVATE");
  });
});

describe("generation-bound interaction leases", () => {
  it("acquires and idempotently renews one agent lease with zero authority", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    const first = ledger.acquire(descriptor(), request(), NOW);
    expect(first).toMatchObject({
      status: "acquired",
      reason: "lease_acquired",
      laneRef: "lane:test",
      laneGeneration: 1,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(first.lease).toMatchObject({
      leaseRef: "lease:agent:1",
      owner: "agent",
      issuedAtMs: NOW,
      expiresAtMs: NOW + 5_000,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });

    const renewed = ledger.acquire(descriptor(), request(), NOW + 1_000);
    expect(renewed).toMatchObject({ status: "acquired", reason: "lease_renewed" });
    expect(renewed.lease).toMatchObject({ issuedAtMs: NOW, expiresAtMs: NOW + 6_000 });
  });

  it("lets a human acquisition preempt an agent lease", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor(), request(), NOW);

    const result = ledger.acquire(
      descriptor(),
      request({ leaseRef: "lease:human:1", owner: "human" }),
      NOW + 1,
    );
    expect(result).toMatchObject({ status: "preempted", reason: "human_preempted_agent" });
    expect(result.lease).toMatchObject({ owner: "human", leaseRef: "lease:human:1" });
  });

  it("lets direct human activity revoke an agent lease immediately", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor(), request(), NOW);

    expect(ledger.humanActivity(descriptor(), NOW + 1)).toEqual({
      version: 1,
      status: "preempted",
      reason: "human_activity_preempted_agent",
      laneRef: "lane:test",
      laneGeneration: 1,
      lease: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(ledger.inspect(descriptor(), NOW + 1).reason).toBe("no_lease");
  });

  it("refuses an agent while a human lease is current", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor(), request({ leaseRef: "lease:human:1", owner: "human" }), NOW);

    expect(ledger.acquire(descriptor(), request(), NOW + 1)).toMatchObject({
      status: "denied",
      reason: "human_holds_lease",
      lease: { owner: "human" },
    });
  });

  it("refuses same-owner replacement under a different lease ref", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor(), request(), NOW);

    expect(ledger.acquire(descriptor(), request({ leaseRef: "lease:agent:2" }), NOW + 1)).toMatchObject({
      status: "denied",
      reason: "lease_conflict",
      lease: { leaseRef: "lease:agent:1" },
    });
  });

  it("advances to a newer lane generation and cannot be rolled back by stale descriptors", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor("lane:test", 1), request(), NOW);

    const newer = ledger.acquire(
      descriptor("lane:test", 2),
      request({ laneGeneration: 2, leaseRef: "lease:agent:2" }),
      NOW + 1,
    );
    expect(newer).toMatchObject({ status: "acquired", laneGeneration: 2, lease: { leaseRef: "lease:agent:2" } });

    const stale = ledger.inspect(descriptor("lane:test", 1), NOW + 2);
    expect(stale).toMatchObject({ status: "denied", reason: "stale_generation", laneGeneration: 1, lease: null });

    const current = ledger.inspect(descriptor("lane:test", 2), NOW + 2);
    expect(current).toMatchObject({ status: "observed", reason: "lease_current", lease: { leaseRef: "lease:agent:2" } });
  });

  it("invalidates an old-generation lease when current human activity first reveals a newer generation", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor("lane:test", 1), request(), NOW);

    expect(ledger.humanActivity(descriptor("lane:test", 2), NOW + 1)).toMatchObject({
      status: "observed",
      reason: "no_lease",
      laneGeneration: 2,
    });
    expect(ledger.activeLeaseCount).toBe(0);
  });

  it("refuses request identity mismatches before tracking or mutating lane state", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    expect(ledger.acquire(descriptor(), request({ laneRef: "lane:other" }), NOW)).toMatchObject({
      status: "denied",
      reason: "lane_mismatch",
    });
    expect(ledger.trackedLaneCount).toBe(0);
    expect(ledger.activeLeaseCount).toBe(0);

    expect(ledger.acquire(descriptor(), request({ laneGeneration: 2 }), NOW)).toMatchObject({
      status: "denied",
      reason: "generation_mismatch",
    });
    expect(ledger.trackedLaneCount).toBe(0);
  });

  it("keeps malformed acquisition requests mutation-free, including expiry cleanup", () => {
    const ledger = new ApplicationLaneInteractionLedger({ maxLeaseTtlMs: 100 });
    ledger.acquire(descriptor(), request({ ttlMs: 10 }), NOW);
    expect(ledger.activeLeaseCount).toBe(1);

    const malformed = { ...request({ ttlMs: 10 }) };
    delete (malformed as Partial<typeof malformed>).leaseRef;
    expect(() => ledger.acquire(descriptor(), malformed, NOW + 100)).toThrow("missing required fields");
    expect(ledger.activeLeaseCount).toBe(1);

    expect(ledger.inspect(descriptor(), NOW + 100).reason).toBe("no_lease");
    expect(ledger.activeLeaseCount).toBe(0);
  });

  it("requires the current lease ref for explicit revocation", () => {
    const ledger = new ApplicationLaneInteractionLedger();
    ledger.acquire(descriptor(), request(), NOW);

    expect(ledger.revoke(descriptor(), "lease:agent:2", NOW + 1)).toMatchObject({
      status: "denied",
      reason: "lease_ref_mismatch",
    });
    expect(ledger.revoke(descriptor(), "lease:agent:1", NOW + 2)).toMatchObject({
      status: "revoked",
      reason: "lease_revoked",
      lease: null,
    });
  });

  it("keeps lease-capacity denials out of the anti-replay generation table", () => {
    const ledger = new ApplicationLaneInteractionLedger({ maxActiveLeases: 1, maxTrackedLanes: 4 });
    ledger.acquire(descriptor("lane:one"), request({ laneRef: "lane:one" }), NOW);

    for (const [laneRef, leaseRef] of [
      ["lane:two", "lease:agent:2"],
      ["lane:three", "lease:agent:3"],
      ["lane:four", "lease:agent:4"],
    ] as const) {
      expect(
        ledger.acquire(descriptor(laneRef), request({ laneRef, leaseRef }), NOW),
      ).toMatchObject({ status: "denied", reason: "lease_capacity" });
      expect(ledger.activeLeaseCount).toBe(1);
      expect(ledger.trackedLaneCount).toBe(1);
    }
  });

  it("tracks a newly admitted lane only after valid expiry cleanup frees lease capacity", () => {
    const ledger = new ApplicationLaneInteractionLedger({
      maxActiveLeases: 1,
      maxTrackedLanes: 2,
      maxLeaseTtlMs: 100,
    });
    ledger.acquire(descriptor("lane:one"), request({ laneRef: "lane:one", ttlMs: 10 }), NOW);

    expect(
      ledger.acquire(
        descriptor("lane:two"),
        request({ laneRef: "lane:two", leaseRef: "lease:agent:2", ttlMs: 10 }),
        NOW + 1,
      ),
    ).toMatchObject({ status: "denied", reason: "lease_capacity" });
    expect(ledger.trackedLaneCount).toBe(1);

    expect(
      ledger.acquire(
        descriptor("lane:two"),
        request({ laneRef: "lane:two", leaseRef: "lease:agent:2", ttlMs: 10 }),
        NOW + 10,
      ),
    ).toMatchObject({ status: "acquired", reason: "lease_acquired" });
    expect(ledger.activeLeaseCount).toBe(1);
    expect(ledger.trackedLaneCount).toBe(2);
  });

  it("enforces tracked-lane capacity independently of active lease capacity", () => {
    const ledger = new ApplicationLaneInteractionLedger({ maxActiveLeases: 1, maxTrackedLanes: 1 });
    ledger.acquire(descriptor("lane:one"), request({ laneRef: "lane:one" }), NOW);
    ledger.revoke(descriptor("lane:one"), "lease:agent:1", NOW + 1);

    expect(
      ledger.acquire(
        descriptor("lane:two"),
        request({ laneRef: "lane:two", leaseRef: "lease:agent:2" }),
        NOW + 2,
      ),
    ).toMatchObject({ status: "denied", reason: "lane_capacity" });
    expect(ledger.activeLeaseCount).toBe(0);
    expect(ledger.trackedLaneCount).toBe(1);
  });

  it("clears anti-replay generation memory only at an explicit session reset", () => {
    const ledger = new ApplicationLaneInteractionLedger({ maxActiveLeases: 1, maxTrackedLanes: 1 });
    ledger.acquire(descriptor("lane:one", 2), request({ laneRef: "lane:one", laneGeneration: 2 }), NOW);
    ledger.revoke(descriptor("lane:one", 2), "lease:agent:1", NOW + 1);

    expect(ledger.inspect(descriptor("lane:one", 1), NOW + 2)).toMatchObject({
      status: "denied",
      reason: "stale_generation",
    });

    ledger.resetSession();
    expect(ledger.activeLeaseCount).toBe(0);
    expect(ledger.trackedLaneCount).toBe(0);

    expect(
      ledger.acquire(
        descriptor("lane:two"),
        request({ laneRef: "lane:two", leaseRef: "lease:agent:2" }),
        NOW + 3,
      ),
    ).toMatchObject({ status: "acquired", reason: "lease_acquired" });
  });

  it("rejects TTL beyond configured bounds before ledger mutation", () => {
    const ledger = new ApplicationLaneInteractionLedger({ maxLeaseTtlMs: 100 });
    expect(() => ledger.acquire(descriptor(), request({ ttlMs: 101 }), NOW)).toThrow("configured interaction limit");
    expect(ledger.trackedLaneCount).toBe(0);
    expect(ledger.activeLeaseCount).toBe(0);
  });
});
