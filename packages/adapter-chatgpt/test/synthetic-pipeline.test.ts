// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { generateSyntheticConversation } from "@elatura/fixtures";
import { isRecord } from "@elatura/core";
import { runFailOpenPipeline } from "@elatura/core/orchestration";
import { validateChatGptConversation } from "../src/index.js";
import {
  createSyntheticChatGptPipelineAdapter,
  runSyntheticChatGptPipeline,
} from "../src/synthetic.js";

const syntheticOptions = { clock: () => 0, synthetic: true } as const;

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

describe("synthetic ChatGPT transformation laboratory", () => {
  it("materializes a bounded validated snapshot while preserving retained unknown fields", () => {
    const fixture = freezeDeep(generateSyntheticConversation({ turnGroups: 12, branchEvery: 2, seed: 41 }));
    const before = structuredClone(fixture);
    const result = runSyntheticChatGptPipeline(
      fixture,
      { maxGroups: 2 },
      syntheticOptions,
    );

    expect(result.kind).toBe("transformed");
    if (result.kind !== "transformed") return;
    expect(result.authoritativeInput).toBe(fixture);
    expect(fixture).toEqual(before);
    expect(validateChatGptConversation(result.output).ok).toBe(true);
    expect(Object.keys(result.output.mapping).length).toBeLessThan(Object.keys(fixture.mapping).length);
    expect(result.output.future_top_level_field).toEqual(fixture.future_top_level_field);
    expect(result.output.elatura_fixture).toEqual(fixture.elatura_fixture);

    const retainedCurrent = result.output.mapping[fixture.current_node];
    expect(retainedCurrent?.future_node_field).toEqual(fixture.mapping[fixture.current_node]?.future_node_field);
    expect(retainedCurrent?.message).toEqual(fixture.mapping[fixture.current_node]?.message);
    expect(result.output.elatura_snapshot.parentBoundary.kind).toBe("omitted-parent");
    if (result.output.elatura_snapshot.parentBoundary.kind === "omitted-parent") {
      const firstRetained = result.output.elatura_snapshot.parentBoundary.retainedNodeId;
      expect(result.output.mapping[firstRetained]?.parent).toBeNull();
    }

    for (const [nodeId, node] of Object.entries(result.output.mapping)) {
      expect(node.id).toBe(nodeId);
      expect(Array.isArray(node.children)).toBe(true);
      for (const childId of node.children as string[]) {
        expect(result.output.mapping[childId]).toBeDefined();
        expect(result.output.mapping[childId]?.parent).toBe(nodeId);
      }
      if (typeof node.parent === "string") {
        expect(result.output.mapping[node.parent]).toBeDefined();
        expect(result.output.mapping[node.parent]?.children).toContain(nodeId);
      }
    }
  });

  it("is deterministic for the same fixture, policy, budgets, and clock", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 8, branchEvery: 1, seed: 7 });
    const first = runSyntheticChatGptPipeline(fixture, { maxGroups: 3 }, syntheticOptions);
    const second = runSyntheticChatGptPipeline(fixture, { maxGroups: 3 }, syntheticOptions);
    expect(first).toEqual(second);
  });

  it("passes through inputs outside the synthetic fixture contract", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 3 });
    const ordinary = structuredClone(fixture) as Record<string, unknown>;
    delete ordinary.elatura_fixture;
    const missed = runSyntheticChatGptPipeline(ordinary, undefined, syntheticOptions);
    expect(missed.kind).toBe("pass-through");
    expect(missed.outcome.reasonCode).toBe("detect-no-match");
    expect("output" in missed).toBe(false);

    const malformed = structuredClone(fixture) as Record<string, unknown>;
    malformed.elatura_fixture = "malformed";
    const ambiguous = runSyntheticChatGptPipeline(malformed, undefined, syntheticOptions);
    expect(ambiguous.kind).toBe("pass-through");
    expect(ambiguous.outcome.reasonCode).toBe("detect-ambiguous");
    expect("output" in ambiguous).toBe(false);
  });

  it("fails open when the reserved snapshot field is already occupied", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 4 }) as Record<string, unknown>;
    fixture.elatura_snapshot = { applicationOwned: true };
    const result = runSyntheticChatGptPipeline(fixture, { maxGroups: 1 }, syntheticOptions);
    expect(result.kind).toBe("pass-through");
    expect(result.outcome.reasonCode).toBe("materialize-exception");
    expect("output" in result).toBe(false);
  });

  it("fails open on allocation budget exhaustion", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 5, payloadBytesPerMessage: 128 });
    const result = runSyntheticChatGptPipeline(
      fixture,
      { maxGroups: 1 },
      { ...syntheticOptions, budgets: { maxAllocatedBytes: 32 } },
    );
    expect(result.kind).toBe("pass-through");
    expect(result.outcome.reasonCode).toBe("budget-allocation-exceeded");
    expect("output" in result).toBe(false);
  });

  it("withholds a tampered materialization rejected by the independent validator", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 6, branchEvery: 2 });
    const base = createSyntheticChatGptPipelineAdapter({ maxGroups: 2 });
    const tamperingAdapter = {
      ...base,
      materialize: (...args: Parameters<typeof base.materialize>): unknown => {
        const candidate = base.materialize(...args);
        if (!isRecord(candidate) || !isRecord(candidate.mapping)) return candidate;
        const currentNode = candidate.current_node;
        const current = typeof currentNode === "string" ? candidate.mapping[currentNode] : undefined;
        if (isRecord(current)) current.children = ["missing-synthetic-node"];
        return candidate;
      },
    };
    const result = runFailOpenPipeline(fixture, tamperingAdapter, syntheticOptions);
    expect(result.kind).toBe("pass-through");
    expect(result.outcome.reasonCode).toBe("output-invalid");
    expect("output" in result).toBe(false);
  });
});
