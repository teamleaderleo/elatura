// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { detectChatGptConversation, validateChatGptConversation } from "../src/index.js";

function fixture() {
  return {
    current_node: "assistant-1",
    mapping: {
      root: { id: "root", parent: null, children: ["user-1"] },
      "user-1": { id: "user-1", parent: "root", children: ["assistant-1"], message: { role: "user" } },
      "assistant-1": { id: "assistant-1", parent: "user-1", children: [], message: { role: "assistant" } },
    },
  };
}

describe("ChatGPT conversation inspection", () => {
  it("detects a candidate by shape", () => {
    expect(detectChatGptConversation(fixture())).toBe(true);
    expect(detectChatGptConversation({ current_node: "x" })).toBe(false);
  });

  it("validates a connected fixture without mutating it", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(true);
    expect(input).toEqual(before);
  });

  it("rejects unresolved children", () => {
    const input = fixture();
    input.mapping.root.children = ["missing"];
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "missing-child")).toBe(true);
  });

  it("rejects a missing current node", () => {
    const input = fixture();
    input.current_node = "missing";
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
  });
});
