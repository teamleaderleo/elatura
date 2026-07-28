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

  it("creates deterministic malformed families without mutating a source", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 3, branchEvery: 1, seed: 9 });
    const before = structuredClone(fixture);
    const corruptors = [
      corruptMissingChild,
      corruptReciprocalLink,
      corruptActiveCycle,
      corruptDuplicateChild,
      corruptNodeIdMismatch,
      corruptDisconnectedCycle,
      corruptMalformedRoot,
    ];
    for (const corrupt of corruptors) {
      expect(corrupt(fixture)).toEqual(corrupt(fixture));
      expect(corrupt(fixture)).not.toEqual(fixture);
    }
    expect(fixture).toEqual(before);
  });

  it("seeds duplicate references and disconnected cycles explicitly", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 2, seed: 18 });
    const duplicate = corruptDuplicateChild(fixture);
    expect(
      Object.values(duplicate.mapping).some(
        (node) => new Set(node.children).size !== node.children.length,
      ),
    ).toBe(true);

    const disconnected = corruptDisconnectedCycle(fixture);
    expect(Object.keys(disconnected.mapping)).toHaveLength(Object.keys(fixture.mapping).length + 2);
    expect(disconnected.current_node).toBe(fixture.current_node);
    const added = Object.keys(disconnected.mapping).filter((id) => !fixture.mapping[id]);
    expect(added).toHaveLength(2);
    const [first, second] = added;
    if (!first || !second) throw new Error("Expected two disconnected cycle nodes.");
    expect(disconnected.mapping[first]?.parent).toBe(second);
    expect(disconnected.mapping[second]?.parent).toBe(first);
  });

  it("reorders top-level, mapping, and node keys without changing values", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 5, branchEvery: 2, seed: 91 });
    const before = structuredClone(fixture);
    const reordered = reorderSyntheticConversationKeys(fixture);
    expect(reordered).toEqual(fixture);
    expect(Object.keys(reordered.mapping)).toEqual(Object.keys(fixture.mapping).reverse());
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(fixture));
    expect(fixture).toEqual(before);
  });

  it("rejects unsafe generation bounds", () => {
    expect(() => generateSyntheticConversation({ turnGroups: 0 })).toThrow(/turnGroups/);
    expect(() => generateSyntheticConversation({ seed: -1 })).toThrow(/seed/);
    expect(() => generateSyntheticConversation({ payloadBytesPerMessage: 1_000_001 })).toThrow(/payloadBytesPerMessage/);
    expect(() =>
      generateSyntheticConversation({
        turnGroups: 100_000,
        hiddenNodesPerTurn: 100,
        payloadBytesPerMessage: 0,
      }),
    ).toThrow(/node safety limit/);
    expect(() =>
      generateSyntheticConversation({ turnGroups: 100_000, payloadBytesPerMessage: 1_000_000 }),
    ).toThrow(/safety limit/);
  });
});
