// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseChatGptLaneActivityObservationV1 } from "@elatura/adapter-chatgpt/lane-activity";
import {
  FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
  admitFirefoxChatGptActivityRouteResponseV1,
  createFirefoxChatGptActivityRouteFailureV1,
  matchFirefoxChatGptActivityRouteReceiptV1,
  parseFirefoxChatGptActivityRouteMessageV1,
  parseFirefoxChatGptActivityRouteReceiptV1,
  parseFirefoxChatGptActivityRouteRequestV1,
  parseFirefoxChatGptActivityWireObservationV1,
  type FirefoxChatGptActivityRouteRequestV1,
} from "../src/chatgpt-lane-activity-route.js";

const REQUEST: FirefoxChatGptActivityRouteRequestV1 = Object.freeze({
  version: 1,
  requestRef: "sample-chat-a-1",
  tabId: 17,
  laneRef: "elatura:lane:chat-a",
  laneGeneration: 12,
});

function observation(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    laneRef: REQUEST.laneRef,
    laneGeneration: REQUEST.laneGeneration,
    observedAtMs: 1_000_000,
    source: "reviewed-live-sentinel",
    confidence: "exact",
    generation: "active",
    composer: "clean",
    composition: "inactive",
    modal: "inactive",
    mediaOrDevice: "unknown",
    download: "unknown",
    otherTransient: "unknown",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

describe("Firefox ChatGPT activity route request", () => {
  it("admits only the explicit tab projection plus exact lane target", () => {
    expect(parseFirefoxChatGptActivityRouteRequestV1(REQUEST)).toEqual(REQUEST);
    expect(parseFirefoxChatGptActivityRouteMessageV1({
      type: FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
      request: REQUEST,
    })).toEqual(REQUEST);
  });

  it("rejects request decoration and accessors without invocation", () => {
    expect(() => parseFirefoxChatGptActivityRouteRequestV1({
      ...REQUEST,
      url: "https://example.invalid/private",
    })).toThrow("request is invalid");

    let reads = 0;
    const hostile = { ...REQUEST } as Record<string, unknown>;
    Object.defineProperty(hostile, "laneRef", {
      enumerable: true,
      get() {
        reads += 1;
        return REQUEST.laneRef;
      },
    });
    expect(() => parseFirefoxChatGptActivityRouteRequestV1(hostile)).toThrow(
      "request is invalid",
    );
    expect(reads).toBe(0);
  });

  it("ignores other runtime messages instead of claiming them", () => {
    expect(parseFirefoxChatGptActivityRouteMessageV1({
      type: "elatura:get-state",
      request: REQUEST,
    })).toBeNull();
    expect(parseFirefoxChatGptActivityRouteMessageV1({
      type: FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
      request: REQUEST,
      extra: true,
    })).toBeNull();
  });
});

describe("Firefox ChatGPT activity route response admission", () => {
  it("reconstructs one content-free observation and stays canonical-parser compatible", () => {
    const parsed = parseFirefoxChatGptActivityWireObservationV1(observation());
    expect(parseChatGptLaneActivityObservationV1(parsed)).toEqual(parsed);

    const receipt = admitFirefoxChatGptActivityRouteResponseV1(REQUEST, parsed);
    expect(receipt).toMatchObject({
      requestRef: REQUEST.requestRef,
      tabId: REQUEST.tabId,
      laneRef: REQUEST.laneRef,
      laneGeneration: REQUEST.laneGeneration,
      outcome: "sampled",
      reason: "sampled",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(receipt.observation).toEqual(parsed);
  });

  it("drops invalid/content-bearing responses without echoing them", () => {
    const receipt = admitFirefoxChatGptActivityRouteResponseV1(REQUEST, observation({
      transcript: "private marker",
    }));
    expect(receipt).toMatchObject({
      outcome: "invalid_response",
      reason: "invalid_observation",
      observation: null,
    });
    expect(JSON.stringify(receipt)).not.toContain("private marker");
  });

  it("drops wrong-lane and wrong-generation responses", () => {
    expect(admitFirefoxChatGptActivityRouteResponseV1(REQUEST, observation({
      laneRef: "elatura:lane:other",
    }))).toMatchObject({
      outcome: "mismatched_response",
      reason: "lane_mismatch",
      observation: null,
    });
    expect(admitFirefoxChatGptActivityRouteResponseV1(REQUEST, observation({
      laneGeneration: 13,
    }))).toMatchObject({
      outcome: "mismatched_response",
      reason: "generation_mismatch",
      observation: null,
    });
  });

  it("builds fixed browser/content failure receipts", () => {
    expect(createFirefoxChatGptActivityRouteFailureV1(
      REQUEST,
      "unavailable",
      "content_unavailable",
    )).toMatchObject({
      outcome: "unavailable",
      reason: "content_unavailable",
      observation: null,
    });
    expect(createFirefoxChatGptActivityRouteFailureV1(
      REQUEST,
      "browser_error",
      "operation_failed",
    )).toMatchObject({
      outcome: "browser_error",
      reason: "operation_failed",
      observation: null,
    });
  });

  it("parses and correlates sampled receipts before caller consumption", () => {
    const receipt = admitFirefoxChatGptActivityRouteResponseV1(REQUEST, observation());
    const parsed = parseFirefoxChatGptActivityRouteReceiptV1(receipt);
    expect(matchFirefoxChatGptActivityRouteReceiptV1(REQUEST, parsed)).toEqual({
      matched: true,
      reason: "matched",
    });
    expect(matchFirefoxChatGptActivityRouteReceiptV1(
      { ...REQUEST, requestRef: "different-request" },
      parsed,
    )).toEqual({ matched: false, reason: "request_mismatch" });
  });

  it("rejects incoherent sampled receipts", () => {
    const receipt = admitFirefoxChatGptActivityRouteResponseV1(REQUEST, observation());
    expect(() => parseFirefoxChatGptActivityRouteReceiptV1({
      ...receipt,
      observation: null,
    })).toThrow("sampled receipt is incoherent");
  });
});
