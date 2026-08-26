// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type { ApplicationLaneDescriptorV1 } from "../src/application-lane.js";
import { ApplicationLaneInteractionLedger } from "../src/application-lane-interaction.js";

function descriptor(): ApplicationLaneDescriptorV1 {
  return Object.freeze({
    version: 1,
    laneRef: "lane:clock",
    generation: 1,
    adapter: Object.freeze({ id: "test-adapter", version: "1.0.0" }),
    capabilities: Object.freeze([]),
    state: "active",
    observedAt: "2026-08-27T00:00:00.000Z",
  });
}

function request() {
  return {
    version: 1 as const,
    laneRef: "lane:clock",
    laneGeneration: 1,
    leaseRef: "lease:agent:clock",
    owner: "agent" as const,
    ttlMs: 100,
  };
}

describe("application lane interaction clock monotonicity", () => {
  it("refuses a renewal whose current time precedes the original issue time without mutating the lease", () => {
    const ledger = new ApplicationLaneInteractionLedger({ maxLeaseTtlMs: 1_000 });
    const first = ledger.acquire(descriptor(), request(), 1_000);
    expect(first.lease).toMatchObject({ issuedAtMs: 1_000, expiresAtMs: 1_100 });

    expect(() => ledger.acquire(descriptor(), request(), 900)).toThrow(
      "Lease renewal time precedes the original lease issue time",
    );

    const current = ledger.inspect(descriptor(), 1_000);
    expect(current).toMatchObject({
      status: "observed",
      reason: "lease_current",
      lease: { issuedAtMs: 1_000, expiresAtMs: 1_100 },
    });
  });
});
