// SPDX-License-Identifier: MPL-2.0
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
import {
  detectChatGptConversation,
  fingerprintChatGptConversation,
  validateChatGptConversation,
  type ChatGptConversation,
  type ChatGptNode,
} from "./index.js";

export const CHATGPT_ADAPTER_ID = "chatgpt-conversation";
export const CHATGPT_ADAPTER_VERSION = "0.3.0";

export type SyntheticChatGptRepresentationOptions = {
  authorityOrigin: string;
  authorityReference: string;
  capturedAt: number;
  staleAt: number;
  expiresAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSyntheticMarker(source: ChatGptConversation): boolean {
  return isRecord(source.raw.elatura_fixture) && source.raw.elatura_fixture.synthetic === true;
}

function validateChatGptAdapterInput(
  input: unknown,
): ReturnType<typeof validateChatGptConversation> {
  const validated = validateChatGptConversation(input);
  if (!validated.ok) return validated;

  // The inspection validator creates a fresh normalized graph. Keep optional
  // properties genuinely absent instead of retaining own properties whose value
  // is undefined. The authoritative raw input remains untouched.
  for (const node of Object.values(validated.value.mapping)) {
    if (node.message === undefined) delete node.message;
  }
  return validated;
}

function messageText(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.content) || !Array.isArray(message.content.parts)) {
    return undefined;
  }
  const parts = message.content.parts.filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function messageLabel(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.author) || typeof message.author.role !== "string") {
    return undefined;
  }
  return message.author.role;
}

function messageTime(message: unknown): number {
  if (!isRecord(message) || typeof message.create_time !== "number" || !Number.isFinite(message.create_time)) {
    return 0;
  }
  return message.create_time;
}

function extractCodeBlocks(text: string | undefined): ReadOnlyCodeBlock[] {
  if (text === undefined) return [];
  const blocks: ReadOnlyCodeBlock[] = [];
  for (const match of text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/gu)) {
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
    if (node === undefined) break;
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
): ReturnType<typeof validateReadOnlyRepresentation> {
  if (!hasSyntheticMarker(source)) {
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

  let reference: URL;
  try {
    reference = new URL(options.authorityReference);
  } catch {
    return {
      ok: false,
      issues: [
        {
          path: "$.authorityReference",
          code: "invalid-authority-reference",
          message: "Expected an absolute URL.",
        },
      ],
    };
  }
  if (reference.origin !== options.authorityOrigin) {
    return {
      ok: false,
      issues: [
        {
          path: "$.authorityOrigin",
          code: "authority-origin-mismatch",
          message: "Origin must match the reference.",
        },
      ],
    };
  }

  const orderedNodes = Object.values(source.mapping).sort(
    (left, right) => messageTime(left.message) - messageTime(right.message) || left.id.localeCompare(right.id),
  );
  const entries: ReadOnlyEntry[] = orderedNodes.map((node, sequence) => {
    const text = messageText(node.message);
    const label = messageLabel(node.message);
    return {
      id: node.id,
      parentId: node.parent,
      childIds: [...node.children].sort(),
      sequence,
      kind: node.message === undefined ? "graph-node" : "message",
      ...(label === undefined ? {} : { label }),
      ...(text === undefined ? {} : { text }),
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
  validate: validateChatGptAdapterInput,
  fingerprint: fingerprintChatGptConversation,
  alternateRepresentation: toSyntheticChatGptRepresentation,
};
