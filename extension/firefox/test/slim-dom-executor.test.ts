// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  executeSlimDomRemoval,
  type SlimDomHost,
} from "../src/slim-dom-executor.js";
import type { SlimPlaceholderPlan } from "../src/slim-window.js";

type FakeNode = {
  id: string;
  connected: boolean;
  placeholder: boolean;
  previousId: string | null;
  hiddenTurns: number;
  blockSizePx: number;
};

class FakeHost implements SlimDomHost<FakeNode> {
  readonly nodes = new Map<string, FakeNode>();
  readonly turnMap = new Map<string, string>();
  readonly mutations: string[] = [];
  throwOnMutation: "merge" | "insert" | "remove" | null = null;
  private nextPlaceholder = 1;

  addNode(node: Partial<FakeNode> & { id: string }): FakeNode {
    const complete: FakeNode = {
      id: node.id,
      connected: node.connected ?? true,
      placeholder: node.placeholder ?? false,
      previousId: node.previousId ?? null,
      hiddenTurns: node.hiddenTurns ?? 0,
      blockSizePx: node.blockSizePx ?? 0,
    };
    this.nodes.set(complete.id, complete);
    return complete;
  }

  mapTurn(turnId: string, nodeId: string): void {
    this.turnMap.set(turnId, nodeId);
  }

  resolveTurn(turnId: string): FakeNode | null {
    const nodeId = this.turnMap.get(turnId);
    return nodeId ? (this.nodes.get(nodeId) ?? null) : null;
  }

  isConnected(node: FakeNode): boolean {
    return node.connected;
  }

  previousSibling(node: FakeNode): FakeNode | null {
    return node.previousId ? (this.nodes.get(node.previousId) ?? null) : null;
  }

  isPlaceholder(node: FakeNode): boolean {
    return node.placeholder;
  }

  existingPlaceholderCount(): number {
    return [...this.nodes.values()].filter((node) => node.connected && node.placeholder).length;
  }

  createPlaceholder(turnCount: number, blockSizePx: number): FakeNode {
    return {
      id: `new-placeholder-${this.nextPlaceholder++}`,
      connected: false,
      placeholder: true,
      previousId: null,
      hiddenTurns: turnCount,
      blockSizePx,
    };
  }

  mergePlaceholder(placeholder: FakeNode, addedTurns: number, addedBlockSizePx: number): void {
    this.mutations.push(`merge:${placeholder.id}:${addedTurns}:${addedBlockSizePx}`);
    if (this.throwOnMutation === "merge") throw new Error("merge failed");
    placeholder.hiddenTurns += addedTurns;
    placeholder.blockSizePx += addedBlockSizePx;
  }

  insertBefore(reference: FakeNode, placeholder: FakeNode): void {
    this.mutations.push(`insert:${placeholder.id}:before:${reference.id}`);
    if (this.throwOnMutation === "insert") throw new Error("insert failed");
    placeholder.connected = true;
    placeholder.previousId = reference.previousId;
    reference.previousId = placeholder.id;
    this.nodes.set(placeholder.id, placeholder);
  }

  removeTurn(node: FakeNode): void {
    this.mutations.push(`remove:${node.id}`);
    if (this.throwOnMutation === "remove") throw new Error("remove failed");
    node.connected = false;
  }
}

function range(
  id: string,
  turnIds: string[],
  estimatedBlockSizePx = 400,
): SlimPlaceholderPlan {
  return {
    id,
    turnIds,
    estimatedBlockSizePx,
    insertBeforeId: null,
  };
}

function hostWithTurns(turnIds: string[]): FakeHost {
  const host = new FakeHost();
  let previousId: string | null = null;
  for (const turnId of turnIds) {
    const node = host.addNode({ id: `node-${turnId}`, previousId });
    host.mapTurn(turnId, node.id);
    previousId = node.id;
  }
  return host;
}

describe("slim DOM executor", () => {
  it("preflights every range before the first mutation", () => {
    const host = hostWithTurns(["turn-1", "turn-2"]);
    const result = executeSlimDomRemoval(
      [range("range-1", ["turn-1"]), range("range-2", ["missing-turn"])],
      host,
      8,
    );

    expect(result).toMatchObject({
      ok: false,
      issue: { code: "unresolved-turn", rangeId: "range-2", turnId: "missing-turn" },
      mutationStarted: false,
    });
    expect(host.mutations).toEqual([]);
    expect(host.resolveTurn("turn-1")?.connected).toBe(true);
  });

  it("creates one placeholder and removes the complete prepared range", () => {
    const host = hostWithTurns(["turn-1", "turn-2", "turn-3"]);
    const result = executeSlimDomRemoval([range("range-1", ["turn-1", "turn-2"], 700)], host, 8);

    expect(result).toEqual({
      ok: true,
      value: {
        removedTurnCount: 2,
        createdPlaceholderCount: 1,
        mergedPlaceholderCount: 0,
        placeholderCountBefore: 0,
        placeholderCountAfter: 1,
      },
      mutationStarted: true,
    });
    expect(host.mutations).toEqual([
      "insert:new-placeholder-1:before:node-turn-1",
      "remove:node-turn-1",
      "remove:node-turn-2",
    ]);
    expect(host.existingPlaceholderCount()).toBe(1);
  });

  it("merges into an existing adjacent placeholder without creating another", () => {
    const host = hostWithTurns(["turn-1", "turn-2"]);
    const placeholder = host.addNode({
      id: "placeholder-1",
      placeholder: true,
      hiddenTurns: 3,
      blockSizePx: 900,
    });
    const first = host.resolveTurn("turn-1");
    if (!first) throw new Error("fixture missing first turn");
    first.previousId = placeholder.id;

    const result = executeSlimDomRemoval([range("range-1", ["turn-1", "turn-2"], 500)], host, 8);

    expect(result).toMatchObject({
      ok: true,
      value: {
        removedTurnCount: 2,
        createdPlaceholderCount: 0,
        mergedPlaceholderCount: 1,
        placeholderCountBefore: 1,
        placeholderCountAfter: 1,
      },
    });
    expect(placeholder.hiddenTurns).toBe(5);
    expect(placeholder.blockSizePx).toBe(1400);
  });

  it("rejects duplicate ids, duplicate nodes, and disconnected nodes before mutation", () => {
    const duplicateIdHost = hostWithTurns(["turn-1"]);
    expect(
      executeSlimDomRemoval(
        [range("range-1", ["turn-1"]), range("range-2", ["turn-1"])],
        duplicateIdHost,
        8,
      ),
    ).toMatchObject({ ok: false, issue: { code: "duplicate-turn-id" }, mutationStarted: false });
    expect(duplicateIdHost.mutations).toEqual([]);

    const duplicateNodeHost = hostWithTurns(["turn-1"]);
    duplicateNodeHost.mapTurn("turn-2", "node-turn-1");
    expect(
      executeSlimDomRemoval([range("range-1", ["turn-1", "turn-2"])], duplicateNodeHost, 8),
    ).toMatchObject({ ok: false, issue: { code: "duplicate-turn-node" }, mutationStarted: false });
    expect(duplicateNodeHost.mutations).toEqual([]);

    const disconnectedHost = hostWithTurns(["turn-1"]);
    const disconnected = disconnectedHost.resolveTurn("turn-1");
    if (!disconnected) throw new Error("fixture missing turn");
    disconnected.connected = false;
    expect(
      executeSlimDomRemoval([range("range-1", ["turn-1"])], disconnectedHost, 8),
    ).toMatchObject({ ok: false, issue: { code: "disconnected-turn" }, mutationStarted: false });
    expect(disconnectedHost.mutations).toEqual([]);
  });

  it("rejects placeholder budget overflow before mutation", () => {
    const host = hostWithTurns(["turn-1"]);
    host.addNode({ id: "placeholder-1", placeholder: true });
    const result = executeSlimDomRemoval([range("range-1", ["turn-1"])], host, 1);

    expect(result).toMatchObject({
      ok: false,
      issue: { code: "placeholder-budget-exceeded" },
      mutationStarted: false,
    });
    expect(host.mutations).toEqual([]);
  });

  it("reports partial host mutation so the controller can force a Stock reload", () => {
    const host = hostWithTurns(["turn-1", "turn-2"]);
    host.throwOnMutation = "remove";
    const result = executeSlimDomRemoval([range("range-1", ["turn-1", "turn-2"])], host, 8);

    expect(result).toMatchObject({
      ok: false,
      issue: { code: "host-mutation-failed" },
      mutationStarted: true,
    });
    expect(host.mutations).toEqual([
      "insert:new-placeholder-1:before:node-turn-1",
      "remove:node-turn-1",
    ]);
  });

  it("validates range and host budgets", () => {
    const host = hostWithTurns(["turn-1"]);
    expect(executeSlimDomRemoval([], host, -1)).toMatchObject({
      ok: false,
      issue: { code: "invalid-placeholder-budget" },
    });
    expect(executeSlimDomRemoval([range("range-1", [])], host, 8)).toMatchObject({
      ok: false,
      issue: { code: "empty-removal-range" },
    });
    expect(executeSlimDomRemoval([range("range-1", ["turn-1"], 0)], host, 8)).toMatchObject({
      ok: false,
      issue: { code: "invalid-range-height" },
    });
  });
});
