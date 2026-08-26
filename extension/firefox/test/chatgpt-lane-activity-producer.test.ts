// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseChatGptLaneActivityObservationV1 } from "@elatura/adapter-chatgpt/lane-activity";
import {
  classifyFirefoxChatGptLaneActivityV1,
  createFirefoxChatGptDocumentProjectionState,
  parseFirefoxChatGptLaneActivityTargetV2,
  type FirefoxChatGptPageSignalSnapshotV1,
} from "../src/chatgpt-lane-activity-producer.js";

const NOW = 1_000_000;
const TARGET = Object.freeze({
  laneRef: "elatura:lane:chat-firefox",
  laneGeneration: 12,
  documentProjectionRef: "firefox-chatgpt-document-a",
});

function laneTarget() {
  return { laneRef: TARGET.laneRef, laneGeneration: TARGET.laneGeneration };
}

function snapshot(
  overrides: Partial<FirefoxChatGptPageSignalSnapshotV1> = {},
): FirefoxChatGptPageSignalSnapshotV1 {
  return {
    generationMarkerActive: false,
    conversationMarkersPresent: true,
    composerCount: 1,
    composerDirty: false,
    compositionActive: false,
    modalActive: false,
    mediaActive: false,
    ...overrides,
  };
}

describe("Firefox ChatGPT activity target", () => {
  it("accepts exact durable lane identity plus the current private document projection", () => {
    expect(parseFirefoxChatGptLaneActivityTargetV2(TARGET)).toEqual(TARGET);
  });

  it("rejects browser/content decoration and accessors without invoking them", () => {
    expect(() => parseFirefoxChatGptLaneActivityTargetV2({
      ...TARGET,
      tabId: 17,
    })).toThrow("target is invalid");

    let reads = 0;
    const hostile = { ...TARGET } as Record<string, unknown>;
    Object.defineProperty(hostile, "laneRef", {
      enumerable: true,
      get() {
        reads += 1;
        return TARGET.laneRef;
      },
    });
    expect(() => parseFirefoxChatGptLaneActivityTargetV2(hostile)).toThrow(
      "target is invalid",
    );
    expect(reads).toBe(0);
  });
});

describe("Firefox ChatGPT document projection epoch", () => {
  it("keeps one projection stable while the private route key is unchanged", () => {
    const refs = ["firefox-chatgpt-document-a", "firefox-chatgpt-document-b"];
    const state = createFirefoxChatGptDocumentProjectionState(
      "https://chatgpt.com/c/a",
      () => refs.shift() ?? "firefox-chatgpt-document-fallback",
    );

    expect(state.current("https://chatgpt.com/c/a")).toBe("firefox-chatgpt-document-a");
    expect(state.current("https://chatgpt.com/c/a")).toBe("firefox-chatgpt-document-a");
  });

  it("rotates the projection when the locally observed ChatGPT route changes", () => {
    const refs = ["firefox-chatgpt-document-a", "firefox-chatgpt-document-b"];
    const state = createFirefoxChatGptDocumentProjectionState(
      "https://chatgpt.com/c/a",
      () => refs.shift() ?? "firefox-chatgpt-document-fallback",
    );

    expect(state.current("https://chatgpt.com/c/a")).toBe("firefox-chatgpt-document-a");
    expect(state.current("https://chatgpt.com/c/b")).toBe("firefox-chatgpt-document-b");
    expect(state.current("https://chatgpt.com/c/b")).toBe("firefox-chatgpt-document-b");
  });
});

describe("Firefox ChatGPT activity classification", () => {
  it("emits an exact generation blocker when the live page shows generation activity", () => {
    const observation = classifyFirefoxChatGptLaneActivityV1(
      laneTarget(),
      snapshot({ generationMarkerActive: true }),
      NOW,
    );

    expect(observation).toMatchObject({
      laneRef: TARGET.laneRef,
      laneGeneration: TARGET.laneGeneration,
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
    });
    expect(parseChatGptLaneActivityObservationV1(observation)).toEqual(observation);
  });

  it("emits an exact unsaved-interaction blocker for a dirty composer", () => {
    const observation = classifyFirefoxChatGptLaneActivityV1(
      laneTarget(),
      snapshot({ composerDirty: true }),
      NOW,
    );
    expect(observation).toMatchObject({ confidence: "exact", composer: "dirty" });
    expect(parseChatGptLaneActivityObservationV1(observation)).toEqual(observation);
  });

  it("emits exact IME/modal/media blockers when observed", () => {
    const composition = classifyFirefoxChatGptLaneActivityV1(
      laneTarget(),
      snapshot({ compositionActive: true }),
      NOW,
    );
    const modal = classifyFirefoxChatGptLaneActivityV1(
      laneTarget(),
      snapshot({ modalActive: true }),
      NOW,
    );
    const media = classifyFirefoxChatGptLaneActivityV1(
      laneTarget(),
      snapshot({ mediaActive: true }),
      NOW,
    );

    expect(composition).toMatchObject({ confidence: "exact", composition: "active" });
    expect(modal).toMatchObject({ confidence: "exact", modal: "active" });
    expect(media).toMatchObject({ confidence: "exact", mediaOrDevice: "active" });
  });

  it("keeps a quiet page probable while unsupported dimensions remain unknown", () => {
    const observation = classifyFirefoxChatGptLaneActivityV1(laneTarget(), snapshot(), NOW);
    expect(observation).toMatchObject({
      confidence: "probable",
      generation: "inactive",
      composer: "clean",
      composition: "inactive",
      modal: "inactive",
      mediaOrDevice: "unknown",
      download: "unknown",
      otherTransient: "unknown",
    });
    expect(parseChatGptLaneActivityObservationV1(observation)).toEqual(observation);
  });

  it("keeps missing or ambiguous live markers unknown", () => {
    const observation = classifyFirefoxChatGptLaneActivityV1(
      laneTarget(),
      snapshot({
        conversationMarkersPresent: false,
        composerCount: 2,
        composerDirty: null,
      }),
      NOW,
    );
    expect(observation).toMatchObject({
      confidence: "probable",
      generation: "unknown",
      composer: "unknown",
    });
  });

  it("emits only the reviewed content-free sentinel keys", () => {
    const observation = classifyFirefoxChatGptLaneActivityV1(laneTarget(), snapshot(), NOW);
    expect(Object.keys(observation).sort()).toEqual([
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
    expect(JSON.stringify(observation)).not.toContain("chatgpt.com");
  });
});
