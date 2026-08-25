// SPDX-License-Identifier: MPL-2.0

import type { SlimPlaceholderPlan } from "./slim-window.js";

export type SlimDomHost<TNode> = {
  resolveTurn(turnId: string): TNode | null;
  isConnected(node: TNode): boolean;
  previousSibling(node: TNode): TNode | null;
  isPlaceholder(node: TNode): boolean;
  existingPlaceholderCount(): number;
  createPlaceholder(turnCount: number, blockSizePx: number): TNode;
  mergePlaceholder(placeholder: TNode, addedTurns: number, addedBlockSizePx: number): void;
  insertBefore(reference: TNode, placeholder: TNode): void;
  removeTurn(node: TNode): void;
};

export type SlimDomExecutionIssueCode =
  | "invalid-placeholder-budget"
  | "invalid-existing-placeholder-count"
  | "empty-removal-range"
  | "invalid-range-height"
  | "duplicate-turn-id"
  | "unresolved-turn"
  | "disconnected-turn"
  | "duplicate-turn-node"
  | "placeholder-budget-exceeded"
  | "host-preflight-failed"
  | "host-mutation-failed";

export type SlimDomExecutionIssue = {
  code: SlimDomExecutionIssueCode;
  rangeId: string | null;
  turnId: string | null;
  message: string;
};

export type SlimDomExecutionSummary = {
  removedTurnCount: number;
  createdPlaceholderCount: number;
  mergedPlaceholderCount: number;
  placeholderCountBefore: number;
  placeholderCountAfter: number;
};

export type SlimDomExecutionResult =
  | { ok: true; value: SlimDomExecutionSummary; mutationStarted: boolean }
  | { ok: false; issue: SlimDomExecutionIssue; mutationStarted: boolean };

type PreparedRange<TNode> = {
  id: string;
  nodes: TNode[];
  previous: TNode | null;
  mergePrevious: boolean;
  turnCount: number;
  blockSizePx: number;
};

function failure(
  code: SlimDomExecutionIssueCode,
  message: string,
  options: {
    rangeId?: string | null;
    turnId?: string | null;
    mutationStarted?: boolean;
  } = {},
): SlimDomExecutionResult {
  return {
    ok: false,
    issue: {
      code,
      rangeId: options.rangeId ?? null,
      turnId: options.turnId ?? null,
      message,
    },
    mutationStarted: options.mutationStarted ?? false,
  };
}

export function executeSlimDomRemoval<TNode>(
  ranges: readonly SlimPlaceholderPlan[],
  host: SlimDomHost<TNode>,
  maximumPlaceholders: number,
): SlimDomExecutionResult {
  if (!Number.isInteger(maximumPlaceholders) || maximumPlaceholders < 0) {
    return failure(
      "invalid-placeholder-budget",
      "maximumPlaceholders must be a non-negative integer.",
    );
  }

  let placeholderCountBefore: number;
  const prepared: PreparedRange<TNode>[] = [];
  const seenTurnIds = new Set<string>();
  const seenNodes = new Set<TNode>();
  let createdPlaceholderCount = 0;

  try {
    placeholderCountBefore = host.existingPlaceholderCount();
    if (!Number.isInteger(placeholderCountBefore) || placeholderCountBefore < 0) {
      return failure(
        "invalid-existing-placeholder-count",
        "The host returned an invalid existing placeholder count.",
      );
    }

    for (const range of ranges) {
      if (range.turnIds.length === 0) {
        return failure("empty-removal-range", "A removal range must contain at least one turn.", {
          rangeId: range.id,
        });
      }
      if (!Number.isFinite(range.estimatedBlockSizePx) || range.estimatedBlockSizePx <= 0) {
        return failure("invalid-range-height", "A removal range must have a positive finite height.", {
          rangeId: range.id,
        });
      }

      const nodes: TNode[] = [];
      for (const turnId of range.turnIds) {
        if (seenTurnIds.has(turnId)) {
          return failure("duplicate-turn-id", "A turn id appears in more than one removal slot.", {
            rangeId: range.id,
            turnId,
          });
        }
        seenTurnIds.add(turnId);
        const node = host.resolveTurn(turnId);
        if (node === null) {
          return failure("unresolved-turn", "A planned turn could not be resolved.", {
            rangeId: range.id,
            turnId,
          });
        }
        if (!host.isConnected(node)) {
          return failure("disconnected-turn", "A planned turn is no longer connected.", {
            rangeId: range.id,
            turnId,
          });
        }
        if (seenNodes.has(node)) {
          return failure("duplicate-turn-node", "Multiple turn ids resolved to the same node.", {
            rangeId: range.id,
            turnId,
          });
        }
        seenNodes.add(node);
        nodes.push(node);
      }

      const first = nodes[0];
      if (first === undefined) {
        return failure("empty-removal-range", "A removal range resolved to no nodes.", {
          rangeId: range.id,
        });
      }
      const previous = host.previousSibling(first);
      const mergePrevious = previous !== null && host.isPlaceholder(previous);
      if (!mergePrevious) createdPlaceholderCount += 1;
      prepared.push({
        id: range.id,
        nodes,
        previous,
        mergePrevious,
        turnCount: nodes.length,
        blockSizePx: range.estimatedBlockSizePx,
      });
    }
  } catch {
    return failure("host-preflight-failed", "The host failed during removal preflight.");
  }

  const placeholderCountAfter = placeholderCountBefore + createdPlaceholderCount;
  if (placeholderCountAfter > maximumPlaceholders) {
    return failure(
      "placeholder-budget-exceeded",
      "The planned operation would exceed the placeholder budget.",
    );
  }

  let mutationStarted = false;
  let removedTurnCount = 0;
  let mergedPlaceholderCount = 0;
  try {
    for (const range of prepared) {
      const first = range.nodes[0];
      if (first === undefined) {
        return failure("empty-removal-range", "A prepared range lost its first node.", {
          rangeId: range.id,
          mutationStarted,
        });
      }
      if (range.mergePrevious && range.previous !== null) {
        mutationStarted = true;
        host.mergePlaceholder(range.previous, range.turnCount, range.blockSizePx);
        mergedPlaceholderCount += 1;
      } else {
        const placeholder = host.createPlaceholder(range.turnCount, range.blockSizePx);
        mutationStarted = true;
        host.insertBefore(first, placeholder);
      }
      for (const node of range.nodes) {
        mutationStarted = true;
        host.removeTurn(node);
        removedTurnCount += 1;
      }
    }
  } catch {
    return failure("host-mutation-failed", "The host failed after DOM mutation began.", {
      mutationStarted,
    });
  }

  return {
    ok: true,
    value: {
      removedTurnCount,
      createdPlaceholderCount,
      mergedPlaceholderCount,
      placeholderCountBefore,
      placeholderCountAfter,
    },
    mutationStarted,
  };
}
