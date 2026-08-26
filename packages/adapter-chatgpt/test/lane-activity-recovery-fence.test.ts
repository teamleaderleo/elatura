// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { generateSyntheticConversation } from "@elatura/fixtures";
import {
  CHATGPT_ADAPTER_ID,
  CHATGPT_ADAPTER_VERSION,
} from "../src/identities.js";
import { validateChatGptConversation } from "../src/index.js";
import { assessChatGptLaneTransitionV1 } from "../src/lane-activity.js";
import {
  assessChatGptLaneRecoveryV1,
  createChatGptLaneWitnessV1,
} from "../src/lane-witness.js";

const NOW = 1_000_000;

function descriptor(laneRef: string, generation: number) {
  return {
    version: 1 as const,
    laneRef,
    generation,
    adapter: { id: CHATGPT_ADAPTER_ID, version: CHATGPT_ADAPTER_VERSION },
    capabilities: ["events", "observe", "activate", "screenshot"] as const,
    state: "active" as const,
    observedAt: "2026-08-27T00:00:00.000Z",
  };
}

function source() {
  const validated = validateChatGptConversation(
    generateSyntheticConversation({
      seed: 42,
      turnGroups: 3,
      payloadBytesPerMessage: 32,
      includeUnknownFields: true,
    }),
  );
  if (!validated.ok) throw new Error("Synthetic ChatGPT fixture failed validation");
  return validated.value;
}

function verifiedRecovery(laneRef: string, generation: number) {
  const lane = descriptor(laneRef, generation);
  const graph = source();
  const witness = createChatGptLaneWitnessV1(lane, graph, NOW - 100);
  return assessChatGptLaneRecoveryV1(lane, witness, graph, NOW - 50);
}

function idleActivity(laneRef: string, laneGeneration: number) {
  return {
    version: 1 as const,
    laneRef,
    laneGeneration,
    observedAtMs: NOW,
    source: "reviewed-live-sentinel" as const,
    confidence: "exact" as const,
    generation: "inactive" as const,
    composer: "clean" as const,
    composition: "inactive" as const,
    modal: "inactive" as const,
    mediaOrDevice: "inactive" as const,
    download: "inactive" as const,
    otherTransient: "inactive" as const,
    grantsWorkAuthority: false as const,
    authorizesWorkDispatch: false as const,
  };
}

describe("ChatGPT activity recovery identity fence", () => {
  it("refuses verified recovery from another lane", () => {
    const current = descriptor("elatura:lane:current", 8);
    const recovery = verifiedRecovery("elatura:lane:other", 8);

    const result = assessChatGptLaneTransitionV1(
      current,
      recovery,
      idleActivity(current.laneRef, current.generation),
      NOW + 100,
    );

    expect(result).toMatchObject({
      status: "mismatched",
      reason: "lane_mismatch",
      fidelity: {
        recovery: "attention_required",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
        blockers: ["application_unknown"],
      },
    });
  });

  it("refuses verified recovery from an older generation", () => {
    const current = descriptor("elatura:lane:current", 8);
    const recovery = verifiedRecovery(current.laneRef, 7);

    const result = assessChatGptLaneTransitionV1(
      current,
      recovery,
      idleActivity(current.laneRef, current.generation),
      NOW + 100,
    );

    expect(result).toMatchObject({
      status: "mismatched",
      reason: "generation_mismatch",
      fidelity: {
        recovery: "attention_required",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
        blockers: ["application_unknown"],
      },
    });
  });
});
