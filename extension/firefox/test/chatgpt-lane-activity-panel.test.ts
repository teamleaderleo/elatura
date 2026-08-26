// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  acceptFirefoxChatGptActivityPanelDiscoveryV1,
  acceptFirefoxChatGptActivityPanelSampleV1,
  createFirefoxChatGptActivityPanelDiscoveryMessageV1,
  createFirefoxChatGptActivityPanelSampleMessageV1,
  parseFirefoxChatGptActivityPanelTargetV1,
} from "../src/chatgpt-lane-activity-panel.js";

const TARGET = Object.freeze({
  laneRef: "elatura:lane:chat-panel",
  laneGeneration: 12,
});
const TAB_ID = 17;
const DOCUMENT_REF = "firefox-chatgpt-document-a";

function discoveryResponse(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    requestRef: "discover-1",
    tabId: TAB_ID,
    outcome: "resolved",
    reason: "resolved",
    documentProjectionRef: DOCUMENT_REF,
    observedAtMs: 1_000_000,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

function activityObservation(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    laneRef: TARGET.laneRef,
    laneGeneration: TARGET.laneGeneration,
    observedAtMs: 1_000_100,
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

function sampleResponse(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    requestRef: "sample-1",
    tabId: TAB_ID,
    documentProjectionRef: DOCUMENT_REF,
    laneRef: TARGET.laneRef,
    laneGeneration: TARGET.laneGeneration,
    outcome: "sampled",
    reason: "sampled",
    observation: activityObservation(),
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

describe("Firefox ChatGPT activity panel target", () => {
  it("parses one trimmed canonical lane target", () => {
    expect(parseFirefoxChatGptActivityPanelTargetV1(
      "  elatura:lane:chat-panel  ",
      "12",
    )).toEqual(TARGET);
  });

  it("rejects invalid lane references and generations", () => {
    expect(() => parseFirefoxChatGptActivityPanelTargetV1("bad lane", "12")).toThrow(
      "lane reference is invalid",
    );
    expect(() => parseFirefoxChatGptActivityPanelTargetV1(TARGET.laneRef, "0")).toThrow(
      "lane generation is invalid",
    );
    expect(() => parseFirefoxChatGptActivityPanelTargetV1(TARGET.laneRef, "1.5")).toThrow(
      "lane generation is invalid",
    );
  });
});

describe("Firefox ChatGPT activity panel discovery", () => {
  it("creates one explicit-tab discovery message", () => {
    expect(createFirefoxChatGptActivityPanelDiscoveryMessageV1(TAB_ID, "discover-1")).toEqual({
      type: "elatura:get-chatgpt-document-projection-on-tab",
      request: { version: 1, requestRef: "discover-1", tabId: TAB_ID },
    });
  });

  it("creates a volatile binding from one correlated resolved discovery", () => {
    const result = acceptFirefoxChatGptActivityPanelDiscoveryV1(
      TARGET,
      TAB_ID,
      "discover-1",
      discoveryResponse(),
    );
    expect(result).toEqual({
      status: "bound",
      binding: {
        tabId: TAB_ID,
        documentProjectionRef: DOCUMENT_REF,
        laneRef: TARGET.laneRef,
        laneGeneration: TARGET.laneGeneration,
      },
    });
  });

  it("refuses mismatched and unavailable discovery responses", () => {
    expect(acceptFirefoxChatGptActivityPanelDiscoveryV1(
      TARGET,
      TAB_ID,
      "discover-1",
      discoveryResponse({ requestRef: "other" }),
    )).toEqual({ status: "invalid", binding: null });
    expect(acceptFirefoxChatGptActivityPanelDiscoveryV1(
      TARGET,
      TAB_ID,
      "discover-1",
      discoveryResponse({
        outcome: "unavailable",
        reason: "content_unavailable",
        documentProjectionRef: null,
        observedAtMs: null,
      }),
    )).toEqual({ status: "unavailable", binding: null });
  });
});

describe("Firefox ChatGPT activity panel sampling", () => {
  const binding = Object.freeze({
    tabId: TAB_ID,
    documentProjectionRef: DOCUMENT_REF,
    laneRef: TARGET.laneRef,
    laneGeneration: TARGET.laneGeneration,
  });

  it("creates a v2 sample message from the volatile binding", () => {
    expect(createFirefoxChatGptActivityPanelSampleMessageV1(binding, "sample-1")).toEqual({
      type: "elatura:sample-chatgpt-lane-activity-on-tab",
      request: {
        version: 2,
        requestRef: "sample-1",
        tabId: TAB_ID,
        documentProjectionRef: DOCUMENT_REF,
        laneRef: TARGET.laneRef,
        laneGeneration: TARGET.laneGeneration,
      },
    });
  });

  it("accepts one correlated content-free sample and retains the binding", () => {
    const result = acceptFirefoxChatGptActivityPanelSampleV1(
      binding,
      "sample-1",
      sampleResponse(),
    );
    expect(result).toEqual({
      status: "sampled",
      binding,
      observation: {
        confidence: "exact",
        generation: "active",
        composer: "clean",
        composition: "inactive",
        modal: "inactive",
        mediaOrDevice: "unknown",
        download: "unknown",
        otherTransient: "unknown",
      },
    });
  });

  it("clears the volatile binding on stale projection", () => {
    expect(acceptFirefoxChatGptActivityPanelSampleV1(
      binding,
      "sample-1",
      sampleResponse({
        outcome: "stale_projection",
        reason: "document_projection_mismatch",
        observation: null,
      }),
    )).toEqual({ status: "stale", binding: null, observation: null });
  });

  it("clears the volatile binding on failed or mismatched receipts", () => {
    expect(acceptFirefoxChatGptActivityPanelSampleV1(
      binding,
      "sample-1",
      sampleResponse({
        outcome: "unavailable",
        reason: "content_unavailable",
        observation: null,
      }),
    )).toEqual({ status: "unavailable", binding: null, observation: null });
    expect(acceptFirefoxChatGptActivityPanelSampleV1(
      binding,
      "sample-1",
      sampleResponse({ requestRef: "other" }),
    )).toEqual({ status: "invalid", binding: null, observation: null });
  });

  it("never exposes the private document projection in the display observation", () => {
    const result = acceptFirefoxChatGptActivityPanelSampleV1(
      binding,
      "sample-1",
      sampleResponse(),
    );
    expect(JSON.stringify(result.observation)).not.toContain(DOCUMENT_REF);
  });
});
