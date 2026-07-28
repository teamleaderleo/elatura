// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  corruptActiveCycle,
  corruptMissingChild,
  corruptReciprocalLink,
  generateSyntheticConversation,
} from "../src/index.js";

describe("synthetic conversation fixtures", () => {
  it("is deterministic for a seed and preserves configurable unknown fields", () => {
    const options = {
      turnGroups: 6,
      branchEvery: 2,
      hiddenNodesPerTurn: 1,
      payloadBytesPerMessage: 32,
      seed: 42,
    };
    const first = generateSyntheticConversation(options);
    const second = generateSyntheticConversation(options);
    expect(first).toEqual(second);
    expect(first.future_top_level_field).toBeDefined();
    expect(Object.values(first.mapping).some((node) => node.future_node_field)).toBe(true);
    expect(Object.keys(first.mapping)).toHaveLength(1 + 6 * 3 + 3);
  });

  it("creates reciprocal parent-child links", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 20, branchEvery: 3, hiddenNodesPerTurn: 2 });
    for (const node of Object.values(fixture.mapping)) {
      if (node.parent !== null) expect(fixture.mapping[node.parent]?.children).toContain(node.id);
      for (const child of node.children) expect(fixture.mapping[child]?.parent).toBe(node.id);
    }
  });

  it("does not mutate a source while creating malformed variants", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 3, seed: 9 });
    const before = structuredClone(fixture);
    expect(corruptMissingChild(fixture)).not.toEqual(fixture);
    expect(corruptReciprocalLink(fixture)).not.toEqual(fixture);
    expect(corruptActiveCycle(fixture)).not.toEqual(fixture);
    expect(fixture).toEqual(before);
  });

  it("rejects unsafe generation bounds", () => {
    expect(() => generateSyntheticConversation({ turnGroups: 0 })).toThrow(/turnGroups/);
    expect(() => generateSyntheticConversation({ seed: -1 })).toThrow(/seed/);
    expect(() => generateSyntheticConversation({ payloadBytesPerMessage: 1_000_001 })).toThrow(/payloadBytesPerMessage/);
    expect(() =>
      generateSyntheticConversation({ turnGroups: 100_000, payloadBytesPerMessage: 1_000_000 }),
    ).toThrow(/safety limit/);
  });
});
