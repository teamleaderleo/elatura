// SPDX-License-Identifier: MPL-2.0
import {
  fingerprintShape,
  isRecord,
  type StructuralFingerprint,
  type ValidationIssue,
  type ValidationResult,
} from "@elatura/core";
import {
  defineAdapterCapabilities,
  type ApplicationAdapter,
  type AdapterVersionPolicy,
} from "@elatura/core/adapter-contract";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  validateReadOnlyRepresentation,
  type ReadOnlyCodeBlock,
  type ReadOnlyEntry,
  type ReadOnlyRepresentation,
} from "@elatura/core/representation";

export const CHATGPT_ADAPTER_ID = "chatgpt-conversation";
export const CHATGPT_ADAPTER_VERSION = "0.2.0";

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

export type SyntheticChatGptRepresentationOptions = {
  authorityOrigin: string;
  authorityReference: string;
  capturedAt: number;
  staleAt: number;
  expiresAt: number;
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
    if (node.parent !== null) {
      const parent = mapping[node.parent];
      if (!parent) {
        issues.push({ path: `$.mapping.${key}.parent`, code: "missing-parent", message: "Parent does not resolve." });
      } else if (!parent.children.includes(key)) {
        issues.push({
          path: `$.mapping.${key}.parent`,
          code: "parent-child-mismatch",
          message: "The parent does not reference this node as a child.",
        });
      }
    }
    for (const childId of node.children) {
      const child = mapping[childId];
      if (!child) {
        issues.push({ path: `$.mapping.${key}.children`, code: "missing-child", message: "Child does not resolve." });
      } else if (child.parent !== key) {
        issues.push({
          path: `$.mapping.${key}.children`,
          code: "child-parent-mismatch",
          message: "A child does not reference this node as its parent.",
        });
      }
    }
  }

  const activePath = new Set<string>();
  let cursor: string | null = input.current_node;
  while (cursor !== null) {
    const current: ChatGptNode | undefined = mapping[cursor];
    if (!current) break;
    if (activePath.has(cursor)) {
      issues.push({
        path: "$.current_node",
        code: "active-path-cycle",
        message: "The active parent path must be acyclic.",
      });
      break;
    }
    activePath.add(cursor);
    cursor = current.parent;
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { currentNode: input.current_node, mapping, raw: input },
    warnings: [],
  };
}

export function fingerprintChatGptConversation(source: ChatGptConversation): StructuralFingerprint {
  return fingerprintShape(CHATGPT_ADAPTER_ID, CHATGPT_ADAPTER_VERSION, source.raw, {
    depth: 7,
    dictionaryPaths: ["$.mapping"],
    maxUniqueVariants: 64,
    maxObjectKeys: 128,
    maxShapeLength: 65_536,
  });
}

function syntheticMarker(source: ChatGptConversation): boolean {
  return isRecord(source.raw.elatura_fixture) && source.raw.elatura_fixture.synthetic === true;
}

function messageText(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.content) || !Array.isArray(message.content.parts)) return undefined;
  const parts = message.content.parts.filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function messageLabel(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.author) || typeof message.author.role !== "string") return undefined;
  return message.author.role;
}

function messageTime(message: unknown): number {
  if (!isRecord(message) || typeof message.create_time !== "number" || !Number.isFinite(message.create_time)) return 0;
  return message.create_time;
}

function extractCodeBlocks(text: string | undefined): ReadOnlyCodeBlock[] {
  if (!text) return [];
  const blocks: ReadOnlyCodeBlock[] = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/gu;
  for (const match of text.matchAll(pattern)) {
    blocks.push({
      ...(match[1]?.trim() ? { language: match[1].trim() } : {}),
      text: match[2] ?? "",
    });
  }
  return blocks;
}

function activePathIds(source: ChatGptConversation): string[] {
  const reversed: string[] = [];
  let cursor: string | null = source.currentNode;
  while (cursor !== null) {
    const node: ChatGptNode | undefined = source.mapping[cursor];
    if (!node) break;
    reversed.push(cursor);
    cursor = node.parent;
  }
  return reversed.reverse();
}

function jumpBackReference(reference: string, entryId: string): string {
  const url = new URL(reference);
  url.hash = `elatura-entry=${encodeURIComponent(entryId)}`;
  return url.toString();
}

export function toSyntheticChatGptRepresentation(
  source: ChatGptConversation,
  options: SyntheticChatGptRepresentationOptions,
): ValidationResult<ReadOnlyRepresentation> {
  if (!syntheticMarker(source)) {
    return {
      ok: false,
      issues: [
        {
          path: "$.elatura_fixture.synthetic",
          code: "synthetic-representation-only",
          message: "The alternate representation prototype accepts synthetic fixtures only.",
        },
      ],
    };
  }

  let referenceUrl: URL;
  try {
    referenceUrl = new URL(options.authorityReference);
  } catch {
    return {
      ok: false,
      issues: [{ path: "$.authorityReference", code: "invalid-authority-reference", message: "Expected an absolute URL." }],
    };
  }
  if (referenceUrl.origin !== options.authorityOrigin) {
    return {
      ok: false,
      issues: [{ path: "$.authorityOrigin", code: "authority-origin-mismatch", message: "Origin must match the reference." }],
    };
  }

  const orderedNodes = Object.values(source.mapping).sort(
    (left, right) => messageTime(left.message) - messageTime(right.message) || left.id.localeCompare(right.id),
  );
  const entries: ReadOnlyEntry[] = orderedNodes.map((node, sequence) => {
    const text = messageText(node.message);
    return {
      id: node.id,
      parentId: node.parent,
      childIds: [...node.children].sort(),
      sequence,
      kind: node.message === undefined ? "graph-node" : "message",
      ...(messageLabel(node.message) ? { label: messageLabel(node.message) } : {}),
      ...(text !== undefined ? { text } : {}),
      codeBlocks: extractCodeBlocks(text),
      jumpBackReference: jumpBackReference(options.authorityReference, node.id),
    };
  });

  const representation: ReadOnlyRepresentation = {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter: { id: CHATGPT_ADAPTER_ID, version: CHATGPT_ADAPTER_VERSION },
    provenance: {
      authority: { origin: options.authorityOrigin, reference: options.authorityReference },
      capturedAt: options.capturedAt,
      adapter: { id: CHATGPT_ADAPTER_ID, version: CHATGPT_ADAPTER_VERSION },
      transformation: {
        kind: "alternate-representation",
        id: "chatgpt-synthetic-read-only",
        version: "1",
      },
      cache: { kind: "none" },
      freshness: {
        capturedAt: options.capturedAt,
        staleAt: options.staleAt,
        expiresAt: options.expiresAt,
      },
      synthetic: true,
    },
    roots: entries.filter((entry) => entry.parentId === null).map((entry) => entry.id).sort(),
    activePath: activePathIds(source),
    entries,
  };
  return validateReadOnlyRepresentation(representation);
}

export const chatGptAdapterVersionPolicy: AdapterVersionPolicy = {
  adapterId: CHATGPT_ADAPTER_ID,
  currentVersion: CHATGPT_ADAPTER_VERSION,
  readableVersions: [],
};

export const chatGptAdapter: ApplicationAdapter<
  ChatGptConversation,
  never,
  never,
  never,
  ReadOnlyRepresentation,
  SyntheticChatGptRepresentationOptions
> = {
  id: CHATGPT_ADAPTER_ID,
  version: CHATGPT_ADAPTER_VERSION,
  capabilities: defineAdapterCapabilities({
    branches: "supported",
    cache: "synthetic-only",
    alternateRepresentation: "synthetic-only",
  }),
  detect: detectChatGptConversation,
  validate: validateChatGptConversation,
  fingerprint: fingerprintChatGptConversation,
  alternateRepresentation: toSyntheticChatGptRepresentation,
};
