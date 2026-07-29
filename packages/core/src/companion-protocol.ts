// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import type {
  ContentProvenance,
  FreshnessState,
} from "./representation.js";
import { measureBoundedJson } from "./resource-accounting.js";
import type { ValidationIssue, ValidationResult } from "./index.js";

export const COMPANION_PROTOCOL_VERSION = 1 as const;

export type CompanionOperation =
  | "list"
  | "open"
  | "page"
  | "entry"
  | "code"
  | "search"
  | "navigate"
  | "status"
  | "close"
  | "revoke";

export type CompanionErrorCode =
  | "invalid-request"
  | "session-mismatch"
  | "session-revoked"
  | "session-expired"
  | "too-many-in-flight"
  | "too-many-queued-pages"
  | "conversation-missing"
  | "conversation-corrupt"
  | "adapter-drift"
  | "conversation-expired"
  | "entry-missing"
  | "code-missing"
  | "cursor-invalid"
  | "cursor-stale"
  | "page-limit"
  | "page-too-large"
  | "search-limit"
  | "index-limit"
  | "resource-too-large"
  | "response-too-large"
  | "resident-limit"
  | "request-cancelled"
  | "client-state-limit";

export type CompanionRequestEnvelope = {
  version: typeof COMPANION_PROTOCOL_VERSION;
  sessionId: string;
  requestId: string;
  operation: CompanionOperation;
  payload: Record<string, unknown>;
};

export type CompanionUsage = Readonly<{
  residentConversationCount: number;
  residentRecordCount: number;
  residentEntryCount: number;
  residentTextCodeUnits: number;
  residentSerializedBytes: number;
  residentAccountedBytes: number;
  inFlightRequests: number;
  queuedPageRequests: number;
}>;

export type CompanionResponseEnvelope = {
  version: typeof COMPANION_PROTOCOL_VERSION;
  sessionId: string;
  requestId: string;
  operation: CompanionOperation | "invalid";
  ok: boolean;
  payload: unknown | null;
  errorCode: CompanionErrorCode | null;
  usage: CompanionUsage;
};

export type CompanionCapabilities = Readonly<{
  paging: true;
  search: true;
  branches: true;
  codeOnDemand: true;
  jumpBack: true;
  submission: false;
  persistence: false;
  privateContent: false;
}>;

export const COMPANION_CAPABILITIES: CompanionCapabilities = Object.freeze({
  paging: true,
  search: true,
  branches: true,
  codeOnDemand: true,
  jumpBack: true,
  submission: false,
  persistence: false,
  privateContent: false,
});

export type CompanionConversationMetadata = {
  id: string;
  entryCount: number;
  adapter: AdapterIdentity | null;
  freshness: FreshnessState | "corrupt" | "drifted";
  capabilities: CompanionCapabilities;
};

export type CompanionPageEntry = {
  id: string;
  parentId: string | null;
  childCount: number;
  sequence: number;
  kind: string;
  label?: string;
  text?: string;
  textTruncated: boolean;
  codeBlockCount: number;
  active: boolean;
  jumpBackReference?: string;
};

export type CompanionPagePayload = {
  conversationId: string;
  generation: number;
  cursor: string;
  hasBefore: boolean;
  hasAfter: boolean;
  freshness: Exclude<FreshnessState, "expired">;
  adapter: AdapterIdentity;
  provenance: ContentProvenance;
  entries: CompanionPageEntry[];
};

export type CompanionSearchResult = {
  entryId: string;
  sequence: number;
  label?: string;
  snippet: string;
};

export type CompanionWorkingSetPolicy = Readonly<{
  maxResidentConversations: number;
  maxResidentRecords: number;
  maxResidentPagesPerConversation: number;
  maxResidentSearchesPerConversation: number;
  maxResidentEntries: number;
  maxResidentTextCodeUnits: number;
  maxResidentSerializedBytes: number;
  maxResidentAccountedBytes: number;
  maxPageEntries: number;
  maxPageEntryTextCodeUnits: number;
  maxPageTextCodeUnits: number;
  maxPageSerializedBytes: number;
  maxResponseSerializedBytes: number;
  maxSearchResults: number;
  maxSnippetCodeUnits: number;
  maxSearchSerializedBytes: number;
  maxIndexEntries: number;
  maxIndexTextCodeUnits: number;
  maxInFlightRequests: number;
  maxQueuedPageRequests: number;
  maxRelationshipIds: number;
  maxCodeResponseCodeUnits: number;
  maxResourceMetadataRecords: number;
  maxRequestSerializedBytes: number;
  sessionTtlMs: number;
}>;

export const DEFAULT_COMPANION_WORKING_SET_POLICY: CompanionWorkingSetPolicy = Object.freeze({
  maxResidentConversations: 3,
  maxResidentRecords: 8,
  maxResidentPagesPerConversation: 2,
  maxResidentSearchesPerConversation: 1,
  maxResidentEntries: 256,
  maxResidentTextCodeUnits: 1_048_576,
  maxResidentSerializedBytes: 8_388_608,
  maxResidentAccountedBytes: 33_554_432,
  maxPageEntries: 50,
  maxPageEntryTextCodeUnits: 16_384,
  maxPageTextCodeUnits: 524_288,
  maxPageSerializedBytes: 1_048_576,
  maxResponseSerializedBytes: 2_097_152,
  maxSearchResults: 50,
  maxSnippetCodeUnits: 240,
  maxSearchSerializedBytes: 262_144,
  maxIndexEntries: 100_000,
  maxIndexTextCodeUnits: 16_777_216,
  maxInFlightRequests: 4,
  maxQueuedPageRequests: 4,
  maxRelationshipIds: 64,
  maxCodeResponseCodeUnits: 262_144,
  maxResourceMetadataRecords: 256,
  maxRequestSerializedBytes: 65_536,
  sessionTtlMs: 60 * 60 * 1000,
});

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const CURSOR_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,511}$/u;
const RESPONSE_ENVELOPE_RESERVE_BYTES = 65_536;
const OPERATIONS = new Set<CompanionOperation>([
  "list",
  "open",
  "page",
  "entry",
  "code",
  "search",
  "navigate",
  "status",
  "close",
  "revoke",
]);

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
    if (!set.has(key)) issues.push(issue(`${path}.${key}`, "unknown-field", "Unexpected protocol field."));
  }
  for (const key of allowed) {
    if (!(key in value)) issues.push(issue(`${path}.${key}`, "missing-field", "Required protocol field is missing."));
  }
}

export function isCompanionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function isCompanionEntryId(value: unknown): value is string {
  return typeof value === "string" && ENTRY_ID.test(value);
}

export function isCompanionCursorToken(value: unknown): value is string {
  return typeof value === "string" && CURSOR_TOKEN.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function safeProduct(name: string, value: number, multiplier: number): number {
  const product = value * multiplier;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`${name} produces an unsafe response-size bound.`);
  }
  return product;
}

function minimumResponseSerializedBytes(policy: CompanionWorkingSetPolicy): number {
  const payloadBounds = [
    policy.maxPageSerializedBytes,
    policy.maxSearchSerializedBytes,
    safeProduct("maxCodeResponseCodeUnits", policy.maxCodeResponseCodeUnits, 6),
    safeProduct("maxPageEntryTextCodeUnits", policy.maxPageEntryTextCodeUnits, 6),
    safeProduct("maxResourceMetadataRecords", policy.maxResourceMetadataRecords, 2_048),
    safeProduct("maxRelationshipIds", policy.maxRelationshipIds, 3_072),
  ];
  const maximumPayload = Math.max(...payloadBounds);
  const required = maximumPayload + RESPONSE_ENVELOPE_RESERVE_BYTES;
  if (!Number.isSafeInteger(required)) {
    throw new RangeError("Companion response-size policy is unsafe.");
  }
  return required;
}

export function resolveCompanionWorkingSetPolicy(
  input: Partial<CompanionWorkingSetPolicy> | undefined,
): CompanionWorkingSetPolicy {
  const resolved = { ...DEFAULT_COMPANION_WORKING_SET_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  const minimumResponse = minimumResponseSerializedBytes(resolved);
  if (resolved.maxResponseSerializedBytes < minimumResponse) {
    throw new RangeError(
      `maxResponseSerializedBytes must be at least ${minimumResponse} for the configured payload limits.`,
    );
  }
  return Object.freeze(resolved);
}

function parsePayload(
  operation: CompanionOperation,
  input: unknown,
  issues: ValidationIssue[],
): Record<string, unknown> | null {
  if (!isRecord(input)) {
    issues.push(issue("$.payload", "invalid-payload", "Expected a protocol payload object."));
    return null;
  }
  const exact = (allowed: readonly string[]) => exactKeys(input, allowed, "$.payload", issues);
  switch (operation) {
    case "list":
      exact(["cursor", "limit"]);
      if (!(input.cursor === null || isCompanionCursorToken(input.cursor))) {
        issues.push(issue("$.payload.cursor", "invalid-cursor", "Expected null or a bounded cursor token."));
      }
      if (!positiveInteger(input.limit)) issues.push(issue("$.payload.limit", "invalid-limit", "Expected a positive integer."));
      break;
    case "open":
      exact(["conversationId", "anchorEntryId", "before", "after"]);
      if (!isCompanionToken(input.conversationId)) issues.push(issue("$.payload.conversationId", "invalid-id", "Expected a bounded conversation id."));
      if (!(input.anchorEntryId === null || isCompanionEntryId(input.anchorEntryId))) {
        issues.push(issue("$.payload.anchorEntryId", "invalid-id", "Expected null or a bounded entry id."));
      }
      if (!nonNegativeInteger(input.before) || !nonNegativeInteger(input.after)) {
        issues.push(issue("$.payload", "invalid-window", "Expected non-negative page bounds."));
      }
      break;
    case "page":
      exact(["conversationId", "cursor", "direction", "limit"]);
      if (!isCompanionToken(input.conversationId) || !isCompanionCursorToken(input.cursor)) {
        issues.push(issue("$.payload", "invalid-id", "Expected bounded conversation and cursor ids."));
      }
      if (input.direction !== "before" && input.direction !== "after") {
        issues.push(issue("$.payload.direction", "invalid-direction", "Expected before or after."));
      }
      if (!positiveInteger(input.limit)) issues.push(issue("$.payload.limit", "invalid-limit", "Expected a positive integer."));
      break;
    case "entry":
    case "navigate":
      exact(["conversationId", "entryId"]);
      if (!isCompanionToken(input.conversationId) || !isCompanionEntryId(input.entryId)) {
        issues.push(issue("$.payload", "invalid-id", "Expected bounded conversation and entry ids."));
      }
      break;
    case "code":
      exact(["conversationId", "entryId", "blockIndex"]);
      if (!isCompanionToken(input.conversationId) || !isCompanionEntryId(input.entryId)) {
        issues.push(issue("$.payload", "invalid-id", "Expected bounded conversation and entry ids."));
      }
      if (!nonNegativeInteger(input.blockIndex)) {
        issues.push(issue("$.payload.blockIndex", "invalid-index", "Expected a non-negative block index."));
      }
      break;
    case "search":
      exact(["conversationId", "query", "limit"]);
      if (!isCompanionToken(input.conversationId)) {
        issues.push(issue("$.payload.conversationId", "invalid-id", "Expected a bounded conversation id."));
      }
      if (!boundedString(input.query, 4_096)) {
        issues.push(issue("$.payload.query", "invalid-query", "Expected a bounded non-empty query."));
      }
      if (!positiveInteger(input.limit)) issues.push(issue("$.payload.limit", "invalid-limit", "Expected a positive integer."));
      break;
    case "status":
      exact(["conversationId"]);
      if (!(input.conversationId === null || isCompanionToken(input.conversationId))) {
        issues.push(issue("$.payload.conversationId", "invalid-id", "Expected null or a bounded conversation id."));
      }
      break;
    case "close":
      exact(["conversationId"]);
      if (!isCompanionToken(input.conversationId)) {
        issues.push(issue("$.payload.conversationId", "invalid-id", "Expected a bounded conversation id."));
      }
      break;
    case "revoke":
      exact([]);
      break;
  }
  return issues.length === 0 ? input : null;
}

export function parseCompanionRequest(
  input: unknown,
  inputPolicy?: Partial<CompanionWorkingSetPolicy>,
): ValidationResult<CompanionRequestEnvelope> {
  let resolved: CompanionWorkingSetPolicy;
  try {
    resolved = resolveCompanionWorkingSetPolicy(inputPolicy);
  } catch {
    return { ok: false, issues: [issue("$", "companion-policy-invalid", "Companion policy is invalid.")] };
  }
  const measured = measureBoundedJson(input, {
    maxDepth: 16,
    maxNodes: 1_000,
    maxStringCodeUnits: 4_096,
    maxSerializedBytes: resolved.maxRequestSerializedBytes,
  });
  if (!measured.ok) {
    return { ok: false, issues: [issue("$", "request-resource-limit", "Request exceeds the protocol resource policy.")] };
  }
  try {
    if (!isRecord(input)) {
      return { ok: false, issues: [issue("$", "request-not-object", "Expected a protocol request object.")] };
    }
    const issues: ValidationIssue[] = [];
    exactKeys(input, ["version", "sessionId", "requestId", "operation", "payload"], "$", issues);
    if (input.version !== COMPANION_PROTOCOL_VERSION) {
      issues.push(issue("$.version", "unsupported-protocol-version", "Unsupported protocol version."));
    }
    if (!isCompanionToken(input.sessionId)) {
      issues.push(issue("$.sessionId", "invalid-session-id", "Expected a bounded session id."));
    }
    if (!isCompanionToken(input.requestId)) {
      issues.push(issue("$.requestId", "invalid-request-id", "Expected a bounded request id."));
    }
    const operation = typeof input.operation === "string" && OPERATIONS.has(input.operation as CompanionOperation)
      ? input.operation as CompanionOperation
      : null;
    if (!operation) issues.push(issue("$.operation", "unsupported-operation", "Unsupported protocol operation."));
    const payload = operation ? parsePayload(operation, input.payload, issues) : null;
    if (
      issues.length > 0 ||
      !operation ||
      !payload ||
      typeof input.sessionId !== "string" ||
      typeof input.requestId !== "string"
    ) return { ok: false, issues };
    return {
      ok: true,
      value: {
        version: COMPANION_PROTOCOL_VERSION,
        sessionId: input.sessionId,
        requestId: input.requestId,
        operation,
        payload: structuredClone(payload),
      },
      warnings: [],
    };
  } catch {
    return { ok: false, issues: [issue("$", "request-inspection-failed", "Request inspection failed safely.")] };
  }
}
