// SPDX-License-Identifier: MPL-2.0
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectChatGptConversation, validateChatGptConversation } from "../src/index.js";

function fixture() {
  return {
    current_node: "assistant-1",
    mapping: {
      root: { id: "root", parent: null, children: ["user-1"], future: { retained: true } },
      "user-1": { id: "user-1", parent: "root", children: ["assistant-1"], message: { role: "user" } },
      "assistant-1": { id: "assistant-1", parent: "user-1", children: [], message: { role: "assistant" } },
    },
    future_top_level: { retained: true },
  };
}

function issueCodes(result: ReturnType<typeof validateChatGptConversation>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function malformedFixture() {
  const input = fixture() as unknown as {
    current_node: string;
    mapping: Record<string, Record<string, unknown>>;
  };
  input.mapping.root = {
    id: "wrong-root",
    parent: 42,
    children: ["user-1", "user-1", 7],
  };
  input.mapping["user-1"] = {
    id: "user-1",
    parent: "missing",
    children: ["assistant-1"],
  };
  return input;
}

describe("ChatGPT conversation inspection", () => {
  it("detects a candidate by shape", () => {
    expect(detectChatGptConversation(fixture())).toBe(true);
    expect(detectChatGptConversation({ current_node: "x" })).toBe(false);
  });

  it("validates a connected fixture without mutation and preserves raw unknown fields", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.raw).toBe(input);
      expect(result.value.mapping.root?.raw).toBe(input.mapping.root);
      expect(result.value.raw.future_top_level).toEqual({ retained: true });
      expect(result.value.mapping.root?.raw.future).toEqual({ retained: true });
      expect(Object.keys(result.value.mapping)).toEqual(["assistant-1", "root", "user-1"]);
    }
    expect(input).toEqual(before);
  });

  it("accepts disconnected acyclic components while validating their links", () => {
    const input = fixture();
    const extended = {
      ...input,
      mapping: {
        ...input.mapping,
        detached: { id: "detached", parent: null, children: [] },
      },
    };
    expect(validateChatGptConversation(extended).ok).toBe(true);
  });

  it("rejects unresolved children", () => {
    const input = fixture();
    input.mapping.root.children = ["missing"];
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("missing-child");
  });

  it("rejects cycles on the active path", () => {
    const input = fixture();
    input.mapping.root.parent = "assistant-1" as never;
    input.mapping["assistant-1"].children = ["root"];
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("active-path-cycle");
    expect(issueCodes(result)).toContain("graph-cycle");
  });

  it("rejects cycles inside disconnected components", () => {
    const input = fixture();
    const extended = {
      ...input,
      mapping: {
        ...input.mapping,
        detachedA: { id: "detachedA", parent: "detachedB", children: ["detachedB"] },
        detachedB: { id: "detachedB", parent: "detachedA", children: ["detachedA"] },
      },
    };
    const result = validateChatGptConversation(extended);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("graph-cycle");
  });

  it("rejects inconsistent parent and child links", () => {
    const input = fixture();
    input.mapping.root.children = [];
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("parent-child-mismatch");
  });

  it("rejects missing, mismatched, and empty node ids", () => {
    const missing = fixture() as unknown as { mapping: Record<string, Record<string, unknown>> };
    delete missing.mapping.root?.id;
    expect(issueCodes(validateChatGptConversation(missing))).toContain("invalid-node-id");

    const mismatched = fixture();
    mismatched.mapping.root.id = "different";
    expect(issueCodes(validateChatGptConversation(mismatched))).toContain("node-id-mismatch");

    const empty = fixture();
    empty.mapping.root.id = "";
    expect(issueCodes(validateChatGptConversation(empty))).toContain("invalid-node-id");
  });

  it("rejects malformed parents and child arrays without silently filtering them", () => {
    const input = fixture() as unknown as { mapping: Record<string, Record<string, unknown>> };
    input.mapping.root = {
      id: "root",
      parent: 42,
      children: ["user-1", "user-1", 7, ""],
    };
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("invalid-parent");
    expect(issueCodes(result)).toContain("duplicate-child-reference");
    expect(issueCodes(result)).toContain("invalid-child-reference");
  });

  it("returns deterministic issues across adversarial mapping-key ordering", () => {
    const first = malformedFixture();
    const second = {
      ...first,
      mapping: Object.fromEntries(Object.entries(first.mapping).reverse()),
    };
    const firstResult = validateChatGptConversation(first, { maxIssues: 32 });
    const secondResult = validateChatGptConversation(second, { maxIssues: 32 });
    expect(firstResult.ok).toBe(false);
    expect(secondResult.ok).toBe(false);
    if (!firstResult.ok && !secondResult.ok) expect(firstResult.issues).toEqual(secondResult.issues);
  });

  it("bounds graph nodes, edges, active depth, and reported issues", () => {
    expect(issueCodes(validateChatGptConversation(fixture(), { maxNodes: 2 }))).toEqual([
      "graph-node-budget-exceeded",
    ]);
    expect(issueCodes(validateChatGptConversation(fixture(), { maxEdges: 1 }))).toEqual([
      "graph-edge-budget-exceeded",
    ]);
    expect(issueCodes(validateChatGptConversation(fixture(), { maxActivePathDepth: 2 }))).toContain(
      "active-path-depth-budget-exceeded",
    );

    const limited = validateChatGptConversation(malformedFixture(), { maxIssues: 2 });
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.issues).toHaveLength(2);
      expect(limited.issues.map((issue) => issue.code)).toContain(
        "validation-issue-budget-exceeded",
      );
    }
  });

  it("rejects invalid validation limits", () => {
    const result = validateChatGptConversation(fixture(), { maxNodes: 0, maxIssues: -1 });
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toEqual(["invalid-max-issues", "invalid-max-nodes"]);
  });

  it("validates generated linear graphs without mutation", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (length) => {
        const mapping: Record<string, { id: string; parent: string | null; children: string[] }> = {};
        for (let index = 0; index < length; index += 1) {
          const id = `node-${index}`;
          const parent = index === 0 ? null : `node-${index - 1}`;
          const children = index === length - 1 ? [] : [`node-${index + 1}`];
          mapping[id] = { id, parent, children };
        }
        const input = { current_node: `node-${length - 1}`, mapping };
        const before = structuredClone(input);
        expect(validateChatGptConversation(input).ok).toBe(true);
        expect(input).toEqual(before);
      }),
    );
  });

  it("rejects a missing current node", () => {
    const input = fixture();
    input.current_node = "missing";
    const result = validateChatGptConversation(input);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("current-node-not-found");
  });
});
