// SPDX-License-Identifier: MPL-2.0

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

export type WindowPolicy = {
  turnGroups: number;
  includeBranchSiblings: boolean;
};

export type StructuralFingerprint = {
  adapter: string;
  adapterVersion: string;
  shape: string;
  hash: string;
};

export interface Adapter<TSource, TSnapshot> {
  readonly id: string;
  readonly version: string;
  detect(input: unknown): boolean;
  validate(input: unknown): ValidationResult<TSource>;
  fingerprint(source: TSource): StructuralFingerprint;
  window(source: TSource, policy: WindowPolicy): ValidationResult<TSnapshot>;
  validateSnapshot(snapshot: unknown): ValidationResult<TSnapshot>;
}

export type ParentLinkedNode = {
  id: string;
  parent: string | null;
  children: readonly string[];
};

export type SelectionReason = "active-window" | "root-anchor" | "branch-sibling";

export type ActivePathGroup = {
  key: string;
  nodeIds: string[];
  retained: boolean;
};

export type ActivePathSelectionPlan = {
  currentNode: string;
  activePathIds: string[];
  retainedActivePathIds: string[];
  omittedActivePrefixIds: string[];
  omittedBoundaryParentId: string | null;
  selectedIds: string[];
  groups: ActivePathGroup[];
  reasons: Record<string, SelectionReason[]>;
};

export type ActivePathWindowOptions<TNode extends ParentLinkedNode> = {
  maxGroups: number;
  groupKey: (node: TNode, index: number, activePath: readonly TNode[]) => string;
  includeRoot?: boolean;
  includeSiblingRoots?: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function traceActivePath<TNode extends ParentLinkedNode>(
  nodes: Readonly<Record<string, TNode>>,
  currentNode: string,
): ValidationResult<readonly TNode[]> {
  const issues: ValidationIssue[] = [];
  const reversed: TNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = currentNode;

  while (cursor !== null) {
    const node: TNode | undefined = nodes[cursor];
    if (!node) {
      issues.push({
        path: reversed.length === 0 ? "$.currentNode" : `$.nodes.${reversed.at(-1)?.id}.parent`,
        code: reversed.length === 0 ? "current-node-not-found" : "active-path-parent-not-found",
        message: `Active-path node ${cursor} does not resolve.`,
      });
      break;
    }
    if (seen.has(cursor)) {
      issues.push({
        path: `$.nodes.${cursor}`,
        code: "active-path-cycle",
        message: "The active parent path must be acyclic.",
      });
      break;
    }
    if (node.id !== cursor) {
      issues.push({
        path: `$.nodes.${cursor}.id`,
        code: "node-id-mismatch",
        message: "The node id must match its lookup key.",
      });
      break;
    }

    seen.add(cursor);
    reversed.push(node);

    if (node.parent !== null) {
      const parent = nodes[node.parent];
      if (parent && !parent.children.includes(node.id)) {
        issues.push({
          path: `$.nodes.${node.id}.parent`,
          code: "active-path-parent-child-mismatch",
          message: "The active-path parent does not reference this node as a child.",
        });
        break;
      }
    }
    cursor = node.parent;
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: reversed.reverse(), warnings: [] };
}

function addReason(
  reasons: Map<string, Set<SelectionReason>>,
  nodeId: string,
  reason: SelectionReason,
): void {
  const current = reasons.get(nodeId) ?? new Set<SelectionReason>();
  current.add(reason);
  reasons.set(nodeId, current);
}

export function planActivePathWindow<TNode extends ParentLinkedNode>(
  nodes: Readonly<Record<string, TNode>>,
  currentNode: string,
  options: ActivePathWindowOptions<TNode>,
): ValidationResult<ActivePathSelectionPlan> {
  if (!Number.isInteger(options.maxGroups) || options.maxGroups < 1) {
    return {
      ok: false,
      issues: [
        {
          path: "$.options.maxGroups",
          code: "invalid-max-groups",
          message: "maxGroups must be a positive integer.",
        },
      ],
    };
  }

  const traced = traceActivePath(nodes, currentNode);
  if (!traced.ok) return traced;
  const activePath = [...traced.value];
  if (activePath.length === 0) {
    return {
      ok: false,
      issues: [{ path: "$.currentNode", code: "empty-active-path", message: "Expected an active path." }],
    };
  }

  const groups: Array<{ key: string; nodes: TNode[] }> = [];
  try {
    for (let index = 0; index < activePath.length; index += 1) {
      const node = activePath[index];
      if (!node) continue;
      const key = options.groupKey(node, index, activePath);
      if (typeof key !== "string" || key.length === 0) {
        return {
          ok: false,
          issues: [
            {
              path: `$.activePath[${index}]`,
              code: "invalid-group-key",
              message: "groupKey must return a non-empty string.",
            },
          ],
        };
      }
      const previous = groups.at(-1);
      if (previous?.key === key) previous.nodes.push(node);
      else groups.push({ key, nodes: [node] });
    }
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "$.options.groupKey",
          code: "group-key-failed",
          message: error instanceof Error ? error.message : "groupKey threw an unknown error.",
        },
      ],
    };
  }

  const firstRetainedGroup = Math.max(0, groups.length - options.maxGroups);
  const retainedActivePath = groups.slice(firstRetainedGroup).flatMap((group) => group.nodes);
  const reasons = new Map<string, Set<SelectionReason>>();
  retainedActivePath.forEach((node) => addReason(reasons, node.id, "active-window"));

  const root = activePath[0];
  if (options.includeRoot && root) addReason(reasons, root.id, "root-anchor");

  const issues: ValidationIssue[] = [];
  if (options.includeSiblingRoots) {
    for (const node of retainedActivePath) {
      if (node.parent === null) continue;
      const parent = nodes[node.parent];
      if (!parent) continue;
      for (const childId of [...parent.children].sort()) {
        if (childId === node.id) continue;
        const sibling = nodes[childId];
        if (!sibling) {
          issues.push({
            path: `$.nodes.${parent.id}.children`,
            code: "branch-sibling-not-found",
            message: `Sibling node ${childId} does not resolve.`,
          });
          continue;
        }
        if (sibling.parent !== parent.id) {
          issues.push({
            path: `$.nodes.${childId}.parent`,
            code: "branch-sibling-parent-mismatch",
            message: "A branch sibling does not reference the expected parent.",
          });
          continue;
        }
        addReason(reasons, sibling.id, "branch-sibling");
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const firstRetained = retainedActivePath[0];
  const firstRetainedPathIndex = firstRetained
    ? activePath.findIndex((node) => node.id === firstRetained.id)
    : activePath.length;
  const selectedIds = [...reasons.keys()].sort();
  const selectedSet = new Set(selectedIds);
  const omittedBoundaryParentId =
    firstRetained?.parent && !selectedSet.has(firstRetained.parent) ? firstRetained.parent : null;
  const reasonOrder: SelectionReason[] = ["active-window", "root-anchor", "branch-sibling"];
  const serializedReasons: Record<string, SelectionReason[]> = {};
  for (const nodeId of selectedIds) {
    const nodeReasons = reasons.get(nodeId) ?? new Set<SelectionReason>();
    serializedReasons[nodeId] = reasonOrder.filter((reason) => nodeReasons.has(reason));
  }

  return {
    ok: true,
    value: {
      currentNode,
      activePathIds: activePath.map((node) => node.id),
      retainedActivePathIds: retainedActivePath.map((node) => node.id),
      omittedActivePrefixIds: activePath.slice(0, firstRetainedPathIndex).map((node) => node.id),
      omittedBoundaryParentId,
      selectedIds,
      groups: groups.map((group, index) => ({
        key: group.key,
        nodeIds: group.nodes.map((node) => node.id),
        retained: index >= firstRetainedGroup,
      })),
      reasons: serializedReasons,
    },
    warnings: [],
  };
}

function describeShape(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (depth <= 0 || value.length === 0) return "array";
    return `array<${describeShape(value[0], depth - 1)}>`;
  }
  if (!isRecord(value)) return typeof value;
  if (depth <= 0) return "object";
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${key}:${describeShape(value[key], depth - 1)}`)
    .join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintShape(
  adapter: string,
  adapterVersion: string,
  input: unknown,
  depth = 3,
): StructuralFingerprint {
  const shape = describeShape(input, depth);
  return { adapter, adapterVersion, shape, hash: fnv1a(shape) };
}
