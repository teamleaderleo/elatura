// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import {
  isCompanionCursorToken,
  type CompanionConversationMetadata,
  type CompanionErrorCode,
  type CompanionOperation,
  type CompanionPageEntry,
  type CompanionPagePayload,
  type CompanionSearchResult,
} from "./companion-protocol.js";
import { parseCompanionResponse } from "./companion-response.js";
import {
  validateContentProvenance,
  type ContentProvenance,
  type ReadOnlyCodeBlock,
} from "./representation.js";
import { serializeBoundedJson } from "./resource-accounting.js";
import type { ValidationIssue, ValidationResult } from "./index.js";

export type CompanionClientPolicy = Readonly<{
  maxPendingRequests: number;
  maxConversationMetadata: number;
  maxTimelineEntries: number;
  maxSearchResults: number;
  maxCodeTextCodeUnits: number;
  maxStateSerializedBytes: number;
  maxResponseSerializedBytes: number;
}>;

export const DEFAULT_COMPANION_CLIENT_POLICY: CompanionClientPolicy = Object.freeze({
  maxPendingRequests: 8,
  maxConversationMetadata: 100,
  maxTimelineEntries: 50,
  maxSearchResults: 50,
  maxCodeTextCodeUnits: 262_144,
  maxStateSerializedBytes: 2_097_152,
  maxResponseSerializedBytes: 2_097_152,
});

export type CompanionClientCode = ReadOnlyCodeBlock & {
  conversationId: string;
  entryId: string;
  blockIndex: number;
};

export type CompanionClientSnapshot = Readonly<{
  conversations: readonly CompanionConversationMetadata[];
  page: CompanionPagePayload | null;
  searchConversationId: string | null;
  searchResults: readonly CompanionSearchResult[];
  code: CompanionClientCode | null;
  lastError: CompanionErrorCode | null;
  pendingRequestCount: number;
}>;

type PendingRequest = {
  operation: CompanionOperation;
};

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const FRESHNESS = new Set(["fresh", "stale", "expired", "corrupt", "drifted"]);

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issues.push(issue(`${path}.${key}`, "unknown-field", "Unexpected client payload field."));
  }
  for (const key of allowed) {
    if (!(key in value)) issues.push(issue(`${path}.${key}`, "missing-field", "Required client payload field is missing."));
  }
}

function token(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseAdapter(input: unknown, path: string, issues: ValidationIssue[]): AdapterIdentity | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-adapter", "Expected adapter metadata."));
    return null;
  }
  exactKeys(input, ["id", "version"], path, issues);
  if (!token(input.id) || !token(input.version)) {
    issues.push(issue(path, "invalid-adapter", "Expected bounded adapter identity tokens."));
    return null;
  }
  return { id: input.id, version: input.version };
}

function parseCapabilities(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): CompanionConversationMetadata["capabilities"] | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-capabilities", "Expected companion capability metadata."));
    return null;
  }
  const fields = [
    "paging",
    "search",
    "branches",
    "codeOnDemand",
    "jumpBack",
    "submission",
    "persistence",
    "privateContent",
  ] as const;
  exactKeys(input, fields, path, issues);
  const expected: Record<(typeof fields)[number], boolean> = {
    paging: true,
    search: true,
    branches: true,
    codeOnDemand: true,
    jumpBack: true,
    submission: false,
    persistence: false,
    privateContent: false,
  };
  for (const field of fields) {
    if (input[field] !== expected[field]) {
      issues.push(issue(`${path}.${field}`, "capability-mismatch", "Companion capability declaration is inconsistent."));
    }
  }
  if (issues.some((value) => value.path.startsWith(path))) return null;
  return Object.freeze(expected as CompanionConversationMetadata["capabilities"]);
}

function parseMetadata(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): CompanionConversationMetadata | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-conversation-metadata", "Expected conversation metadata."));
    return null;
  }
  exactKeys(input, ["id", "entryCount", "adapter", "freshness", "capabilities"], path, issues);
  if (!token(input.id) || !nonNegativeInteger(input.entryCount)) {
    issues.push(issue(path, "invalid-conversation-metadata", "Conversation id and entry count are invalid."));
  }
  const adapter = input.adapter === null ? null : parseAdapter(input.adapter, `${path}.adapter`, issues);
  if (typeof input.freshness !== "string" || !FRESHNESS.has(input.freshness)) {
    issues.push(issue(`${path}.freshness`, "invalid-freshness", "Conversation freshness is invalid."));
  }
  const capabilities = parseCapabilities(input.capabilities, `${path}.capabilities`, issues);
  if (
    issues.some((value) => value.path === path || value.path.startsWith(`${path}.`)) ||
    typeof input.id !== "string" ||
    typeof input.entryCount !== "number" ||
    typeof input.freshness !== "string" ||
    !capabilities
  ) return null;
  return {
    id: input.id,
    entryCount: input.entryCount,
    adapter,
    freshness: input.freshness as CompanionConversationMetadata["freshness"],
    capabilities,
  };
}

function parsePageEntry(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): CompanionPageEntry | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-page-entry", "Expected a page entry object."));
    return null;
  }
  exactKeys(
    input,
    [
      "id",
      "parentId",
      "childCount",
      "sequence",
      "kind",
      "label",
      "text",
      "textTruncated",
      "codeBlockCount",
      "active",
      "jumpBackReference",
    ],
    path,
    issues,
  );
  if (
    !token(input.id) ||
    !(input.parentId === null || token(input.parentId)) ||
    !nonNegativeInteger(input.childCount) ||
    !nonNegativeInteger(input.sequence) ||
    !token(input.kind) ||
    (input.label !== undefined && typeof input.label !== "string") ||
    (input.text !== undefined && typeof input.text !== "string") ||
    typeof input.textTruncated !== "boolean" ||
    !nonNegativeInteger(input.codeBlockCount) ||
    typeof input.active !== "boolean" ||
    (input.jumpBackReference !== undefined && typeof input.jumpBackReference !== "string")
  ) {
    issues.push(issue(path, "invalid-page-entry", "Page entry fields are invalid."));
    return null;
  }
  return {
    id: input.id,
    parentId: input.parentId,
    childCount: input.childCount,
    sequence: input.sequence,
    kind: input.kind,
    ...(typeof input.label === "string" ? { label: input.label } : {}),
    ...(typeof input.text === "string" ? { text: input.text } : {}),
    textTruncated: input.textTruncated,
    codeBlockCount: input.codeBlockCount,
    active: input.active,
    ...(typeof input.jumpBackReference === "string"
      ? { jumpBackReference: input.jumpBackReference }
      : {}),
  };
}

function parsePage(
  input: unknown,
  maximumEntries: number,
  issues: ValidationIssue[],
): CompanionPagePayload | null {
  if (!isRecord(input)) {
    issues.push(issue("$.payload", "invalid-page", "Expected a page payload object."));
    return null;
  }
  exactKeys(
    input,
    [
      "conversationId",
      "generation",
      "cursor",
      "hasBefore",
      "hasAfter",
      "freshness",
      "adapter",
      "provenance",
      "entries",
    ],
    "$.payload",
    issues,
  );
  if (
    !token(input.conversationId) ||
    !nonNegativeInteger(input.generation) ||
    !isCompanionCursorToken(input.cursor) ||
    typeof input.hasBefore !== "boolean" ||
    typeof input.hasAfter !== "boolean" ||
    (input.freshness !== "fresh" && input.freshness !== "stale") ||
    !Array.isArray(input.entries) ||
    input.entries.length > maximumEntries
  ) {
    issues.push(issue("$.payload", "client-timeline-limit", "Page payload exceeds the client policy."));
    return null;
  }
  const adapter = parseAdapter(input.adapter, "$.payload.adapter", issues);
  const provenance = validateContentProvenance(input.provenance, "$.payload.provenance");
  if (!provenance.ok) issues.push(...provenance.issues);
  const entries = input.entries
    .map((entry, index) => parsePageEntry(entry, `$.payload.entries[${index}]`, issues))
    .filter((entry): entry is CompanionPageEntry => entry !== null);
  if (
    issues.length > 0 ||
    !adapter ||
    !provenance.ok ||
    typeof input.conversationId !== "string" ||
    typeof input.generation !== "number" ||
    typeof input.cursor !== "string" ||
    typeof input.hasBefore !== "boolean" ||
    typeof input.hasAfter !== "boolean" ||
    typeof input.freshness !== "string"
  ) return null;
  return {
    conversationId: input.conversationId,
    generation: input.generation,
    cursor: input.cursor,
    hasBefore: input.hasBefore,
    hasAfter: input.hasAfter,
    freshness: input.freshness as "fresh" | "stale",
    adapter,
    provenance: provenance.value,
    entries,
  };
}

function parseSearch(
  input: unknown,
  maximumResults: number,
  issues: ValidationIssue[],
): { conversationId: string; results: CompanionSearchResult[] } | null {
  if (!isRecord(input)) {
    issues.push(issue("$.payload", "invalid-search", "Expected a search payload object."));
    return null;
  }
  exactKeys(
    input,
    ["conversationId", "generation", "freshness", "results", "truncated"],
    "$.payload",
    issues,
  );
  if (
    !token(input.conversationId) ||
    !nonNegativeInteger(input.generation) ||
    (input.freshness !== "fresh" && input.freshness !== "stale") ||
    !Array.isArray(input.results) ||
    input.results.length > maximumResults ||
    typeof input.truncated !== "boolean"
  ) {
    issues.push(issue("$.payload", "client-search-limit", "Search payload exceeds the client policy."));
    return null;
  }
  const results: CompanionSearchResult[] = [];
  input.results.forEach((candidate, index) => {
    const path = `$.payload.results[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(path, "invalid-search-result", "Expected a search result object."));
      return;
    }
    exactKeys(candidate, ["entryId", "sequence", "label", "snippet"], path, issues);
    if (
      !token(candidate.entryId) ||
      !nonNegativeInteger(candidate.sequence) ||
      (candidate.label !== undefined && typeof candidate.label !== "string") ||
      typeof candidate.snippet !== "string"
    ) {
      issues.push(issue(path, "invalid-search-result", "Search result fields are invalid."));
      return;
    }
    results.push({
      entryId: candidate.entryId,
      sequence: candidate.sequence,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
      snippet: candidate.snippet,
    });
  });
  return issues.length === 0 && typeof input.conversationId === "string"
    ? { conversationId: input.conversationId, results }
    : null;
}

function parseCode(
  input: unknown,
  maximumText: number,
  issues: ValidationIssue[],
): CompanionClientCode | null {
  if (!isRecord(input)) {
    issues.push(issue("$.payload", "invalid-code", "Expected a code payload object."));
    return null;
  }
  exactKeys(
    input,
    ["conversationId", "generation", "entryId", "blockIndex", "block"],
    "$.payload",
    issues,
  );
  if (
    !token(input.conversationId) ||
    !nonNegativeInteger(input.generation) ||
    !token(input.entryId) ||
    !nonNegativeInteger(input.blockIndex) ||
    !isRecord(input.block)
  ) {
    issues.push(issue("$.payload", "invalid-code", "Code payload fields are invalid."));
    return null;
  }
  exactKeys(input.block, ["language", "text"], "$.payload.block", issues);
  if (
    (input.block.language !== undefined && typeof input.block.language !== "string") ||
    typeof input.block.text !== "string" ||
    input.block.text.length > maximumText
  ) {
    issues.push(issue("$.payload.block", "client-code-limit", "Code response exceeds the client policy."));
    return null;
  }
  return {
    ...(typeof input.block.language === "string" ? { language: input.block.language } : {}),
    text: input.block.text,
    conversationId: input.conversationId,
    entryId: input.entryId,
    blockIndex: input.blockIndex,
  };
}

function resolvePolicy(input: Partial<CompanionClientPolicy> | undefined): CompanionClientPolicy {
  const resolved = { ...DEFAULT_COMPANION_CLIENT_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(resolved);
}

function emptySnapshot(): CompanionClientSnapshot {
  return Object.freeze({
    conversations: Object.freeze([]),
    page: null,
    searchConversationId: null,
    searchResults: Object.freeze([]),
    code: null,
    lastError: null,
    pendingRequestCount: 0,
  });
}

export class BoundedCompanionClientState {
  readonly #sessionId: string;
  readonly #policy: CompanionClientPolicy;
  readonly #pending = new Map<string, PendingRequest>();
  #snapshot: CompanionClientSnapshot = emptySnapshot();

  constructor(
    sessionId: string,
    inputPolicy?: Partial<CompanionClientPolicy>,
  ) {
    if (!token(sessionId)) {
      throw new TypeError("sessionId must be a bounded local token.");
    }
    this.#sessionId = sessionId;
    this.#policy = resolvePolicy(inputPolicy);
  }

  get snapshot(): CompanionClientSnapshot {
    return structuredClone(this.#snapshot);
  }

  expect(
    requestId: string,
    operation: CompanionOperation,
  ): ValidationResult<number> {
    if (!token(requestId)) {
      return { ok: false, issues: [issue("$.requestId", "invalid-request-id", "Expected a bounded request id.")] };
    }
    if (this.#pending.has(requestId)) {
      return { ok: false, issues: [issue("$.requestId", "client-request-duplicate", "Request id is already pending.")] };
    }
    if (this.#pending.size >= this.#policy.maxPendingRequests) {
      return { ok: false, issues: [issue("$.pending", "client-pending-limit", "Client pending-request limit reached.")] };
    }
    this.#pending.set(requestId, { operation });
    this.#setPendingCount();
    return { ok: true, value: this.#pending.size, warnings: [] };
  }

  cancel(requestId: string): boolean {
    const removed = this.#pending.delete(requestId);
    this.#setPendingCount();
    return removed;
  }

  clear(): void {
    this.#pending.clear();
    this.#snapshot = emptySnapshot();
  }

  #setPendingCount(): void {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      pendingRequestCount: this.#pending.size,
    });
  }

  #commit(candidate: CompanionClientSnapshot): ValidationResult<CompanionClientSnapshot> {
    const measured = serializeBoundedJson(candidate, {
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringCodeUnits: this.#policy.maxCodeTextCodeUnits,
      maxSerializedBytes: this.#policy.maxStateSerializedBytes,
    });
    if (!measured.ok) {
      this.#snapshot = Object.freeze({
        ...this.#snapshot,
        lastError: "client-state-limit",
        pendingRequestCount: this.#pending.size,
      });
      return { ok: false, issues: [issue("$", "client-state-limit", "Client state exceeds the local resource policy.")] };
    }
    this.#snapshot = Object.freeze(
      JSON.parse(measured.value.serialized) as CompanionClientSnapshot,
    );
    return { ok: true, value: this.snapshot, warnings: [] };
  }

  apply(input: unknown): ValidationResult<CompanionClientSnapshot> {
    const parsed = parseCompanionResponse(
      input,
      this.#policy.maxResponseSerializedBytes,
    );
    if (!parsed.ok) return parsed;
    const response = parsed.value;
    const pending = this.#pending.get(response.requestId);
    if (
      response.sessionId !== this.#sessionId ||
      !pending ||
      pending.operation !== response.operation
    ) {
      return { ok: false, issues: [issue("$", "client-response-unexpected", "Response does not match a pending local request.")] };
    }

    this.#pending.delete(response.requestId);
    let candidate: CompanionClientSnapshot = {
      ...this.#snapshot,
      pendingRequestCount: this.#pending.size,
      lastError: response.ok ? null : response.errorCode,
    };
    if (!response.ok) return this.#commit(candidate);

    const issues: ValidationIssue[] = [];
    switch (response.operation) {
      case "list": {
        if (!isRecord(response.payload)) {
          issues.push(issue("$.payload", "invalid-list", "Expected a list payload object."));
          break;
        }
        exactKeys(response.payload, ["items", "nextCursor"], "$.payload", issues);
        if (
          !Array.isArray(response.payload.items) ||
          response.payload.items.length > this.#policy.maxConversationMetadata ||
          !(response.payload.nextCursor === null || isCompanionCursorToken(response.payload.nextCursor))
        ) {
          issues.push(issue("$.payload", "client-metadata-limit", "Conversation metadata exceeds the client policy."));
          break;
        }
        const items = response.payload.items
          .map((item, index) => parseMetadata(item, `$.payload.items[${index}]`, issues))
          .filter((item): item is CompanionConversationMetadata => item !== null);
        if (issues.length === 0) candidate = { ...candidate, conversations: items };
        break;
      }
      case "open":
      case "page": {
        const page = parsePage(
          response.payload,
          this.#policy.maxTimelineEntries,
          issues,
        );
        if (page) candidate = { ...candidate, page, code: null };
        break;
      }
      case "search": {
        const search = parseSearch(
          response.payload,
          this.#policy.maxSearchResults,
          issues,
        );
        if (search) {
          candidate = {
            ...candidate,
            searchConversationId: search.conversationId,
            searchResults: search.results,
          };
        }
        break;
      }
      case "code": {
        const code = parseCode(
          response.payload,
          this.#policy.maxCodeTextCodeUnits,
          issues,
        );
        if (code) candidate = { ...candidate, code };
        break;
      }
      case "close": {
        if (!isRecord(response.payload)) {
          issues.push(issue("$.payload", "invalid-close", "Expected a close payload object."));
          break;
        }
        exactKeys(
          response.payload,
          ["conversationId", "released", "generation"],
          "$.payload",
          issues,
        );
        if (
          !token(response.payload.conversationId) ||
          response.payload.released !== true ||
          !nonNegativeInteger(response.payload.generation)
        ) {
          issues.push(issue("$.payload", "invalid-close", "Close payload fields are invalid."));
          break;
        }
        const closed = response.payload.conversationId;
        candidate = {
          ...candidate,
          page: candidate.page?.conversationId === closed ? null : candidate.page,
          searchConversationId:
            candidate.searchConversationId === closed
              ? null
              : candidate.searchConversationId,
          searchResults:
            candidate.searchConversationId === closed
              ? []
              : candidate.searchResults,
          code: candidate.code?.conversationId === closed ? null : candidate.code,
        };
        break;
      }
      case "revoke":
        this.clear();
        return { ok: true, value: this.snapshot, warnings: [] };
      case "entry":
      case "navigate":
      case "status":
        break;
    }

    if (issues.length > 0) {
      this.#setPendingCount();
      return { ok: false, issues };
    }
    return this.#commit(candidate);
  }
}
