// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseChatGptLaneActivityObservationV1 } from "@elatura/adapter-chatgpt/lane-activity";
import { admitFirefoxChatGptActivityDiagnosticV1 } from "../src/chatgpt-lane-activity-diagnostic.js";

const BINDING = Object.freeze({
  tabId: 17,
  documentProjectionRef: "firefox-chatgpt-document-a",
  laneRef: "elatura:lane:diagnostic",
  laneGeneration: 7,
});

const DISPLAY = Object.freeze({
  confidence: "probable" as const,
  generation: "inactive" as const,
  composer: "clean" as const,
  composition: "inactive" as const,
  modal: "inactive" as const,
  mediaOrDevice: "unknown" as const,
  download: "unknown" as const,
  otherTransient: "unknown" as const,
});

function wire(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    laneRef: BINDING.laneRef,
    laneGeneration: BINDING.laneGeneration,
    observedAtMs: 1_000_100,
    source: "reviewed-live-sentinel",
    ...DISPLAY,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

describe("Firefox ChatGPT activity diagnostic admission", () => {
  it("emits the exact canonical adapter observation without browser projection identifiers", () => {
    const diagnostic = admitFirefoxChatGptActivityDiagnosticV1(BINDING, DISPLAY, wire());

    expect(parseChatGptLaneActivityObservationV1(diagnostic)).toEqual(diagnostic);
    expect(Object.keys(diagnostic).sort()).toEqual([
      "authorizesWorkDispatch",
      "composer",
      "composition",
      "confidence",
      "download",
      "generation",
      "grantsWorkAuthority",
      "laneGeneration",
      "laneRef",
      "mediaOrDevice",
      "modal",
      "observedAtMs",
      "otherTransient",
      "source",
      "version",
    ]);
    const json = JSON.stringify(diagnostic);
    expect(json).not.toContain(String(BINDING.tabId));
    expect(json).not.toContain(BINDING.documentProjectionRef);
  });

  it("refuses a wire observation for another lane or generation", () => {
    expect(() => admitFirefoxChatGptActivityDiagnosticV1(
      BINDING,
      DISPLAY,
      wire({ laneRef: "elatura:lane:other" }),
    )).toThrow("diagnostic target is invalid");
    expect(() => admitFirefoxChatGptActivityDiagnosticV1(
      BINDING,
      DISPLAY,
      wire({ laneGeneration: 8 }),
    )).toThrow("diagnostic target is invalid");
  });

  it("refuses a wire observation that differs from the accepted popup sample", () => {
    expect(() => admitFirefoxChatGptActivityDiagnosticV1(
      BINDING,
      DISPLAY,
      wire({ composer: "dirty" }),
    )).toThrow("diagnostic observation is invalid");
  });

  it("inherits exact-field and accessor rejection from the reviewed wire parser", () => {
    expect(() => admitFirefoxChatGptActivityDiagnosticV1(
      BINDING,
      DISPLAY,
      { ...wire(), extra: "blocked" },
    )).toThrow("activity observation is invalid");

    const hostile = wire();
    Object.defineProperty(hostile, "composer", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expect(() => admitFirefoxChatGptActivityDiagnosticV1(BINDING, DISPLAY, hostile)).toThrow(
      "activity observation is invalid",
    );
  });
});
