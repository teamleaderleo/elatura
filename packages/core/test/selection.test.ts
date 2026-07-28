// SPDX-License-Identifier: MPL-2.0
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planActivePathWindow, traceActivePath, type ParentLinkedNode } from "../src/index.js";

type TestNode = ParentLinkedNode & { group: string };

function branchedGraph(): Record<string, TestNode> {
  return {
    root: { id: "root", parent: null, children: ["a"], group: "root" },
    a: { id: "a", parent: "root", children: ["b"], group: "turn-1" },
    b: { id: "b", parent: "a", children: ["c", "branch"], group: "turn-1" },
    branch: { id: "branch", parent: "b", children: [], group: "turn-2" },
    c: { id: "c", parent: "b", children: ["d"], group: "turn-2" },
    d: { id: "d", parent: "c", children: [], group: "turn-2" },
  };
}

function linearGraph(length: number): Record<string, TestNode> {
  const graph: Record<string, TestNode> = {};
  for (let index = 0; index < length; index += 1) {
    const id = `node-${index}`;
    graph[id] = {
      id,
      parent: index === 0 ? null : `node-${index - 1}`,
      children: index === length - 1 ? [] : [`node-${index + 1}`],
      group: `group-${Math.floor(index / 3)}`,
    };
  }
  return graph;
}

describe("active-path selection planning", () => {
  it("traces a root-to-current path", () => {
    const result = traceActivePath(branchedGraph(), "d");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((node) => node.id)).toEqual(["root", "a", "b", "c", "d"]);
  });

  it("selects recent groups, a root anchor, and branch sibling roots", () => {
    const graph = branchedGraph();
    const before = structuredClone(graph);
    const result = planActivePathWindow(graph, "d", {
      maxGroups: 1,
      groupKey: (node) => node.group,
      includeRoot: true,
      includeSiblingRoots: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.retainedActivePathIds).toEqual(["c", "d"]);
      expect(result.value.selectedIds).toEqual(["branch", "c", "d", "root"]);
      expect(result.value.omittedBoundaryParentId).toBe("b");
      expect(result.value.reasons.branch).toEqual(["branch-sibling"]);
      expect(result.value.reasons.root).toEqual(["root-anchor"]);
    }
    expect(graph).toEqual(before);
  });

  it("rejects invalid bounds and broken active paths", () => {
    expect(planActivePathWindow(branchedGraph(), "d", { maxGroups: 0, groupKey: (node) => node.group }).ok).toBe(false);
    expect(
      planActivePathWindow(branchedGraph(), "d", {
        maxGroups: 1,
        maxSiblingReferences: 0,
        groupKey: (node) => node.group,
      }).ok,
    ).toBe(false);
    expect(traceActivePath(branchedGraph(), "d", { maxActivePathDepth: 0 }).ok).toBe(false);
    const broken = branchedGraph();
    broken.c.parent = "missing";
    expect(traceActivePath(broken, "d").ok).toBe(false);
  });

  it("fails before traversing beyond the active-path depth budget", () => {
    const graph = linearGraph(250);
    const before = structuredClone(graph);
    const result = traceActivePath(graph, "node-249", { maxActivePathDepth: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("active-path-depth-budget-exceeded");
    }
    expect(graph).toEqual(before);
  });

  it("bounds extreme sibling fan-out without mutating the graph", () => {
    const graph: Record<string, TestNode> = {
      root: { id: "root", parent: null, children: ["current"], group: "root" },
      current: { id: "current", parent: "root", children: [], group: "current" },
    };
    for (let index = 0; index < 1_000; index += 1) {
      const id = `sibling-${index}`;
      graph[id] = { id, parent: "root", children: [], group: "sibling" };
      graph.root?.children.push(id);
    }
    const before = structuredClone(graph);
    const result = planActivePathWindow(graph, "current", {
      maxGroups: 1,
      maxSiblingReferences: 128,
      groupKey: (node) => node.group,
      includeSiblingRoots: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("sibling-reference-budget-exceeded");
    }
    expect(graph).toEqual(before);
  });

  it("is invariant to mapping and child-reference ordering", () => {
    const graph = branchedGraph();
    const reordered = Object.fromEntries(
      Object.entries(graph)
        .reverse()
        .map(([id, node]) => [id, { ...node, children: [...node.children].reverse() }]),
    ) as Record<string, TestNode>;
    const options = {
      maxGroups: 2,
      groupKey: (node: TestNode) => node.group,
      includeRoot: true,
      includeSiblingRoots: true,
    };
    expect(planActivePathWindow(graph, "d", options)).toEqual(
      planActivePathWindow(reordered, "d", options),
    );
  });

  it("is deterministic and non-mutating for generated linear graphs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 12 }), (length, groups) => {
        const graph = linearGraph(length);
        const before = structuredClone(graph);
        const options = { maxGroups: groups, groupKey: (node: TestNode) => node.group, includeRoot: true };
        const first = planActivePathWindow(graph, `node-${length - 1}`, options);
        const second = planActivePathWindow(graph, `node-${length - 1}`, options);
        expect(first).toEqual(second);
        expect(graph).toEqual(before);
      }),
    );
  });
});
