// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { generateSyntheticConversation } from "@elatura/fixtures";
import {
  CHATGPT_ADAPTER_ID,
  CHATGPT_ADAPTER_VERSION,
} from "../src/identities.js";
import { validateChatGptConversation } from "../src/index.js";
import {
  assessChatGptLaneActivityV1,
  parseChatGptLaneActivityObservationV1,
  type ChatGptLaneActivityObservationV1,
} from "../src/lane-activity.js";
import {
  assessChatGptLaneRecoveryV1,
  createChatGptLaneWitnessV1,
} from "../src/lane-witness.js";

const NOW = 1_000_000;

function descriptor(generation = 7) {
  return {
    version: 1 as const,
    laneRef: "elatura:lane:chat-activity",
    generation,
    adapter: { id: CHATGPT_ADAPTER_ID, version: CHATGPT_ADAPTER_VERSION },
    capabilities: ["events", "observe", "activate", "screenshot"] as const,
    state: "active" as const,
    observedAt: "2026-08-27T00:00:00.000Z",
  };
}

function validatedConversation(seed = 42) {
  const validated = validateChatGptConversation(
    generateSyntheticConversation({
      seed,
      turnGroups: 3,
      payloadBytesPerMessage: 32,
      includeUnknownFields: true,
    }),
  );
  if (!validated.ok) throw new Error("Synthetic ChatGPT fixture failed validation");
  return validated.value;
}

function verifiedRecovery() {
  const lane = descriptor();
  const source = validatedConversation();
  const witness = createChatGptLaneWitnessV1(lane, source, NOW - 100);
  return assessChatGptLaneRecoveryV1(lane, witness, source, NOW - 50);
}

function activity(
  overrides: Partial<ChatGptLaneActivityObservationV1> = {},
): ChatGptLaneActivityObservationV1 {
  return {
    version: 1,
    laneRef: descriptor().laneRef,
    laneGeneration: descriptor().generation,
    observedAtMs: NOW,
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

describe("ChatGPT lane activity admission", () => {
  it("accepts one exact content-free observation", () => {
    const parsed = parseChatGptLaneActivityObservationV1(activity());
    expect(parsed).toEqual(activity());
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("rejects unknown fields and authority claims", () => {
    expect(() => parseChatGptLaneActivityObservationV1({
      ...activity(),
      transcript: "private",
    })).toThrow("observation is invalid");
    expect(() => parseChatGptLaneActivityObservationV1({
      ...activity(),
      grantsWorkAuthority: true,
    })).toThrow("zero work authority");
  });

  it("rejects accessors without invoking them", () => {
    let reads = 0;
    const hostile = { ...activity() } as Record<string, unknown>;
    Object.defineProperty(hostile, "generation", {
      enumerable: true,
      get() {
        reads += 1;
        return "inactive";
      },
    });

    expect(() => parseChatGptLaneActivityObservationV1(hostile)).toThrow(
      "observation is invalid",
    );
    expect(reads).toBe(0);
  });
});

describe("ChatGPT lane transition safety", () => {
  it("earns resident freeze from exact fresh idle state while keeping discard unknown", () => {
    const result = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity(),
      NOW + 100,
    );

    expect(result).toMatchObject({
      status: "clear",
      reason: "idle_exact",
      fidelity: {
        recovery: "verified",
        freezeEligibility: "allowed",
        discardEligibility: "unknown",
        blockers: [],
      },
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  });

  it.each([
    ["generation", "active", "active_generation"],
    ["composer", "dirty", "unsaved_interaction"],
    ["composition", "active", "composition_active"],
    ["modal", "active", "modal_interaction"],
    ["mediaOrDevice", "active", "media_or_device_active"],
    ["download", "active", "download_active"],
    ["otherTransient", "active", "application_unknown"],
  ] as const)("maps %s activity to %s", (field, value, blocker) => {
    const result = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity({ [field]: value }),
      NOW + 100,
    );

    expect(result).toMatchObject({
      status: "blocked",
      reason: "active_blocker",
      fidelity: {
        recovery: "verified",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
      },
    });
    expect(result.fidelity.blockers).toContain(blocker);
  });

  it("keeps weak or partially unknown observations conservative", () => {
    const probable = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity({ confidence: "probable" }),
      NOW + 100,
    );
    const unknown = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity({ composition: "unknown" }),
      NOW + 100,
    );

    expect(probable).toMatchObject({
      status: "unknown",
      reason: "weak_confidence",
      fidelity: {
        freezeEligibility: "unknown",
        discardEligibility: "unknown",
        blockers: ["application_unknown"],
      },
    });
    expect(unknown).toMatchObject({
      status: "unknown",
      reason: "unknown_activity",
      fidelity: {
        freezeEligibility: "unknown",
        discardEligibility: "unknown",
        blockers: ["application_unknown"],
      },
    });
  });

  it("expires stale observations and rejects future observations", () => {
    const stale = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity({ observedAtMs: NOW - 5_001 }),
      NOW,
      5_000,
    );
    const future = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity({ observedAtMs: NOW + 1 }),
      NOW,
    );

    expect(stale).toMatchObject({ status: "stale", reason: "stale_activity" });
    expect(future).toMatchObject({ status: "unknown", reason: "future_activity" });
    expect(stale.fidelity.discardEligibility).toBe("unknown");
    expect(future.fidelity.discardEligibility).toBe("unknown");
  });

  it("blocks a mismatched lane generation without weakening verified recovery identity", () => {
    const result = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity({ laneGeneration: 8 }),
      NOW + 100,
    );

    expect(result).toMatchObject({
      status: "mismatched",
      reason: "generation_mismatch",
      fidelity: {
        recovery: "verified",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
        blockers: ["application_unknown"],
      },
    });
  });

  it("preserves recovery failure as the stronger gate", () => {
    const lane = descriptor();
    const source = validatedConversation(42);
    const witness = createChatGptLaneWitnessV1(lane, source, NOW - 100);
    const failedRecovery = assessChatGptLaneRecoveryV1(
      lane,
      witness,
      validatedConversation(99),
      NOW - 50,
    );

    const result = assessChatGptLaneActivityV1(
      lane,
      failedRecovery,
      activity(),
      NOW + 100,
    );

    expect(result).toMatchObject({
      status: "recovery_required",
      reason: "recovery_unverified",
      fidelity: {
        recovery: "attention_required",
        freezeEligibility: "blocked",
        discardEligibility: "blocked",
      },
    });
  });

  it("never upgrades destructive discard eligibility in protocol v1", () => {
    const result = assessChatGptLaneActivityV1(
      descriptor(),
      verifiedRecovery(),
      activity(),
      NOW + 1,
    );
    expect(result.fidelity.freezeEligibility).toBe("allowed");
    expect(result.fidelity.discardEligibility).toBe("unknown");
  });
});
