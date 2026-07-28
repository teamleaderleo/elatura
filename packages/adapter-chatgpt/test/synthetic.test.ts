// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  corruptActiveCycle,
  corruptMissingChild,
  corruptReciprocalLink,
  generateSyntheticConversation,
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
    expect(validateChatGptConversation(fixture).ok).toBe(true);
    expect(fixture).toEqual(before);
  });

  it("rejects each malformed fixture family", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 10, branchEvery: 2 });
    expect(validateChatGptConversation(corruptMissingChild(fixture)).ok).toBe(false);
    expect(validateChatGptConversation(corruptReciprocalLink(fixture)).ok).toBe(false);
    expect(validateChatGptConversation(corruptActiveCycle(fixture)).ok).toBe(false);
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
    expect(firstFingerprint.adapterVersion).toBe("0.2.0");
    for (const nodeId of Object.keys(first.fixture.mapping).slice(0, 5)) {
      expect(firstFingerprint.shape).not.toContain(nodeId);
    }
  });

  it("changes when a dictionary value gains a structural field", () => {
    const first = validatedFixture({ turnGroups: 8, branchEvery: 2, seed: 11 });
    const changedFixture = structuredClone(first.fixture);
    changedFixture.mapping[changedFixture.current_node]!.schema_probe = { enabled: true };
    const changed = validateChatGptConversation(changedFixture);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(fingerprintChatGptConversation(changed.value).hash).not.toBe(
      fingerprintChatGptConversation(first.conversation).hash,
    );
  });
});
