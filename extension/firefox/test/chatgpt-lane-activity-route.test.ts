// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseChatGptLaneActivityObservationV1 } from "@elatura/adapter-chatgpt/lane-activity";
import {
  FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
  FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_MESSAGE_TYPE,
  admitFirefoxChatGptActivityRouteResponseV2,
  admitFirefoxChatGptDocumentProjectionResponseV1,
  createFirefoxChatGptActivityRouteFailureV2,
  createFirefoxChatGptDocumentProjectionFailureV1,
  matchFirefoxChatGptActivityRouteReceiptV2,
  parseFirefoxChatGptActivityContentResponseV2,
  parseFirefoxChatGptActivityRouteMessageV2,
  parseFirefoxChatGptActivityRouteRequestV2,
  parseFirefoxChatGptActivityWireObservationV1,
  parseFirefoxChatGptDocumentProjectionRouteMessageV1,
  parseFirefoxChatGptDocumentProjectionRouteRequestV1,
  type FirefoxChatGptActivityRouteRequestV2,
  type FirefoxChatGptDocumentProjectionRouteRequestV1,
} from "../src/chatgpt-lane-activity-route.js";

const DOCUMENT_PROJECTION_REF = "firefox-chatgpt-document-a";
const DISCOVERY: FirefoxChatGptDocumentProjectionRouteRequestV1 = Object.freeze({
  version: 1,
  requestRef: "discover-chat-a-1",
  tabId: 17,
});
const REQUEST: FirefoxChatGptActivityRouteRequestV2 = Object.freeze({
  version: 2,
  requestRef: "sample-chat-a-1",
  tabId: 17,
  documentProjectionRef: DOCUMENT_PROJECTION_REF,
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

function contentResponse(
  overrides: Record<string, unknown> = {},
) {
  return {
    version: 2,
    documentProjectionRef: DOCUMENT_PROJECTION_REF,
    status: "sampled",
    observation: observation(),
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

describe("Firefox ChatGPT document projection discovery", () => {
  it("admits only an explicit tab projection discovery request", () => {
    expect(parseFirefoxChatGptDocumentProjectionRouteRequestV1(DISCOVERY)).toEqual(DISCOVERY);
    expect(parseFirefoxChatGptDocumentProjectionRouteMessageV1({
      type: FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_MESSAGE_TYPE,
      request: DISCOVERY,
    })).toEqual(DISCOVERY);
  });

  it("reconstructs one content-free document projection receipt", () => {
    const receipt = admitFirefoxChatGptDocumentProjectionResponseV1(DISCOVERY, {
      version: 1,
      documentProjectionRef: DOCUMENT_PROJECTION_REF,
      observedAtMs: 1_000_000,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(receipt).toEqual({
      version: 1,
      requestRef: DISCOVERY.requestRef,
      tabId: DISCOVERY.tabId,
      outcome: "resolved",
      reason: "resolved",
      documentProjectionRef: DOCUMENT_PROJECTION_REF,
      observedAtMs: 1_000_000,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  });

  it("drops malformed discovery responses and exposes fixed unavailable receipts", () => {
    expect(admitFirefoxChatGptDocumentProjectionResponseV1(DISCOVERY, {
      version: 1,
      documentProjectionRef: DOCUMENT_PROJECTION_REF,
      observedAtMs: 1_000_000,
      grantsWorkAuthority: true,
      authorizesWorkDispatch: false,
    })).toMatchObject({
      outcome: "invalid_response",
      reason: "invalid_projection",
      documentProjectionRef: null,
    });
    expect(createFirefoxChatGptDocumentProjectionFailureV1(
      DISCOVERY,
      "unavailable",
      "content_unavailable",
    )).toMatchObject({
      outcome: "unavailable",
      reason: "content_unavailable",
      documentProjectionRef: null,
    });
  });
});

describe("Firefox ChatGPT activity route request v2", () => {
  it("requires explicit tab, document projection, and exact lane target", () => {
    expect(parseFirefoxChatGptActivityRouteRequestV2(REQUEST)).toEqual(REQUEST);
    expect(parseFirefoxChatGptActivityRouteMessageV2({
      type: FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
      request: REQUEST,
    })).toEqual(REQUEST);
  });

  it("rejects the old request form, request decoration, and accessors without invocation", () => {
    expect(() => parseFirefoxChatGptActivityRouteRequestV2({
      version: 1,
      requestRef: REQUEST.requestRef,
      tabId: REQUEST.tabId,
      laneRef: REQUEST.laneRef,
      laneGeneration: REQUEST.laneGeneration,
    })).toThrow("request is invalid");
    expect(() => parseFirefoxChatGptActivityRouteRequestV2({
      ...REQUEST,
      url: "https://example.invalid/private",
    })).toThrow("request is invalid");

    let reads = 0;
    const hostile = { ...REQUEST } as Record<string, unknown>;
    Object.defineProperty(hostile, "documentProjectionRef", {
      enumerable: true,
      get() {
        reads += 1;
        return DOCUMENT_PROJECTION_REF;
      },
    });
    expect(() => parseFirefoxChatGptActivityRouteRequestV2(hostile)).toThrow(
      "request is invalid",
    );
    expect(reads).toBe(0);
  });
});

describe("Firefox ChatGPT activity route response v2", () => {
  it("reconstructs one sampled response and stays canonical-parser compatible", () => {
    const parsedResponse = parseFirefoxChatGptActivityContentResponseV2(contentResponse());
    expect(parseChatGptLaneActivityObservationV1(parsedResponse.observation)).toEqual(
      parsedResponse.observation,
    );

    const receipt = admitFirefoxChatGptActivityRouteResponseV2(REQUEST, parsedResponse);
    expect(receipt).toMatchObject({
      version: 2,
      requestRef: REQUEST.requestRef,
      tabId: REQUEST.tabId,
      documentProjectionRef: DOCUMENT_PROJECTION_REF,
      laneRef: REQUEST.laneRef,
      laneGeneration: REQUEST.laneGeneration,
      outcome: "sampled",
      reason: "sampled",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(receipt.observation).toEqual(parsedResponse.observation);
  });

  it("refuses the same tab after the content document/route projection changes", () => {
    const receipt = admitFirefoxChatGptActivityRouteResponseV2(REQUEST, contentResponse({
      documentProjectionRef: "firefox-chatgpt-document-b",
      status: "projection_mismatch",
      observation: null,
    }));
    expect(receipt).toMatchObject({
      tabId: REQUEST.tabId,
      documentProjectionRef: DOCUMENT_PROJECTION_REF,
      outcome: "stale_projection",
      reason: "document_projection_mismatch",
      observation: null,
    });
  });

  it("treats a sampled response from another projection as stale and drops its observation", () => {
    const receipt = admitFirefoxChatGptActivityRouteResponseV2(REQUEST, contentResponse({
      documentProjectionRef: "firefox-chatgpt-document-b",
    }));
    expect(receipt).toMatchObject({
      outcome: "stale_projection",
      reason: "document_projection_mismatch",
      observation: null,
    });
  });

  it("drops invalid/content-bearing, wrong-lane, and wrong-generation responses", () => {
    expect(admitFirefoxChatGptActivityRouteResponseV2(REQUEST, contentResponse({
      transcript: "private marker",
    }))).toMatchObject({
      outcome: "invalid_response",
      reason: "invalid_observation",
      observation: null,
    });
    expect(admitFirefoxChatGptActivityRouteResponseV2(REQUEST, contentResponse({
      observation: observation({ laneRef: "elatura:lane:other" }),
    }))).toMatchObject({
      outcome: "mismatched_response",
      reason: "lane_mismatch",
      observation: null,
    });
    expect(admitFirefoxChatGptActivityRouteResponseV2(REQUEST, contentResponse({
      observation: observation({ laneGeneration: 13 }),
    }))).toMatchObject({
      outcome: "mismatched_response",
      reason: "generation_mismatch",
      observation: null,
    });
  });

  it("correlates receipts across request, tab, document projection, lane, and generation", () => {
    const receipt = admitFirefoxChatGptActivityRouteResponseV2(REQUEST, contentResponse());
    expect(matchFirefoxChatGptActivityRouteReceiptV2(REQUEST, receipt)).toEqual({
      matched: true,
      reason: "matched",
    });
    expect(matchFirefoxChatGptActivityRouteReceiptV2(
      { ...REQUEST, documentProjectionRef: "firefox-chatgpt-document-b" },
      receipt,
    )).toEqual({ matched: false, reason: "request_mismatch" });
  });

  it("keeps browser/content failures closed and observation-free", () => {
    expect(createFirefoxChatGptActivityRouteFailureV2(
      REQUEST,
      "unavailable",
      "content_unavailable",
    )).toMatchObject({
      outcome: "unavailable",
      reason: "content_unavailable",
      observation: null,
    });
    expect(createFirefoxChatGptActivityRouteFailureV2(
      REQUEST,
      "browser_error",
      "operation_failed",
    )).toMatchObject({
      outcome: "browser_error",
      reason: "operation_failed",
      observation: null,
    });
  });
});
