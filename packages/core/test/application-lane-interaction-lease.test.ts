// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type { ApplicationLaneDescriptorV1 } from "../src/application-lane.js";
import {
  APPLICATION_LANE_INTERACTION_LEASE_VERSION,
  ApplicationLaneInteractionLeaseLedger,
  createApplicationLaneInteractionTargetV1,
  parseApplicationLaneInteractionLeaseRequestV1,
  parseApplicationLaneInteractionLeaseV1,
  parseApplicationLaneInteractionTargetV1,
  type ApplicationLaneInteractionLeaseOwner,
  type ApplicationLaneInteractionLeaseRequestV1,
  type ApplicationLaneInteractionTargetV1,
} from "../src/application-lane-interaction-lease.js";

function target(
  laneRef = "lane:alpha",
  laneGeneration = 1,
): ApplicationLaneInteractionTargetV1 {
  return {
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef,
    laneGeneration,
  };
}

function request(
  overrides: Partial<ApplicationLaneInteractionLeaseRequestV1> = {},
): ApplicationLaneInteractionLeaseRequestV1 {
  return {
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef: "lane:alpha",
    laneGeneration: 1,
    leaseRef: "lease:alpha",
    owner: "agent",
    ttlMs: 100,
    ...overrides,
  };
}

function descriptor(
  laneRef = "lane:alpha",
  generation = 1,
): ApplicationLaneDescriptorV1 {
  return {
    version: 1,
    laneRef,
    generation,
    adapter: { id: "synthetic", version: "1" },
    capabilities: ["events"],
    state: "active",
    observedAt: "2026-08-26T00:00:00.000Z",
  };
}

function acquire(
  ledger: ApplicationLaneInteractionLeaseLedger,
  owner: ApplicationLaneInteractionLeaseOwner = "agent",
  nowMs = 10,
) {
  return ledger.acquire(target(), request({ owner }), nowMs);
}

function expectPrivateDetailContained(operation: () => unknown): void {
  expect(operation).toThrow(TypeError);
  try {
    operation();
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE_TRAP_DETAIL");
  }
}

describe("application lane interaction lease parsing", () => {
  it("derives an exact target from the canonical lane descriptor without carrying browser state", () => {
    expect(createApplicationLaneInteractionTargetV1(descriptor("lane:docs", 7))).toEqual({
      version: 1,
      laneRef: "lane:docs",
      laneGeneration: 7,
    });
  });

  it("contains hostile Proxy traps behind fixed parser failures", () => {
    const targetParsers: Array<() => unknown> = [
      () =>
        parseApplicationLaneInteractionTargetV1(
          new Proxy(target(), {
            getPrototypeOf() {
              throw new Error("PRIVATE_TRAP_DETAIL getPrototypeOf");
            },
          }),
        ),
      () =>
        parseApplicationLaneInteractionTargetV1(
          new Proxy(target(), {
            ownKeys() {
              throw new Error("PRIVATE_TRAP_DETAIL ownKeys");
            },
          }),
        ),
      () =>
        parseApplicationLaneInteractionTargetV1(
          new Proxy(target(), {
            getOwnPropertyDescriptor() {
              throw new Error("PRIVATE_TRAP_DETAIL descriptor");
            },
          }),
        ),
    ];
    for (const probe of targetParsers) expectPrivateDetailContained(probe);

    expectPrivateDetailContained(() =>
      parseApplicationLaneInteractionLeaseRequestV1(
        new Proxy(request(), {
          ownKeys() {
            throw new Error("PRIVATE_TRAP_DETAIL request");
          },
        }),
      ),
    );
  });

  it("never invokes accessors while parsing public records", () => {
    let invoked = 0;
    const candidate = {
      version: 1,
      laneRef: "lane:alpha",
      laneGeneration: 1,
      leaseRef: "lease:alpha",
      owner: "agent",
      get ttlMs() {
        invoked += 1;
        return 100;
      },
    };
    expect(() => parseApplicationLaneInteractionLeaseRequestV1(candidate)).toThrow(TypeError);
    expect(invoked).toBe(0);
  });

  it("contains hostile descriptor extraction from canonical-lane inputs", () => {
    const hostile = new Proxy(descriptor(), {
      getOwnPropertyDescriptor() {
        throw new Error("PRIVATE_TRAP_DETAIL descriptor-source");
      },
    });
    expectPrivateDetailContained(() =>
      createApplicationLaneInteractionTargetV1(hostile as ApplicationLaneDescriptorV1),
    );
  });

  it("pins zero work and dispatch authority on every admitted lease", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    const result = acquire(ledger);
    expect(result).toMatchObject({
      status: "acquired",
      reason: "lease-acquired",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
      lease: {
        grantsWorkAuthority: false,
        authorizesWorkDispatch: false,
      },
    });
    const serialized = { ...result.lease!, grantsWorkAuthority: true };
    expect(() => parseApplicationLaneInteractionLeaseV1(serialized)).toThrow(
      "Application lane interaction leases must grant zero work authority",
    );
  });

  it("contains hostile ledger-option inspection", () => {
    expectPrivateDetailContained(
      () =>
        new ApplicationLaneInteractionLeaseLedger(
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error("PRIVATE_TRAP_DETAIL options");
              },
            },
          ),
        ),
    );
  });
});

describe("generation-bound interaction ownership", () => {
  it("clears an old-generation lease when the current canonical generation advances", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger).status).toBe("acquired");
    expect(ledger.size).toBe(1);

    expect(ledger.read(target("lane:alpha", 2), 20)).toEqual({
      version: 1,
      status: "observed",
      reason: "generation-advanced",
      lease: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(ledger.size).toBe(0);

    const next = ledger.acquire(
      target("lane:alpha", 2),
      request({ laneGeneration: 2, leaseRef: "lease:next" }),
      21,
    );
    expect(next).toMatchObject({
      status: "acquired",
      reason: "lease-acquired",
      lease: { laneGeneration: 2, issuedAtMs: 21 },
    });
  });

  it("refuses stale generations before they can renew or revoke a newer lease", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    ledger.acquire(
      target("lane:alpha", 2),
      request({ laneGeneration: 2, leaseRef: "lease:new" }),
      10,
    );

    expect(
      ledger.renew(
        target("lane:alpha", 1),
        request({ laneGeneration: 1, leaseRef: "lease:new" }),
        20,
      ),
    ).toMatchObject({ status: "denied", reason: "stale-generation", lease: null });
    expect(
      ledger.revoke(
        target("lane:alpha", 1),
        { version: 1, laneRef: "lane:alpha", laneGeneration: 1, leaseRef: "lease:new" },
        20,
      ),
    ).toMatchObject({ status: "denied", reason: "stale-generation", lease: null });

    expect(ledger.read(target("lane:alpha", 2), 20)).toMatchObject({
      status: "observed",
      reason: "lease-active",
      lease: { leaseRef: "lease:new", laneGeneration: 2 },
    });
  });

  it("refuses request lane/generation mismatch with zero lease mutation", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger).status).toBe("acquired");

    expect(
      ledger.acquire(
        target("lane:beta", 1),
        request({ laneRef: "lane:alpha" }),
        1_000,
      ),
    ).toMatchObject({ status: "denied", reason: "lane-mismatch" });
    expect(ledger.size).toBe(1);

    expect(
      ledger.acquire(
        target("lane:alpha", 1),
        request({ laneGeneration: 2 }),
        1_000,
      ),
    ).toMatchObject({ status: "denied", reason: "future-generation" });
    expect(ledger.size).toBe(1);
  });
});

describe("human and agent lease semantics", () => {
  it("requires explicit renew instead of overloading acquire", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger).status).toBe("acquired");
    expect(ledger.acquire(target(), request(), 20)).toMatchObject({
      status: "denied",
      reason: "renew-required",
    });

    const renewed = ledger.renew(target(), request({ ttlMs: 200 }), 20);
    expect(renewed).toMatchObject({
      status: "renewed",
      reason: "lease-renewed",
      lease: { issuedAtMs: 10, expiresAtMs: 220 },
    });
  });

  it("lets a human acquisition preempt an agent immediately", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger, "agent").status).toBe("acquired");

    const human = ledger.acquire(
      target(),
      request({ owner: "human", leaseRef: "lease:human" }),
      20,
    );
    expect(human).toMatchObject({
      status: "preempted",
      reason: "human-preempted-agent",
      lease: { owner: "human", leaseRef: "lease:human" },
    });
  });

  it("prevents an agent from replacing a current human lease", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger, "human").status).toBe("acquired");

    expect(
      ledger.acquire(
        target(),
        request({ owner: "agent", leaseRef: "lease:other" }),
        20,
      ),
    ).toMatchObject({
      status: "denied",
      reason: "human-holds-lease",
      lease: { owner: "human" },
    });
  });

  it("treats direct human activity as immediate agent-lease revocation", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger, "agent").status).toBe("acquired");
    expect(ledger.humanActivity(target(), 20)).toEqual({
      version: 1,
      status: "preempted",
      reason: "human-activity-preempted-agent",
      lease: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(ledger.size).toBe(0);
  });

  it("retains a human lease on direct human activity", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger, "human").status).toBe("acquired");
    expect(ledger.humanActivity(target(), 20)).toMatchObject({
      status: "observed",
      reason: "human-lease-retained",
      lease: { owner: "human" },
    });
  });

  it("requires exact lease identity and owner for renewal", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger).status).toBe("acquired");
    expect(
      ledger.renew(target(), request({ leaseRef: "lease:wrong" }), 20),
    ).toMatchObject({ status: "denied", reason: "lease-id-mismatch" });
    expect(
      ledger.renew(target(), request({ owner: "human" }), 20),
    ).toMatchObject({ status: "denied", reason: "owner-mismatch" });
  });

  it("revokes only the exact current-generation lease reference", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger).status).toBe("acquired");
    expect(
      ledger.revoke(
        target(),
        { version: 1, laneRef: "lane:alpha", laneGeneration: 1, leaseRef: "lease:wrong" },
        20,
      ),
    ).toMatchObject({ status: "denied", reason: "lease-id-mismatch" });
    expect(ledger.size).toBe(1);
    expect(
      ledger.revoke(
        target(),
        { version: 1, laneRef: "lane:alpha", laneGeneration: 1, leaseRef: "lease:alpha" },
        20,
      ),
    ).toEqual({
      version: 1,
      status: "revoked",
      reason: "lease-revoked",
      lease: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(ledger.size).toBe(0);
  });
});

describe("bounded lease lifetime and mutation ordering", () => {
  it("expires leases deterministically", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    ledger.acquire(target(), request({ ttlMs: 5 }), 10);
    expect(ledger.read(target(), 14)).toMatchObject({ reason: "lease-active" });
    expect(ledger.read(target(), 15)).toEqual({
      version: 1,
      status: "observed",
      reason: "lease-expired",
      lease: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(ledger.size).toBe(0);
  });

  it("prunes expired leases only after a valid acquire request has parsed and matched", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger({ maxActiveLeases: 1 });
    ledger.acquire(target("lane:alpha"), request({ ttlMs: 1 }), 0);
    expect(ledger.size).toBe(1);

    const malformed = new Proxy(request({ laneRef: "lane:beta" }), {
      ownKeys() {
        throw new Error("PRIVATE_TRAP_DETAIL should-not-cleanup");
      },
    });
    expectPrivateDetailContained(() =>
      ledger.acquire(target("lane:beta"), malformed, 100),
    );
    expect(ledger.size).toBe(1);

    expect(
      ledger.acquire(
        target("lane:beta"),
        request({ laneRef: "lane:alpha", ttlMs: 10 }),
        100,
      ),
    ).toMatchObject({ status: "denied", reason: "lane-mismatch" });
    expect(ledger.size).toBe(1);

    expect(
      ledger.acquire(
        target("lane:beta"),
        request({ laneRef: "lane:beta", leaseRef: "lease:beta", ttlMs: 10 }),
        100,
      ),
    ).toMatchObject({ status: "acquired", reason: "lease-acquired" });
    expect(ledger.size).toBe(1);
  });

  it("enforces configured capacity and TTL ceilings", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger({
      maxActiveLeases: 1,
      maxLeaseTtlMs: 50,
    });
    expect(() =>
      ledger.acquire(target(), request({ ttlMs: 51 }), 0),
    ).toThrow("Interaction lease TTL must be a positive safe integer at most 50");
    expect(ledger.size).toBe(0);

    expect(ledger.acquire(target(), request({ ttlMs: 50 }), 0).status).toBe("acquired");
    expect(
      ledger.acquire(
        target("lane:beta"),
        request({ laneRef: "lane:beta", leaseRef: "lease:beta", ttlMs: 50 }),
        1,
      ),
    ).toMatchObject({ status: "denied", reason: "lease-capacity" });
  });

  it("clear removes all volatile interaction ownership", () => {
    const ledger = new ApplicationLaneInteractionLeaseLedger();
    expect(acquire(ledger).status).toBe("acquired");
    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(ledger.read(target(), 20)).toMatchObject({
      status: "observed",
      reason: "no-lease",
    });
  });
});
