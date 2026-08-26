// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { ApplicationLaneRuntimeV1 } from "../src/application-lane-runtime.js";

function descriptor(generation = 7, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    laneRef: "elatura:lane:chat-a",
    generation,
    adapter: { id: "chatgpt", version: "1" },
    capabilities: ["events", "observe", "activate", "screenshot"],
    state: "active",
    observedAt: `2026-08-26T17:${String(generation).padStart(2, "0")}:00.000Z`,
    ...structuredClone(overrides),
  };
}

function event(
  generation = 7,
  eventId = "elatura:event:chat-a:1",
  observedAt = "2026-08-26T17:08:00.000Z",
) {
  return {
    version: 1,
    eventId,
    laneRef: "elatura:lane:chat-a",
    laneGeneration: generation,
    eventType: "changed",
    observedAt,
    confidence: "exact",
    freshness: "fresh",
    sourceRefs: ["elatura:signal:1"],
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  };
}

function request(
  generation = 7,
  requestId = "request:observe:1",
  operation: "status" | "observe" | "activate" | "screenshot" = "observe",
) {
  return {
    version: 1,
    requestId,
    laneRef: "elatura:lane:chat-a",
    laneGeneration: generation,
    operation,
    payload:
      operation === "observe"
        ? { maxItems: 8, maxTextCodeUnits: 4_096, maxSerializedBytes: 8_192 }
        : {},
  };
}

function closedResponse(
  generation = 7,
  requestId = "request:observe:1",
  operation: "status" | "observe" | "activate" | "screenshot" = "observe",
) {
  return {
    version: 1,
    requestId,
    laneRef: "elatura:lane:chat-a",
    laneGeneration: generation,
    operation,
    outcome: "unsupported",
    state: "active",
    observedAt: "2026-08-26T17:09:00.000Z",
    payload: null,
    sourceRefs: [],
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  };
}

function statusResponse(
  generation = 7,
  requestId = "request:status:1",
  state: "active" | "parked" | "unavailable" | "drifted" | "recovery_needed" = "parked",
  observedAt = "2026-08-26T17:10:00.000Z",
) {
  return {
    version: 1,
    requestId,
    laneRef: "elatura:lane:chat-a",
    laneGeneration: generation,
    operation: "status",
    outcome: "ok",
    state,
    observedAt,
    payload: descriptor(generation, { state, observedAt }),
    sourceRefs: [],
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  };
}

function observeSuccessResponse(content: unknown) {
  return {
    version: 1,
    requestId: "request:observe:budget",
    laneRef: "elatura:lane:chat-a",
    laneGeneration: 7,
    operation: "observe",
    outcome: "ok",
    state: "active",
    observedAt: "2026-08-26T17:09:00.000Z",
    payload: {
      observationRef: "elatura:observation:budget",
      freshness: "fresh",
      contentType: "application/json",
      content,
      omitted: true,
      sourceRefs: ["elatura:source:budget"],
    },
    sourceRefs: ["elatura:source:budget"],
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  };
}

describe("application lane runtime generation ownership", () => {
  it("clears old ownership and refuses late old-generation messages", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    expect(runtime.upsertDescriptor(descriptor(7)).outcome).toBe("inserted");
    expect(runtime.beginRequest(request(7)).outcome).toBe("accepted");
    expect(runtime.admitEvent(event(7)).outcome).toBe("accepted");

    expect(runtime.upsertDescriptor(descriptor(8)).outcome).toBe("generation-replaced");
    expect(runtime.acceptResponse(closedResponse(7)).outcome).toBe("stale-generation");
    expect(runtime.admitEvent(event(7, "elatura:event:chat-a:late")).outcome).toBe(
      "stale-generation",
    );

    const snapshot = runtime.snapshot();
    expect(snapshot.usage.pendingRequests).toBe(0);
    expect(snapshot.lanes[0]?.descriptor.generation).toBe(8);
    expect(snapshot.lanes[0]?.lastEvent).toBeNull();
    expect(snapshot.counters).toMatchObject({
      generationReplacements: 1,
      clearedPendingRequests: 1,
      staleEvents: 1,
      staleResponses: 1,
    });
  });

  it("refuses future-generation traffic until the descriptor is current", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(descriptor(7));
    expect(
      runtime.admitEvent(
        event(8, "elatura:event:chat-a:future", "2026-08-26T17:09:00.000Z"),
      ).outcome,
    ).toBe("future-generation");
    expect(runtime.beginRequest(request(8, "request:observe:future")).outcome).toBe(
      "future-generation",
    );

    runtime.upsertDescriptor(descriptor(8));
    expect(
      runtime.admitEvent(
        event(8, "elatura:event:chat-a:future", "2026-08-26T17:09:00.000Z"),
      ).outcome,
    ).toBe("accepted");
  });

  it("keeps a bounded event-id ring and rejects retained duplicates", () => {
    const runtime = new ApplicationLaneRuntimeV1({ maxRecentEventIdsPerLane: 2 });
    runtime.upsertDescriptor(descriptor(7));
    expect(runtime.admitEvent(event(7, "event:1", "2026-08-26T17:08:00.000Z")).outcome).toBe("accepted");
    expect(runtime.admitEvent(event(7, "event:2", "2026-08-26T17:09:00.000Z")).outcome).toBe("accepted");
    expect(runtime.admitEvent(event(7, "event:3", "2026-08-26T17:10:00.000Z")).outcome).toBe("accepted");
    expect(runtime.admitEvent(event(7, "event:2", "2026-08-26T17:11:00.000Z")).outcome).toBe("duplicate-event");
    expect(runtime.snapshot().usage.recentEventIds).toBe(2);
  });

  it("delegates exact reply binding to the application-lane client fence", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(descriptor(7));
    runtime.beginRequest(request(7));

    expect(
      runtime.acceptResponse(closedResponse(7, "request:observe:1", "screenshot")).outcome,
    ).toBe("response-mismatch");
    expect(runtime.snapshot().usage.pendingRequests).toBe(1);

    expect(runtime.acceptResponse(closedResponse(7)).outcome).toBe("accepted");
    expect(runtime.snapshot().usage.pendingRequests).toBe(0);
    expect(runtime.acceptResponse(closedResponse(7)).outcome).toBe("unknown-request");
  });

  it("consumes and counts observations that exceed the caller budget", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(descriptor(7));
    runtime.beginRequest({
      version: 1,
      requestId: "request:observe:budget",
      laneRef: "elatura:lane:chat-a",
      laneGeneration: 7,
      operation: "observe",
      payload: { maxItems: 4, maxTextCodeUnits: 64, maxSerializedBytes: 256 },
    });

    expect(
      runtime.acceptResponse(observeSuccessResponse({ excerpt: "x".repeat(65) })).outcome,
    ).toBe("response-budget-exceeded");
    expect(runtime.snapshot().usage.pendingRequests).toBe(0);
    expect(runtime.snapshot().counters.rejectedResponseBudgets).toBe(1);
  });

  it("requires status payload identity and outer state/time to agree", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(descriptor(7));
    runtime.beginRequest(request(7, "request:status:1", "status"));

    const contradictory = statusResponse();
    (contradictory as { state: string }).state = "active";
    expect(runtime.acceptResponse(contradictory).outcome).toBe("response-mismatch");
    expect(runtime.snapshot().usage.pendingRequests).toBe(0);
    expect(runtime.acceptResponse(statusResponse()).outcome).toBe("unknown-request");

    runtime.beginRequest(request(7, "request:status:2", "status"));
    expect(runtime.acceptResponse(statusResponse(7, "request:status:2")).outcome).toBe(
      "accepted",
    );
    expect(runtime.snapshot().lanes[0]?.descriptor.state).toBe("parked");
  });

  it("refuses contradictory equal-time state", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(
      descriptor(7, { observedAt: "2026-08-26T17:10:00.000Z" }),
    );
    runtime.beginRequest(request(7, "request:status:1", "status"));

    expect(runtime.acceptResponse(statusResponse()).outcome).toBe("descriptor-conflict");
    expect(runtime.snapshot().usage.pendingRequests).toBe(0);
    expect(runtime.snapshot().lanes[0]?.descriptor.state).toBe("active");
  });

  it("supports explicit cancellation without retaining a tombstone", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(descriptor(7));
    runtime.beginRequest(request(7, "request:observe:cancel"));

    expect(runtime.cancelRequest("request:observe:cancel").outcome).toBe("cancelled");
    expect(runtime.snapshot().usage.pendingRequests).toBe(0);
    expect(
      runtime.acceptResponse(closedResponse(7, "request:observe:cancel")).outcome,
    ).toBe("unknown-request");
  });

  it("bounds lane and pending-request capacity", () => {
    const runtime = new ApplicationLaneRuntimeV1({
      maxLanes: 1,
      maxPendingRequests: 1,
      maxPendingRequestsPerLane: 1,
    });
    runtime.upsertDescriptor(descriptor(7));
    expect(
      runtime.upsertDescriptor({ ...descriptor(7), laneRef: "elatura:lane:chat-b" }).outcome,
    ).toBe("capacity");
    expect(runtime.beginRequest(request(7, "request:observe:1")).outcome).toBe("accepted");
    expect(runtime.beginRequest(request(7, "request:observe:2")).outcome).toBe("capacity");
  });

  it("returns pending ownership to zero across 100 generation replacements", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(
      descriptor(1, { observedAt: "2026-08-26T18:00:00.000Z" }),
    );

    for (let generation = 1; generation <= 100; generation += 1) {
      expect(
        runtime.beginRequest(request(generation, `request:observe:${generation}`)).outcome,
      ).toBe("accepted");
      expect(
        runtime.upsertDescriptor(
          descriptor(generation + 1, {
            observedAt: new Date(Date.UTC(2026, 7, 26, 18, 0, generation)).toISOString(),
          }),
        ).outcome,
      ).toBe("generation-replaced");
    }

    const snapshot = runtime.snapshot();
    expect(snapshot.usage).toMatchObject({ lanes: 1, pendingRequests: 0 });
    expect(snapshot.lanes[0]?.descriptor.generation).toBe(101);
    expect(snapshot.counters.generationReplacements).toBe(100);
    expect(snapshot.counters.clearedPendingRequests).toBe(100);
  });

  it("release and clear drop all volatile pending ownership", () => {
    const runtime = new ApplicationLaneRuntimeV1();
    runtime.upsertDescriptor(descriptor(7));
    runtime.beginRequest(request(7));
    expect(runtime.releaseLane("elatura:lane:chat-a").outcome).toBe("released");
    expect(runtime.snapshot().usage).toEqual({
      lanes: 0,
      pendingRequests: 0,
      recentEventIds: 0,
    });

    runtime.upsertDescriptor(descriptor(7));
    runtime.beginRequest(request(7, "request:observe:2"));
    runtime.clear();
    expect(runtime.snapshot().usage).toEqual({
      lanes: 0,
      pendingRequests: 0,
      recentEventIds: 0,
    });
  });
});
