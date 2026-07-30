// SPDX-License-Identifier: MPL-2.0
import {
  COMPANION_PROTOCOL_VERSION,
  isCompanionCursorToken,
  isCompanionEntryId,
  isCompanionToken,
  type CompanionConversationMetadata,
  type CompanionErrorCode,
  type CompanionOperation,
  type CompanionResponseEnvelope,
  type CompanionUsage,
} from "./companion-protocol.js";
import { validateContentProvenance } from "./representation.js";
import { measureBoundedJson } from "./resource-accounting.js";
import type { ValidationIssue, ValidationResult } from "./index.js";

const OPERATIONS = new Set<CompanionOperation | "invalid">([
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
  "invalid",
]);

const ERROR_CODES = new Set<CompanionErrorCode>([
  "invalid-request",
  "session-mismatch",
  "session-revoked",
  "session-expired",
  "too-many-in-flight",
  "too-many-queued-pages",
  "conversation-missing",
  "conversation-corrupt",
  "adapter-drift",
  "conversation-expired",
  "entry-missing",
  "code-missing",
  "cursor-invalid",
  "cursor-stale",
  "page-limit",
  "page-too-large",
  "search-limit",
  "index-limit",
  "resource-too-large",
  "response-too-large",
  "resident-limit",
  "request-cancelled",
  "client-state-limit",
]);

const ADAPTER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const METADATA_FRESHNESS = new Set(["fresh", "stale", "expired", "corrupt", "drifted"]);
const READABLE_FRESHNESS = new Set(["fresh", "stale"]);

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
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push(issue(`${path}.${key}`, "unknown-field", "Unexpected response field."));
    }
  }
  for (const key of allowed) {
    if (
      !optionalSet.has(key) &&
      !Object.prototype.hasOwnProperty.call(value, key)
    ) {
      issues.push(issue(`${path}.${key}`, "missing-field", "Required response field is missing."));
    }
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedString(value: unknown, maximum = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function adapterToken(value: unknown): value is string {
  return typeof value === "string" && ADAPTER_TOKEN.test(value);
}

function parseUsage(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): CompanionUsage | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-usage", "Expected companion usage metadata."));
    return null;
  }
  const fields = [
    "residentConversationCount",
    "residentRecordCount",
    "residentEntryCount",
    "residentTextCodeUnits",
    "residentSerializedBytes",
    "residentAccountedBytes",
    "inFlightRequests",
    "queuedPageRequests",
  ] as const;
  exactKeys(input, fields, path, issues);
  for (const field of fields) {
    if (!nonNegativeInteger(input[field])) {
      issues.push(issue(`${path}.${field}`, "invalid-usage", "Usage values must be non-negative safe integers."));
    }
  }
  if (issues.some((value) => value.path === path || value.path.startsWith(`${path}.`))) {
    return null;
  }
  return Object.freeze({
    residentConversationCount: input.residentConversationCount as number,
    residentRecordCount: input.residentRecordCount as number,
    residentEntryCount: input.residentEntryCount as number,
    residentTextCodeUnits: input.residentTextCodeUnits as number,
    residentSerializedBytes: input.residentSerializedBytes as number,
    residentAccountedBytes: input.residentAccountedBytes as number,
    inFlightRequests: input.inFlightRequests as number,
    queuedPageRequests: input.queuedPageRequests as number,
  });
}

function validateAdapter(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-adapter", "Expected adapter identity metadata."));
    return;
  }
  exactKeys(input, ["id", "version"], path, issues);
  if (!adapterToken(input.id) || !adapterToken(input.version)) {
    issues.push(issue(path, "invalid-adapter", "Adapter identity fields are invalid."));
  }
}

function validateCapabilities(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-capabilities", "Expected companion capability metadata."));
    return;
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
}

function validateMetadata(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-conversation-metadata", "Expected conversation metadata."));
    return;
  }
  exactKeys(input, ["id", "entryCount", "adapter", "freshness", "capabilities"], path, issues);
  if (!isCompanionToken(input.id) || !nonNegativeInteger(input.entryCount)) {
    issues.push(issue(path, "invalid-conversation-metadata", "Conversation metadata fields are invalid."));
  }
  if (input.adapter !== null) validateAdapter(input.adapter, `${path}.adapter`, issues);
  if (typeof input.freshness !== "string" || !METADATA_FRESHNESS.has(input.freshness)) {
    issues.push(issue(`${path}.freshness`, "invalid-freshness", "Conversation freshness is invalid."));
  }
  validateCapabilities(input.capabilities, `${path}.capabilities`, issues);
}

function validatePageEntry(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
  includeActive: boolean,
): void {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-page-entry", "Expected a companion entry object."));
    return;
  }
  const fields = [
    "id",
    "parentId",
    "childCount",
    "sequence",
    "kind",
    "label",
    "text",
    "textTruncated",
    "codeBlockCount",
    ...(includeActive ? ["active"] : []),
    "jumpBackReference",
  ];
  exactKeys(input, fields, path, issues, ["label", "text", "jumpBackReference"]);
  if (
    !isCompanionEntryId(input.id) ||
    !(input.parentId === null || isCompanionEntryId(input.parentId)) ||
    !nonNegativeInteger(input.childCount) ||
    !nonNegativeInteger(input.sequence) ||
    !boundedString(input.kind) ||
    (input.label !== undefined && typeof input.label !== "string") ||
    (input.text !== undefined && typeof input.text !== "string") ||
    typeof input.textTruncated !== "boolean" ||
    !nonNegativeInteger(input.codeBlockCount) ||
    (includeActive && typeof input.active !== "boolean") ||
    (input.jumpBackReference !== undefined && typeof input.jumpBackReference !== "string")
  ) {
    issues.push(issue(path, "invalid-page-entry", "Companion entry fields are invalid."));
  }
}

function validateListPayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(payload, ["items", "nextCursor"], "$.payload", issues);
  if (!Array.isArray(payload.items)) {
    issues.push(issue("$.payload.items", "invalid-list", "Conversation list items must be an array."));
  } else {
    payload.items.forEach((item, index) => {
      validateMetadata(item, `$.payload.items[${index}]`, issues);
    });
  }
  if (!(payload.nextCursor === null || isCompanionCursorToken(payload.nextCursor))) {
    issues.push(issue("$.payload.nextCursor", "invalid-cursor", "List cursor is invalid."));
  }
}

function validatePagePayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(
    payload,
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
  if (!isCompanionToken(payload.conversationId)) {
    issues.push(issue("$.payload.conversationId", "invalid-id", "Conversation id is invalid."));
  }
  if (!nonNegativeInteger(payload.generation)) {
    issues.push(issue("$.payload.generation", "invalid-generation", "Conversation generation is invalid."));
  }
  if (!isCompanionCursorToken(payload.cursor)) {
    issues.push(issue("$.payload.cursor", "invalid-cursor", "Page cursor is invalid."));
  }
  if (typeof payload.hasBefore !== "boolean" || typeof payload.hasAfter !== "boolean") {
    issues.push(issue("$.payload", "invalid-page", "Page direction flags are invalid."));
  }
  if (typeof payload.freshness !== "string" || !READABLE_FRESHNESS.has(payload.freshness)) {
    issues.push(issue("$.payload.freshness", "invalid-freshness", "Page freshness is invalid."));
  }
  validateAdapter(payload.adapter, "$.payload.adapter", issues);
  const provenance = validateContentProvenance(payload.provenance, "$.payload.provenance");
  if (!provenance.ok) issues.push(...provenance.issues);
  if (!Array.isArray(payload.entries)) {
    issues.push(issue("$.payload.entries", "invalid-page", "Page entries must be an array."));
  } else {
    payload.entries.forEach((entry, index) => {
      validatePageEntry(entry, `$.payload.entries[${index}]`, issues, true);
    });
  }
}

function validateEntryPayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(payload, ["conversationId", "generation", "entry", "freshness"], "$.payload", issues);
  if (!isCompanionToken(payload.conversationId)) {
    issues.push(issue("$.payload.conversationId", "invalid-id", "Conversation id is invalid."));
  }
  if (!nonNegativeInteger(payload.generation)) {
    issues.push(issue("$.payload.generation", "invalid-generation", "Conversation generation is invalid."));
  }
  validatePageEntry(payload.entry, "$.payload.entry", issues, false);
  if (typeof payload.freshness !== "string" || !READABLE_FRESHNESS.has(payload.freshness)) {
    issues.push(issue("$.payload.freshness", "invalid-freshness", "Entry freshness is invalid."));
  }
}

function validateCodePayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(payload, ["conversationId", "generation", "entryId", "blockIndex", "block"], "$.payload", issues);
  if (!isCompanionToken(payload.conversationId)) {
    issues.push(issue("$.payload.conversationId", "invalid-id", "Conversation id is invalid."));
  }
  if (!nonNegativeInteger(payload.generation)) {
    issues.push(issue("$.payload.generation", "invalid-generation", "Conversation generation is invalid."));
  }
  if (!isCompanionEntryId(payload.entryId) || !nonNegativeInteger(payload.blockIndex)) {
    issues.push(issue("$.payload", "invalid-code", "Code response identifiers are invalid."));
  }
  if (!isRecord(payload.block)) {
    issues.push(issue("$.payload.block", "invalid-code", "Expected a code block object."));
  } else {
    exactKeys(payload.block, ["language", "text"], "$.payload.block", issues, ["language"]);
    if (
      (payload.block.language !== undefined && typeof payload.block.language !== "string") ||
      typeof payload.block.text !== "string"
    ) {
      issues.push(issue("$.payload.block", "invalid-code", "Code block fields are invalid."));
    }
  }
}

function validateSearchPayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(payload, ["conversationId", "generation", "freshness", "results", "truncated"], "$.payload", issues);
  if (!isCompanionToken(payload.conversationId)) {
    issues.push(issue("$.payload.conversationId", "invalid-id", "Conversation id is invalid."));
  }
  if (!nonNegativeInteger(payload.generation)) {
    issues.push(issue("$.payload.generation", "invalid-generation", "Conversation generation is invalid."));
  }
  if (typeof payload.freshness !== "string" || !READABLE_FRESHNESS.has(payload.freshness)) {
    issues.push(issue("$.payload.freshness", "invalid-freshness", "Search freshness is invalid."));
  }
  if (!Array.isArray(payload.results)) {
    issues.push(issue("$.payload.results", "invalid-search", "Search results must be an array."));
  } else {
    payload.results.forEach((result, index) => {
      const path = `$.payload.results[${index}]`;
      if (!isRecord(result)) {
        issues.push(issue(path, "invalid-search-result", "Expected a search result object."));
        return;
      }
      exactKeys(result, ["entryId", "sequence", "label", "snippet"], path, issues, ["label"]);
      if (
        !isCompanionEntryId(result.entryId) ||
        !nonNegativeInteger(result.sequence) ||
        (result.label !== undefined && typeof result.label !== "string") ||
        typeof result.snippet !== "string"
      ) {
        issues.push(issue(path, "invalid-search-result", "Search result fields are invalid."));
      }
    });
  }
  if (typeof payload.truncated !== "boolean") {
    issues.push(issue("$.payload.truncated", "invalid-search", "Search truncation flag is invalid."));
  }
}

function validateEntryIdArray(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(input)) {
    issues.push(issue(path, "invalid-navigation", "Expected an entry-id array."));
    return;
  }
  input.forEach((value, index) => {
    if (!isCompanionEntryId(value)) {
      issues.push(issue(`${path}[${index}]`, "invalid-id", "Navigation entry id is invalid."));
    }
  });
}

function validateNavigatePayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(
    payload,
    [
      "conversationId",
      "generation",
      "entryId",
      "parentId",
      "childIds",
      "childCount",
      "siblingIds",
      "siblingCount",
      "activePath",
      "jumpBackReference",
    ],
    "$.payload",
    issues,
  );
  if (!isCompanionToken(payload.conversationId)) {
    issues.push(issue("$.payload.conversationId", "invalid-id", "Conversation id is invalid."));
  }
  if (!nonNegativeInteger(payload.generation)) {
    issues.push(issue("$.payload.generation", "invalid-generation", "Conversation generation is invalid."));
  }
  if (!isCompanionEntryId(payload.entryId)) {
    issues.push(issue("$.payload.entryId", "invalid-id", "Navigation entry id is invalid."));
  }
  if (!(payload.parentId === null || isCompanionEntryId(payload.parentId))) {
    issues.push(issue("$.payload.parentId", "invalid-id", "Navigation parent id is invalid."));
  }
  validateEntryIdArray(payload.childIds, "$.payload.childIds", issues);
  validateEntryIdArray(payload.siblingIds, "$.payload.siblingIds", issues);
  validateEntryIdArray(payload.activePath, "$.payload.activePath", issues);
  if (!nonNegativeInteger(payload.childCount) || !nonNegativeInteger(payload.siblingCount)) {
    issues.push(issue("$.payload", "invalid-navigation", "Navigation counts are invalid."));
  }
  if (!(payload.jumpBackReference === null || typeof payload.jumpBackReference === "string")) {
    issues.push(issue("$.payload.jumpBackReference", "invalid-navigation", "Jump-back reference is invalid."));
  }
}

function validateStatusPayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(payload, ["active", "sessionExpiresAt", "conversation", "usage"], "$.payload", issues);
  if (typeof payload.active !== "boolean") {
    issues.push(issue("$.payload.active", "invalid-status", "Status activity flag is invalid."));
  }
  if (!nonNegativeInteger(payload.sessionExpiresAt)) {
    issues.push(issue("$.payload.sessionExpiresAt", "invalid-status", "Session expiration timestamp is invalid."));
  }
  if (payload.conversation !== null) {
    validateMetadata(payload.conversation, "$.payload.conversation", issues);
  }
  parseUsage(payload.usage, "$.payload.usage", issues);
}

function validateClosePayload(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  exactKeys(payload, ["conversationId", "released", "generation"], "$.payload", issues);
  if (
    !isCompanionToken(payload.conversationId) ||
    payload.released !== true ||
    !nonNegativeInteger(payload.generation)
  ) {
    issues.push(issue("$.payload", "invalid-close", "Close payload fields are invalid."));
  }
}

function validateSuccessPayload(
  operation: CompanionOperation,
  payload: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(payload)) {
    issues.push(issue("$.payload", "invalid-success-payload", "Successful response payload must be an object."));
    return;
  }
  switch (operation) {
    case "list":
      validateListPayload(payload, issues);
      break;
    case "open":
    case "page":
      validatePagePayload(payload, issues);
      break;
    case "entry":
      validateEntryPayload(payload, issues);
      break;
    case "code":
      validateCodePayload(payload, issues);
      break;
    case "search":
      validateSearchPayload(payload, issues);
      break;
    case "navigate":
      validateNavigatePayload(payload, issues);
      break;
    case "status":
      validateStatusPayload(payload, issues);
      break;
    case "close":
      validateClosePayload(payload, issues);
      break;
    case "revoke":
      exactKeys(payload, ["revoked"], "$.payload", issues);
      if (payload.revoked !== true) {
        issues.push(issue("$.payload.revoked", "invalid-revoke", "Revoke payload must confirm revocation."));
      }
      break;
  }
}

export function parseCompanionResponse(
  input: unknown,
  maxSerializedBytes = 2_097_152,
  maxStringCodeUnits = 262_144,
): ValidationResult<CompanionResponseEnvelope> {
  if (
    !Number.isSafeInteger(maxSerializedBytes) ||
    maxSerializedBytes < 1 ||
    !Number.isSafeInteger(maxStringCodeUnits) ||
    maxStringCodeUnits < 1
  ) {
    return { ok: false, issues: [issue("$", "response-policy-invalid", "Response resource policy is invalid.")] };
  }
  const measured = measureBoundedJson(input, {
    maxDepth: 64,
    maxNodes: 100_000,
    maxStringCodeUnits,
    maxSerializedBytes,
  });
  if (!measured.ok) {
    return { ok: false, issues: [issue("$", "response-resource-limit", "Response exceeds the protocol resource policy.")] };
  }

  try {
    if (!isRecord(input)) {
      return { ok: false, issues: [issue("$", "response-not-object", "Expected a protocol response object.")] };
    }
    const issues: ValidationIssue[] = [];
    exactKeys(
      input,
      ["version", "sessionId", "requestId", "operation", "ok", "payload", "errorCode", "usage"],
      "$",
      issues,
    );
    if (input.version !== COMPANION_PROTOCOL_VERSION) {
      issues.push(issue("$.version", "unsupported-protocol-version", "Unsupported protocol version."));
    }
    if (!isCompanionToken(input.sessionId)) {
      issues.push(issue("$.sessionId", "invalid-session-id", "Expected a bounded session id."));
    }
    if (!isCompanionToken(input.requestId)) {
      issues.push(issue("$.requestId", "invalid-request-id", "Expected a bounded request id."));
    }
    const operation =
      typeof input.operation === "string" && OPERATIONS.has(input.operation as CompanionOperation | "invalid")
        ? (input.operation as CompanionOperation | "invalid")
        : null;
    if (!operation) {
      issues.push(issue("$.operation", "unsupported-operation", "Unsupported response operation."));
    }
    if (typeof input.ok !== "boolean") {
      issues.push(issue("$.ok", "invalid-response-status", "Expected a boolean response status."));
    }
    const usage = parseUsage(input.usage, "$.usage", issues);

    if (input.ok === true) {
      if (input.errorCode !== null) {
        issues.push(issue("$.errorCode", "unexpected-error-code", "Successful responses must not contain an error code."));
      }
      if (input.payload === null || operation === "invalid" || operation === null) {
        issues.push(issue("$.payload", "invalid-success-payload", "Successful responses require a payload and a valid operation."));
      } else {
        validateSuccessPayload(operation, input.payload, issues);
      }
    } else if (input.ok === false) {
      if (input.payload !== null) {
        issues.push(issue("$.payload", "unexpected-error-payload", "Error responses must not contain a payload."));
      }
      if (typeof input.errorCode !== "string" || !ERROR_CODES.has(input.errorCode as CompanionErrorCode)) {
        issues.push(issue("$.errorCode", "invalid-error-code", "Error response code is unsupported."));
      }
    }

    if (
      issues.length > 0 ||
      !usage ||
      operation === null ||
      typeof input.sessionId !== "string" ||
      typeof input.requestId !== "string" ||
      typeof input.ok !== "boolean"
    ) return { ok: false, issues };

    return {
      ok: true,
      value: {
        version: COMPANION_PROTOCOL_VERSION,
        sessionId: input.sessionId,
        requestId: input.requestId,
        operation,
        ok: input.ok,
        payload: structuredClone(input.payload),
        errorCode: input.errorCode as CompanionErrorCode | null,
        usage,
      },
      warnings: [],
    };
  } catch {
    return { ok: false, issues: [issue("$", "response-inspection-failed", "Response inspection failed safely.")] };
  }
}
