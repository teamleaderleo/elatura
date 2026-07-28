// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  corruptActiveCycle,
  corruptDisconnectedCycle,
  corruptDuplicateChild,
  corruptMalformedRoot,
  corruptMissingChild,
  corruptNodeIdMismatch,
  corruptReciprocalLink,
  generateSyntheticConversation,
  reorderSyntheticConversationKeys,
} from "@elatura/fixtures";
import { fingerprintChatGptConversation, validateChatGptConversation } from "../src/index.js";

function validatedFixture(options: Parameters<typeof generateSyntheticConversation>[0]) {
  const fixture = generateSyntheticConversation(options);
  const result = validateChatGptConversation(fixture);
  if (!result.ok) throw new Error("Synthetic fixture unexpectedly failed validation.");
  return { fixture, conversation: result.value };
}

describe("synthetic adapter compatibility", () => {
  it("validates large branched synthetic graphs without mutation", () => {
    const fixture = generateSyntheticConversation({
      turnGroups: 250,
      branchEvery: 7,
      hiddenNodesPerTurn: 2,
      payloadBytesPerMessage: 64,
      seed: 2026,
    });
    const before = structuredClone(fixture);
    const result = validateChatGptConversation(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.raw).toBe(fixture);
      expect(result.value.raw.future_top_level_field).toEqual(fixture.future_top_level_field);
      const firstId = Object.keys(fixture.mapping)[0];
      if (firstId) expect(result.value.mapping[firstId]?.raw).toBe(fixture.mapping[firstId]);
    }
    expect(fixture).toEqual(before);
  });

  it("rejects every malformed fixture family", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 10, branchEvery: 2 });
    const malformed = [
      corruptMissingChild(fixture),
      corruptReciprocalLink(fixture),
      corruptActiveCycle(fixture),
      corruptDuplicateChild(fixture),
      corruptNodeIdMismatch(fixture),
      corruptDisconnectedCycle(fixture),
      corruptMalformedRoot(fixture),
    ];
    for (const candidate of malformed) expect(validateChatGptConversation(candidate).ok).toBe(false);
  });

  it("validates and fingerprints adversarial key ordering identically", () => {
    const fixture = generateSyntheticConversation({
      turnGroups: 40,
      branchEvery: 3,
      hiddenNodesPerTurn: 2,
      payloadBytesPerMessage: 48,
      seed: 77,
    });
    const reordered = reorderSyntheticConversationKeys(fixture);
    const first = validateChatGptConversation(fixture);
    const second = validateChatGptConversation(reordered);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Object.keys(first.value.mapping)).toEqual(Object.keys(second.value.mapping));
    expect(fingerprintChatGptConversation(first.value)).toEqual(
      fingerprintChatGptConversation(second.value),
    );
  });

  it("fingerprints schema shape without leaking or depending on dynamic node IDs", () => {
    const first = validatedFixture({
      turnGroups: 20,
      branchEvery: 4,
      hiddenNodesPerTurn: 1,
      payloadBytesPerMessage: 32,
      seed: 1,
    });
    const second = validatedFixture({
      turnGroups: 20,
      branchEvery: 4,
      hiddenNodesPerTurn: 1,
      payloadBytesPerMessage: 512,
      seed: 999,
    });
    const firstFingerprint = fingerprintChatGptConversation(first.conversation);
    const secondFingerprint = fingerprintChatGptConversation(second.conversation);
    expect(firstFingerprint).toEqual(secondFingerprint);
    expect(firstFingerprint.adapterVersion).toBe("0.3.0");
    for (const nodeId of Object.keys(first.fixture.mapping).slice(0, 5)) {
      expect(firstFingerprint.shape).not.toContain(nodeId);
    }
  });

  it("changes when a dictionary value gains a structural field", () => {
    const first = validatedFixture({ turnGroups: 8, branchEvery: 2, seed: 11 });
    const changedFixture = structuredClone(first.fixture) as typeof first.fixture & {
      mapping: Record<string, (typeof first.fixture.mapping)[string] & { schema_probe?: unknown }>;
    };
    changedFixture.mapping[changedFixture.current_node]!.schema_probe = { enabled: true };
    const changed = validateChatGptConversation(changedFixture);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(fingerprintChatGptConversation(changed.value).hash).not.toBe(
      fingerprintChatGptConversation(first.conversation).hash,
    );
  });
});
