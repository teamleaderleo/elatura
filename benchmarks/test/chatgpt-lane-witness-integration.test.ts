// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { generateSyntheticConversation } from "@elatura/fixtures";
import {
  CHATGPT_ADAPTER_ID,
  CHATGPT_ADAPTER_VERSION,
} from "@elatura/adapter-chatgpt/identities";
import { validateChatGptConversation, type ChatGptConversation } from "@elatura/adapter-chatgpt";
import {
  assessChatGptLaneRecoveryV1,
  createChatGptLaneWitnessV1,
} from "@elatura/adapter-chatgpt/lane-witness";
import { createApplicationLaneResidencyRequestV1 } from "@elatura/core/application-lane-lifecycle";
import {
  createChromiumLaneBindingV1,
  planBoundChromiumResidencyV1,
} from "../../extension/chromium/src/binding.js";
import { projectChromiumTab } from "../../extension/chromium/src/projection.js";

const NOW = 1_000_000;

function descriptor() {
  return {
    version: 1 as const,
    laneRef: "elatura:lane:chat-integration",
    generation: 11,
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

function backgroundProjection() {
  return projectChromiumTab(
    {
      id: 17,
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
      frozen: false,
      autoDiscardable: true,
      lastAccessed: NOW - 60_000,
      windowId: 3,
      index: 2,
      status: "complete",
    },
    false,
  );
}

describe("ChatGPT witness -> Chromium residency integration", () => {
  it("turns verified ChatGPT continuity into Keep warm for responsive intent", () => {
    const lane = descriptor();
    const initial = conversation(42, 2);
    const recovered = conversation(42, 6);
    const witness = createChatGptLaneWitnessV1(lane, initial, NOW);
    const recovery = assessChatGptLaneRecoveryV1(lane, witness, recovered, NOW + 1_000);
    const projection = backgroundProjection();
    const binding = createChromiumLaneBindingV1(lane, projection);
    const request = createApplicationLaneResidencyRequestV1(lane, "responsive");

    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      projection,
      request,
      recovery.fidelity,
    );

    expect(recovery).toMatchObject({
      status: "verified",
      fidelity: {
        recovery: "verified",
        freezeEligibility: "unknown",
        discardEligibility: "unknown",
      },
    });
    expect(plan).toMatchObject({
      binding: { matched: true, reason: "matched" },
      decision: { action: "none", reason: "already_satisfied" },
      effect: "keep_warm",
      facts: {
        recovery: "verified",
        freezeEligibility: "unknown",
        discardEligibility: "unknown",
      },
    });
  });

  it("keeps reclaim permission closed when continuity is verified but transition safety is unknown", () => {
    const lane = descriptor();
    const source = conversation(42, 3);
    const witness = createChatGptLaneWitnessV1(lane, source, NOW);
    const recovery = assessChatGptLaneRecoveryV1(lane, witness, source, NOW + 1);
    const projection = backgroundProjection();
    const binding = createChromiumLaneBindingV1(lane, projection);
    const request = createApplicationLaneResidencyRequestV1(lane, "reclaimable");

    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      projection,
      request,
      recovery.fidelity,
    );

    expect(plan).toMatchObject({
      decision: { action: "none", reason: "eligibility_unknown" },
      effect: "none",
    });
  });

  it("suppresses browser effects when the recovered ChatGPT graph has a different active root", () => {
    const lane = descriptor();
    const witness = createChatGptLaneWitnessV1(lane, conversation(42, 3), NOW);
    const recovery = assessChatGptLaneRecoveryV1(
      lane,
      witness,
      conversation(99, 3),
      NOW + 1,
    );
    const projection = backgroundProjection();
    const binding = createChromiumLaneBindingV1(lane, projection);
    const request = createApplicationLaneResidencyRequestV1(lane, "responsive");

    const plan = planBoundChromiumResidencyV1(
      lane,
      binding,
      projection,
      request,
      recovery.fidelity,
    );

    expect(recovery).toMatchObject({
      status: "attention_required",
      reason: "anchor_changed",
      fidelity: {
        recovery: "attention_required",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
      },
    });
    expect(plan).toMatchObject({
      decision: { action: "attention_required", reason: "recovery_required" },
      effect: "none",
    });
  });
});
