// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  bridgeFirefoxChatGptActivityToObserveResponseV1,
  FIREFOX_CHATGPT_ACTIVITY_CONTENT_TYPE,
} from "../src/chatgpt-lane-observe-bridge.js";
import {
  parseApplicationLaneRequestV1,
  parseApplicationLaneResponseV1,
} from "../../../packages/core/src/application-lane.js";
import { matchApplicationLaneResponseV1 } from "../../../packages/core/src/application-lane-client.js";

const binding = Object.freeze({
  tabId: 47,
  documentProjectionRef: "firefox-document-private-47",
  laneRef: "elatura:lane:generic-observe",
  laneGeneration: 9,
});

function request(payload: Record<string, unknown> = {}) {
  return {
    version: 1,
    requestId: "observe:generic:1",
    laneRef: binding.laneRef,
    laneGeneration: binding.laneGeneration,
    operation: "observe",
    payload: {
      maxItems: 1,
      maxTextCodeUnits: 2_000,
      maxSerializedBytes: 4_000,
      ...payload,
    },
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    laneRef: binding.laneRef,
    laneGeneration: binding.laneGeneration,
    observedAtMs: 1_788_000_000_000,
    source: "reviewed-live-sentinel",
    confidence: "exact",
    generation: "inactive",
    composer: "clean",
    composition: "inactive",
    modal: "inactive",
    mediaOrDevice: "inactive",
    download: "inactive",
    otherTransient: "inactive",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    requestRef: "route-sample-1",
    tabId: binding.tabId,
    documentProjectionRef: binding.documentProjectionRef,
    laneRef: binding.laneRef,
    laneGeneration: binding.laneGeneration,
    outcome: "sampled",
    reason: "sampled",
    observation: observation(),
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

describe("Firefox ChatGPT generic observe bridge", () => {
  it("projects one physical sample through the canonical observe response contract", () => {
    const rawRequest = request();
    expect(parseApplicationLaneRequestV1(rawRequest).operation).toBe("observe");

    const rawResponse = bridgeFirefoxChatGptActivityToObserveResponseV1(
      rawRequest,
      binding,
      "route-sample-1",
      receipt(),
      1_788_000_000_100,
    );
    const response = parseApplicationLaneResponseV1(rawResponse);
    expect(response).toMatchObject({
      requestId: "observe:generic:1",
      laneRef: binding.laneRef,
      laneGeneration: binding.laneGeneration,
      operation: "observe",
      outcome: "ok",
      state: "active",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
      payload: {
        freshness: "fresh",
        contentType: FIREFOX_CHATGPT_ACTIVITY_CONTENT_TYPE,
        omitted: false,
        content: {
          confidence: "exact",
          generation: "inactive",
          composer: "clean",
          composition: "inactive",
          modal: "inactive",
          mediaOrDevice: "inactive",
          download: "inactive",
          otherTransient: "inactive",
        },
      },
    });
    expect(matchApplicationLaneResponseV1(rawRequest, rawResponse)).toMatchObject({
      matched: true,
      reason: "matched",
    });

    const serialized = JSON.stringify(rawResponse);
    expect(serialized).not.toContain(String(binding.tabId));
    expect(serialized).not.toContain(binding.documentProjectionRef);
  });

  it("omits the one observation when the full token set exceeds the caller budget", () => {
    const rawRequest = request({ maxTextCodeUnits: 1, maxSerializedBytes: 4 });
    const rawResponse = bridgeFirefoxChatGptActivityToObserveResponseV1(
      rawRequest,
      binding,
      "route-sample-1",
      receipt(),
      1_788_000_000_100,
    );
    const response = parseApplicationLaneResponseV1(rawResponse);
    expect(response).toMatchObject({
      outcome: "ok",
      payload: { omitted: true, content: null },
    });
    expect(matchApplicationLaneResponseV1(rawRequest, rawResponse)).toMatchObject({
      matched: true,
      reason: "matched",
    });
  });

  it("fails before emitting an oversized ok response when even null cannot fit", () => {
    expect(() => bridgeFirefoxChatGptActivityToObserveResponseV1(
      request({ maxTextCodeUnits: 1, maxSerializedBytes: 3 }),
      binding,
      "route-sample-1",
      receipt(),
      1_788_000_000_100,
    )).toThrow(RangeError);
  });

  it.each([
    ["stale_projection", "document_projection_mismatch", "drifted", "drifted"],
    ["unavailable", "content_unavailable", "unavailable", "unavailable"],
    ["browser_error", "operation_failed", "recovery_needed", "recovery_needed"],
  ] as const)("maps %s truthfully without application authority", (outcome, reason, expectedOutcome, state) => {
    const rawRequest = request();
    const rawResponse = bridgeFirefoxChatGptActivityToObserveResponseV1(
      rawRequest,
      binding,
      "route-sample-1",
      receipt({ outcome, reason, observation: null }),
      1_788_000_000_500,
    );
    expect(parseApplicationLaneResponseV1(rawResponse)).toMatchObject({
      outcome: expectedOutcome,
      state,
      payload: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(matchApplicationLaneResponseV1(rawRequest, rawResponse).matched).toBe(true);
  });

  it("rejects private projection, lane, and malformed-route mismatches", () => {
    expect(() => bridgeFirefoxChatGptActivityToObserveResponseV1(
      request(),
      binding,
      "route-sample-1",
      receipt({ documentProjectionRef: "firefox-document-other" }),
      1_788_000_000_500,
    )).toThrow(TypeError);
    expect(() => bridgeFirefoxChatGptActivityToObserveResponseV1(
      request(),
      { ...binding, laneGeneration: binding.laneGeneration + 1 },
      "route-sample-1",
      receipt(),
      1_788_000_000_500,
    )).toThrow(TypeError);
    expect(() => bridgeFirefoxChatGptActivityToObserveResponseV1(
      request(),
      binding,
      "route-sample-1",
      receipt({ outcome: "invalid_response", reason: "invalid_observation", observation: null }),
      1_788_000_000_500,
    )).toThrow(TypeError);
  });
});
