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
    const broken = branchedGraph();
    broken.c.parent = "missing";
    expect(traceActivePath(broken, "d").ok).toBe(false);
  });

  it("is deterministic and non-mutating for generated linear graphs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 12 }), (length, groups) => {
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
