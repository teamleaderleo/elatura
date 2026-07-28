// SPDX-License-Identifier: MPL-2.0
import {
  fingerprintShape,
  isRecord,
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

export function detectChatGptConversation(input: unknown): boolean {
  if (!isRecord(input)) return false;
  return typeof input.current_node === "string" && isRecord(input.mapping);
}

export function validateChatGptConversation(
  input: unknown,
): ValidationResult<ChatGptConversation> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", code: "not-object", message: "Expected an object." }] };
  }

  const issues: ValidationIssue[] = [];
  if (typeof input.current_node !== "string") {
    issues.push({ path: "$.current_node", code: "missing-current-node", message: "Expected a string." });
  }
  if (!isRecord(input.mapping)) {
    issues.push({ path: "$.mapping", code: "missing-mapping", message: "Expected an object." });
  }
  if (issues.length > 0 || typeof input.current_node !== "string" || !isRecord(input.mapping)) {
    return { ok: false, issues };
  }

  const mapping: Record<string, ChatGptNode> = {};
  for (const [key, candidate] of Object.entries(input.mapping)) {
    const path = `$.mapping.${key}`;
    if (!isRecord(candidate)) {
      issues.push({ path, code: "node-not-object", message: "Expected a node object." });
      continue;
    }
    const id = typeof candidate.id === "string" ? candidate.id : key;
    const parent = candidate.parent === null || typeof candidate.parent === "string" ? candidate.parent : null;
    if (!(candidate.parent === null || typeof candidate.parent === "string" || candidate.parent === undefined)) {
      issues.push({ path: `${path}.parent`, code: "invalid-parent", message: "Expected string or null." });
    }
    const children = Array.isArray(candidate.children)
      ? candidate.children.filter((child): child is string => typeof child === "string")
      : [];
    if (!Array.isArray(candidate.children)) {
      issues.push({ path: `${path}.children`, code: "invalid-children", message: "Expected an array." });
    }
    mapping[key] = { id, parent, children, message: candidate.message, raw: candidate };
  }

  if (!mapping[input.current_node]) {
    issues.push({
      path: "$.current_node",
      code: "current-node-not-found",
      message: "The current node must resolve inside mapping.",
    });
  }

  for (const [key, node] of Object.entries(mapping)) {
    if (node.parent !== null && !mapping[node.parent]) {
      issues.push({ path: `$.mapping.${key}.parent`, code: "missing-parent", message: "Parent does not resolve." });
    }
    for (const child of node.children) {
      if (!mapping[child]) {
        issues.push({ path: `$.mapping.${key}.children`, code: "missing-child", message: "Child does not resolve." });
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { currentNode: input.current_node, mapping, raw: input },
    warnings: [],
  };
}

export function fingerprintChatGptConversation(source: ChatGptConversation): StructuralFingerprint {
  return fingerprintShape("chatgpt-conversation", "0.1.0", source.raw, 4);
}
