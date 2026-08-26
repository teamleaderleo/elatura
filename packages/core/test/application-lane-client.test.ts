// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { matchApplicationLaneResponseV1 } from "../src/application-lane-client.js";

const observeRequest = {
  version: 1,
  requestId: "req-observe-1",
  laneRef: "lane-chat-a",
  laneGeneration: 7,
  operation: "observe",
  payload: {
    maxItems: 4,
    maxTextCodeUnits: 64,
    maxSerializedBytes: 256,
  },
} as const;

const observeResponse = {
  version: 1,
  requestId: observeRequest.requestId,
  laneRef: observeRequest.laneRef,
  laneGeneration: observeRequest.laneGeneration,
  operation: "observe",
  outcome: "ok",
  state: "active",
  observedAt: "2026-08-27T00:00:00.000Z",
  payload: {
    observationRef: "obs-chat-a-1",
    freshness: "fresh",
    contentType: "application/json",
    content: { state: "changed", excerpt: "bounded" },
    omitted: true,
    sourceRefs: ["source-chat-a-1"],
  },
  sourceRefs: ["source-chat-a-1"],
  grantsWorkAuthority: false,
  authorizesWorkDispatch: false,
} as const;

describe("application lane response binding", () => {
  it("accepts only the exact request/lane generation/operation response", () => {
    const decision = matchApplicationLaneResponseV1(observeRequest, observeResponse);

    expect(decision).toMatchObject({
      version: 1,
      matched: true,
      reason: "matched",
      requestId: observeRequest.requestId,
      laneRef: observeRequest.laneRef,
      laneGeneration: observeRequest.laneGeneration,
      operation: "observe",
    });
    expect(decision.response).toEqual(observeResponse);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it.each([
    ["request_id_mismatch", { requestId: "req-other" }],
    ["lane_ref_mismatch", { laneRef: "lane-other" }],
    ["lane_generation_mismatch", { laneGeneration: 8 }],
    ["operation_mismatch", { operation: "status", payload: {
      version: 1,
      laneRef: observeRequest.laneRef,
      generation: observeRequest.laneGeneration,
      adapter: { id: "chatgpt", version: "1" },
      capabilities: ["events", "observe", "activate", "screenshot"],
      state: "active",
      observedAt: "2026-08-27T00:00:00.000Z",
    } }],
  ] as const)("rejects %s before the response can be consumed", (reason, patch) => {
    const decision = matchApplicationLaneResponseV1(observeRequest, {
      ...observeResponse,
      ...patch,
    });

    expect(decision).toMatchObject({ matched: false, reason, response: null });
  });

  it("re-measures observation content against the caller's narrower text budget", () => {
    const decision = matchApplicationLaneResponseV1(observeRequest, {
      ...observeResponse,
      payload: {
        ...observeResponse.payload,
        content: { excerpt: "x".repeat(65) },
      },
    });

    expect(decision).toMatchObject({
      matched: false,
      reason: "observation_budget_exceeded",
      response: null,
    });
  });

  it("re-measures observation content against the caller's narrower serialized-byte budget", () => {
    const request = {
      ...observeRequest,
      payload: {
        ...observeRequest.payload,
        maxTextCodeUnits: 1_024,
        maxSerializedBytes: 32,
      },
    };
    const decision = matchApplicationLaneResponseV1(request, {
      ...observeResponse,
      payload: {
        ...observeResponse.payload,
        content: { excerpt: "012345678901234567890123456789" },
      },
    });

    expect(decision).toMatchObject({
      matched: false,
      reason: "observation_budget_exceeded",
      response: null,
    });
  });

  it("accepts an exact unavailable response without requiring a success payload", () => {
    const statusRequest = {
      version: 1,
      requestId: "req-status-1",
      laneRef: observeRequest.laneRef,
      laneGeneration: observeRequest.laneGeneration,
      operation: "status",
      payload: {},
    } as const;
    const decision = matchApplicationLaneResponseV1(statusRequest, {
      version: 1,
      requestId: statusRequest.requestId,
      laneRef: statusRequest.laneRef,
      laneGeneration: statusRequest.laneGeneration,
      operation: "status",
      outcome: "unavailable",
      state: "unavailable",
      observedAt: "2026-08-27T00:01:00.000Z",
      payload: null,
      sourceRefs: ["health-chat-a-2"],
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });

    expect(decision).toMatchObject({ matched: true, reason: "matched" });
    expect(decision.response).toMatchObject({
      outcome: "unavailable",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  });

  it("inherits the protocol authority fence", () => {
    expect(() => matchApplicationLaneResponseV1(observeRequest, {
      ...observeResponse,
      authorizesWorkDispatch: true,
    })).toThrow("zero work dispatch");
  });
});
