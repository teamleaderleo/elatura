// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { generateSyntheticConversation } from "@elatura/fixtures";
import {
  CHATGPT_ADAPTER_ID,
  CHATGPT_ADAPTER_VERSION,
} from "../src/identities.js";
import { validateChatGptConversation, type ChatGptConversation } from "../src/index.js";
import {
  assessChatGptLaneRecoveryV1,
  createChatGptLaneWitnessV1,
} from "../src/lane-witness.js";

const NOW = 1_000_000;

function descriptor(generation = 7) {
  return {
    version: 1 as const,
    laneRef: "elatura:lane:chat-a",
    generation,
    adapter: { id: CHATGPT_ADAPTER_ID, version: CHATGPT_ADAPTER_VERSION },
    capabilities: ["events", "observe", "activate", "screenshot"] as const,
    state: "active" as const,
    observedAt: "2026-08-27T00:00:00.000Z",
  };
}

function conversation(seed: number, turnGroups: number): ChatGptConversation {
  const validated = validateChatGptConversation(
    generateSyntheticConversation({
      seed,
      turnGroups,
      payloadBytesPerMessage: 32,
      includeUnknownFields: true,
    }),
  );
  if (!validated.ok) throw new Error("Synthetic ChatGPT fixture failed validation");
  return validated.value;
}

describe("ChatGPT application-lane continuity witness", () => {
  it("binds one private active-root anchor to the exact lane generation", () => {
    const source = conversation(42, 3);
    const witness = createChatGptLaneWitnessV1(descriptor(), source, NOW);

    expect(witness).toMatchObject({
      version: 1,
      laneRef: "elatura:lane:chat-a",
      laneGeneration: 7,
      adapter: { id: CHATGPT_ADAPTER_ID, version: CHATGPT_ADAPTER_VERSION },
      source: "validated-chatgpt-active-path",
      nodeCount: Object.keys(source.mapping).length,
      observedAtMs: NOW,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(witness.anchorRef).toBeTruthy();
    expect(witness.activePathDepth).toBeGreaterThan(1);
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness.adapter)).toBe(true);
  });

  it("verifies continuity when the same conversation graph advances to a later current node", () => {
    const initial = conversation(42, 2);
    const later = conversation(42, 7);
    const expected = createChatGptLaneWitnessV1(descriptor(), initial, NOW);

    expect(later.currentNode).not.toBe(initial.currentNode);
    const assessment = assessChatGptLaneRecoveryV1(
      descriptor(),
      expected,
      later,
      NOW + 1_000,
    );

    expect(assessment).toMatchObject({
      status: "verified",
      reason: "anchor_match",
      identityContinuity: "verified",
      fidelity: {
        recovery: "verified",
        freezeEligibility: "unknown",
        discardEligibility: "unknown",
        blockers: [],
      },
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  });

  it("requires attention when a different ChatGPT graph replaces the witnessed graph", () => {
    const expected = createChatGptLaneWitnessV1(descriptor(), conversation(42, 3), NOW);
    const assessment = assessChatGptLaneRecoveryV1(
      descriptor(),
      expected,
      conversation(99, 3),
      NOW + 1,
    );

    expect(assessment).toMatchObject({
      status: "attention_required",
      reason: "anchor_changed",
      identityContinuity: "attention_required",
      fidelity: {
        recovery: "attention_required",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
        blockers: ["application_unknown"],
      },
    });
  });

  it("refuses an old witness after the canonical lane generation advances", () => {
    const source = conversation(42, 3);
    const expected = createChatGptLaneWitnessV1(descriptor(7), source, NOW);
    const assessment = assessChatGptLaneRecoveryV1(
      descriptor(8),
      expected,
      source,
      NOW + 1,
    );

    expect(assessment).toMatchObject({
      laneGeneration: 8,
      status: "stale_generation",
      reason: "generation_mismatch",
      identityContinuity: "attention_required",
      fidelity: { recovery: "attention_required" },
    });
  });

  it("refuses observation-time regression without replacing the witness", () => {
    const source = conversation(42, 3);
    const expected = createChatGptLaneWitnessV1(descriptor(), source, NOW);
    const assessment = assessChatGptLaneRecoveryV1(
      descriptor(),
      expected,
      source,
      NOW - 1,
    );

    expect(assessment).toMatchObject({
      status: "stale_observation",
      reason: "observation_regressed",
      fidelity: {
        recovery: "attention_required",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
      },
    });
  });

  it("rejects a non-ChatGPT descriptor when creating a witness", () => {
    const source = conversation(42, 3);
    const wrong = {
      ...descriptor(),
      adapter: { id: "other-adapter", version: "1" },
    };

    expect(() => createChatGptLaneWitnessV1(wrong, source, NOW)).toThrow(
      "current ChatGPT adapter identity",
    );
  });

  it("keeps transition permission conservative after identity continuity succeeds", () => {
    const source = conversation(42, 3);
    const expected = createChatGptLaneWitnessV1(descriptor(), source, NOW);
    const assessment = assessChatGptLaneRecoveryV1(
      descriptor(),
      expected,
      source,
      NOW + 1,
    );

    expect(assessment.fidelity).toEqual({
      recovery: "verified",
      freezeEligibility: "unknown",
      discardEligibility: "unknown",
      blockers: [],
    });
  });
});
