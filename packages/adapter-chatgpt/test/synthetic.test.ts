// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  corruptActiveCycle,
  corruptMissingChild,
  corruptReciprocalLink,
  generateSyntheticConversation,
} from "@elatura/fixtures";
import { validateChatGptConversation } from "../src/index.js";

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
});
