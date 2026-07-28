// SPDX-License-Identifier: MPL-2.0
import {
  fingerprintShape,
  isRecord,
  traceActivePath,
  type StructuralFingerprint,
  type ValidationIssue,
  type ValidationResult,
} from "@elatura/core";

export type ChatGptNode = {
  id: string;
  parent: string | null;
  children: string[];
  message?: unknown;
  raw: Record<string, unknown>;
};

export type ChatGptConversation = {
  currentNode: string;
  mapping: Record<string, ChatGptNode>;
  raw: Record<string, unknown>;
};

export type ChatGptValidationLimits = {
  maxNodes?: number;
  maxEdges?: number;
  maxActivePathDepth?: number;
  maxIssues?: number;
};

type ResolvedChatGptValidationLimits = {
  maxNodes: number;
  maxEdges: number;
  maxActivePathDepth: number;
  maxIssues: number;
};

export const DEFAULT_CHATGPT_VALIDATION_LIMITS: Readonly<ResolvedChatGptValidationLimits> =
  Object.freeze({
    maxNodes: 250_000,
    maxEdges: 1_000_000,
    maxActivePathDepth: 100_000,
    maxIssues: 256,
  });

type IssueCollector = {
  issues: ValidationIssue[];
  maxIssues: number;
  overflowed: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  return (
    left.path.localeCompare(right.path) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function addIssue(collector: IssueCollector, issue: ValidationIssue): void {
  if (collector.issues.length < collector.maxIssues) {
    collector.issues.push(issue);
    return;
  }

  collector.overflowed = true;
  let largestIndex = 0;
  for (let index = 1; index < collector.issues.length; index += 1) {
    const current = collector.issues[index];
    const largest = collector.issues[largestIndex];
    if (current && largest && compareIssues(current, largest) > 0) largestIndex = index;
  }
  const largest = collector.issues[largestIndex];
  if (largest && compareIssues(issue, largest) < 0) collector.issues[largestIndex] = issue;
}

function finishIssues(collector: IssueCollector): ValidationIssue[] {
  const sorted = [...collector.issues].sort(compareIssues);
  if (!collector.overflowed) return sorted;

  const retained = sorted.slice(0, Math.max(0, collector.maxIssues - 1));
  retained.push({
    path: "$",
    code: "validation-issue-budget-exceeded",
    message: `Validation produced more than ${collector.maxIssues} issues.`,
  });
  return retained.sort(compareIssues);
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: keyof ResolvedChatGptValidationLimits,
): { ok: true; value: number } | { ok: false; issue: ValidationIssue } {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    return {
      ok: false,
      issue: {
        path: `$.limits.${name}`,
        code: `invalid-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
        message: `${name} must be a positive integer.`,
      },
    };
  }
  return { ok: true, value: resolved };
}

function resolveLimits(
  limits: ChatGptValidationLimits,
): { ok: true; value: ResolvedChatGptValidationLimits } | { ok: false; issues: ValidationIssue[] } {
  const maxNodes = positiveLimit(limits.maxNodes, DEFAULT_CHATGPT_VALIDATION_LIMITS.maxNodes, "maxNodes");
  const maxEdges = positiveLimit(limits.maxEdges, DEFAULT_CHATGPT_VALIDATION_LIMITS.maxEdges, "maxEdges");
  const maxActivePathDepth = positiveLimit(
    limits.maxActivePathDepth,
    DEFAULT_CHATGPT_VALIDATION_LIMITS.maxActivePathDepth,
    "maxActivePathDepth",
  );
  const maxIssues = positiveLimit(
    limits.maxIssues,
    DEFAULT_CHATGPT_VALIDATION_LIMITS.maxIssues,
    "maxIssues",
  );
  const resolved = [maxNodes, maxEdges, maxActivePathDepth, maxIssues];
  const issues = resolved.flatMap((entry) => (entry.ok ? [] : [entry.issue])).sort(compareIssues);
  if (issues.length > 0) return { ok: false, issues };
  if (!maxNodes.ok || !maxEdges.ok || !maxActivePathDepth.ok || !maxIssues.ok) {
    return { ok: false, issues: [] };
  }
  return {
    ok: true,
    value: {
      maxNodes: maxNodes.value,
      maxEdges: maxEdges.value,
      maxActivePathDepth: maxActivePathDepth.value,
      maxIssues: maxIssues.value,
    },
  };
}

function nodePath(key: string): string {
  return `$.mapping.${key}`;
}

function countOwnKeysWithinBudget(
  value: Record<string, unknown>,
  limit: number,
): { ok: true; count: number } | { ok: false } {
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    count += 1;
    if (count > limit) return { ok: false };
  }
  return { ok: true, count };
}

function countEdgesWithinBudget(
  mapping: Record<string, unknown>,
  limit: number,
): { ok: true; count: number } | { ok: false } {
  let count = 0;
  for (const key in mapping) {
    if (!Object.prototype.hasOwnProperty.call(mapping, key)) continue;
    const candidate = mapping[key];
    if (!isRecord(candidate) || !Array.isArray(candidate.children)) continue;
    count += candidate.children.length;
    if (count > limit) return { ok: false };
  }
  return { ok: true, count };
}

function mapActivePathIssue(issue: ValidationIssue): ValidationIssue {
  return {
    ...issue,
    path: issue.path
      .replace("$.currentNode", "$.current_node")
      .replace("$.nodes.", "$.mapping."),
  };
}

function validateAllParentChains(
  mapping: Readonly<Record<string, ChatGptNode>>,
  keys: readonly string[],
  collector: IssueCollector,
): void {
  const completed = new Set<string>();

  for (const start of keys) {
    if (completed.has(start)) continue;
    const path: string[] = [];
    const localIndex = new Map<string, number>();
    let cursor: string | null = start;

    while (cursor !== null) {
      if (completed.has(cursor)) break;
      const node: ChatGptNode | undefined = mapping[cursor];
      if (!node) break;
      const cycleIndex = localIndex.get(cursor);
      if (cycleIndex !== undefined) {
        const representative = [...path.slice(cycleIndex), cursor].sort()[0] ?? cursor;
        addIssue(collector, {
          path: `${nodePath(representative)}.parent`,
          code: "graph-cycle",
          message: "Every parent chain must terminate at a root.",
        });
        break;
      }
      localIndex.set(cursor, path.length);
      path.push(cursor);
      cursor = node.parent;
    }

    path.forEach((id) => completed.add(id));
  }
}

export function detectChatGptConversation(input: unknown): boolean {
  if (!isRecord(input)) return false;
  return typeof input.current_node === "string" && isRecord(input.mapping);
}

export function validateChatGptConversation(
  input: unknown,
  limits: ChatGptValidationLimits = {},
): ValidationResult<ChatGptConversation> {
  const resolvedLimits = resolveLimits(limits);
  if (!resolvedLimits.ok) return resolvedLimits;
  const collector: IssueCollector = {
    issues: [],
    maxIssues: resolvedLimits.value.maxIssues,
    overflowed: false,
  };

  if (!isRecord(input)) {
    addIssue(collector, { path: "$", code: "not-object", message: "Expected an object." });
    return { ok: false, issues: finishIssues(collector) };
  }

  const currentNode = isNonEmptyString(input.current_node) ? input.current_node : null;
  if (currentNode === null) {
    addIssue(collector, {
      path: "$.current_node",
      code: "invalid-current-node",
      message: "Expected a non-empty string.",
    });
  }
  if (!isRecord(input.mapping)) {
    addIssue(collector, {
      path: "$.mapping",
      code: "missing-mapping",
      message: "Expected an object.",
    });
    return { ok: false, issues: finishIssues(collector) };
  }

  const nodeCount = countOwnKeysWithinBudget(input.mapping, resolvedLimits.value.maxNodes);
  if (!nodeCount.ok) {
    return {
      ok: false,
      issues: [
        {
          path: "$.mapping",
          code: "graph-node-budget-exceeded",
          message: `The mapping exceeds the ${resolvedLimits.value.maxNodes} node validation budget.`,
        },
      ],
    };
  }

  const edgeCount = countEdgesWithinBudget(input.mapping, resolvedLimits.value.maxEdges);
  if (!edgeCount.ok) {
    return {
      ok: false,
      issues: [
        {
          path: "$.mapping",
          code: "graph-edge-budget-exceeded",
          message: `The mapping exceeds the ${resolvedLimits.value.maxEdges} edge validation budget.`,
        },
      ],
    };
  }

  const keys = Object.keys(input.mapping).sort();
  const mapping: Record<string, ChatGptNode> = {};

  for (const key of keys) {
    const candidate = input.mapping[key];
    const path = nodePath(key);
    if (key.length === 0) {
      addIssue(collector, {
        path,
        code: "invalid-mapping-key",
        message: "Mapping keys must be non-empty strings.",
      });
    }
    if (!isRecord(candidate)) {
      addIssue(collector, { path, code: "node-not-object", message: "Expected a node object." });
      continue;
    }

    if (!isNonEmptyString(candidate.id)) {
      addIssue(collector, {
        path: `${path}.id`,
        code: "invalid-node-id",
        message: "Expected a non-empty string.",
      });
    } else if (candidate.id !== key) {
      addIssue(collector, {
        path: `${path}.id`,
        code: "node-id-mismatch",
        message: "The node id must match its mapping key.",
      });
    }

    let parent: string | null = null;
    if (candidate.parent === null) {
      parent = null;
    } else if (isNonEmptyString(candidate.parent)) {
      parent = candidate.parent;
    } else {
      addIssue(collector, {
        path: `${path}.parent`,
        code: "invalid-parent",
        message: "Expected a non-empty string or null.",
      });
    }

    const children: string[] = [];
    if (!Array.isArray(candidate.children)) {
      addIssue(collector, {
        path: `${path}.children`,
        code: "invalid-children",
        message: "Expected an array.",
      });
    } else {
      const seenChildren = new Set<string>();
      for (let index = 0; index < candidate.children.length; index += 1) {
        const child = candidate.children[index];
        if (!isNonEmptyString(child)) {
          addIssue(collector, {
            path: `${path}.children[${index}]`,
            code: "invalid-child-reference",
            message: "Expected a non-empty string.",
          });
          continue;
        }
        if (seenChildren.has(child)) {
          addIssue(collector, {
            path: `${path}.children[${index}]`,
            code: "duplicate-child-reference",
            message: `Child ${child} appears more than once.`,
          });
        }
        seenChildren.add(child);
        children.push(child);
      }
    }

    mapping[key] = {
      id: key,
      parent,
      children,
      message: candidate.message,
      raw: candidate,
    };
  }

  if (currentNode !== null && !mapping[currentNode]) {
    addIssue(collector, {
      path: "$.current_node",
      code: "current-node-not-found",
      message: "The current node must resolve inside mapping.",
    });
  }

  for (const key of keys) {
    const node = mapping[key];
    if (!node) continue;
    if (node.parent !== null) {
      const parent = mapping[node.parent];
      if (!parent) {
        addIssue(collector, {
          path: `${nodePath(key)}.parent`,
          code: "missing-parent",
          message: "Parent does not resolve.",
        });
      } else if (!parent.children.includes(key)) {
        addIssue(collector, {
          path: `${nodePath(key)}.parent`,
          code: "parent-child-mismatch",
          message: "The parent does not reference this node as a child.",
        });
      }
    }
    for (const childId of node.children) {
      const child = mapping[childId];
      if (!child) {
        addIssue(collector, {
          path: `${nodePath(key)}.children`,
          code: "missing-child",
          message: "Child does not resolve.",
        });
      } else if (child.parent !== key) {
        addIssue(collector, {
          path: `${nodePath(key)}.children`,
          code: "child-parent-mismatch",
          message: "A child does not reference this node as its parent.",
        });
      }
    }
  }

  validateAllParentChains(mapping, keys, collector);

  if (currentNode !== null && mapping[currentNode]) {
    const activePath = traceActivePath(mapping, currentNode, {
      maxActivePathDepth: resolvedLimits.value.maxActivePathDepth,
    });
    if (!activePath.ok) activePath.issues.map(mapActivePathIssue).forEach((issue) => addIssue(collector, issue));
  }

  const issues = finishIssues(collector);
  if (issues.length > 0) return { ok: false, issues };
  if (currentNode === null) {
    return {
      ok: false,
      issues: [
        {
          path: "$.current_node",
          code: "invalid-current-node",
          message: "Expected a non-empty string.",
        },
      ],
    };
  }

  return {
    ok: true,
    value: { currentNode, mapping, raw: input },
    warnings: [],
  };
}

export function fingerprintChatGptConversation(source: ChatGptConversation): StructuralFingerprint {
  return fingerprintShape("chatgpt-conversation", "0.3.0", source.raw, {
    depth: 7,
    dictionaryPaths: ["$.mapping"],
    maxUniqueVariants: 64,
    maxObjectKeys: 128,
    maxShapeLength: 65_536,
    maxVisitedValues: 5_000_000,
  });
}
