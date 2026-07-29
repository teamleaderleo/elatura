// SPDX-License-Identifier: MPL-2.0
import {
  COMPANION_PROTOCOL_VERSION,
  type CompanionErrorCode,
  type CompanionOperation,
  type CompanionResponseEnvelope,
  type CompanionUsage,
} from "./companion-protocol.js";
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

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

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
    if (!set.has(key)) issues.push(issue(`${path}.${key}`, "unknown-field", "Unexpected response field."));
  }
  for (const key of allowed) {
    if (!(key in value)) issues.push(issue(`${path}.${key}`, "missing-field", "Required response field is missing."));
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseUsage(input: unknown, issues: ValidationIssue[]): CompanionUsage | null {
  if (!isRecord(input)) {
    issues.push(issue("$.usage", "invalid-usage", "Expected companion usage metadata."));
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
  exactKeys(input, fields, "$.usage", issues);
  for (const field of fields) {
    if (!nonNegativeInteger(input[field])) {
      issues.push(issue(`$.usage.${field}`, "invalid-usage", "Usage values must be non-negative safe integers."));
    }
  }
  if (issues.some((value) => value.path.startsWith("$.usage"))) return null;
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

export function parseCompanionResponse(
  input: unknown,
  maxSerializedBytes = 2_097_152,
): ValidationResult<CompanionResponseEnvelope> {
  if (!Number.isSafeInteger(maxSerializedBytes) || maxSerializedBytes < 1) {
    return { ok: false, issues: [issue("$", "response-policy-invalid", "Response byte policy is invalid.")] };
  }
  const measured = measureBoundedJson(input, {
    maxDepth: 64,
    maxNodes: 100_000,
    maxStringCodeUnits: 262_144,
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
    if (typeof input.sessionId !== "string" || !TOKEN.test(input.sessionId)) {
      issues.push(issue("$.sessionId", "invalid-session-id", "Expected a bounded session id."));
    }
    if (typeof input.requestId !== "string" || !TOKEN.test(input.requestId)) {
      issues.push(issue("$.requestId", "invalid-request-id", "Expected a bounded request id."));
    }
    if (typeof input.operation !== "string" || !OPERATIONS.has(input.operation as CompanionOperation | "invalid")) {
      issues.push(issue("$.operation", "unsupported-operation", "Unsupported response operation."));
    }
    if (typeof input.ok !== "boolean") {
      issues.push(issue("$.ok", "invalid-response-status", "Expected a boolean response status."));
    }
    const usage = parseUsage(input.usage, issues);

    if (input.ok === true) {
      if (input.errorCode !== null) {
        issues.push(issue("$.errorCode", "unexpected-error-code", "Successful responses must not contain an error code."));
      }
      if (input.payload === null || input.operation === "invalid") {
        issues.push(issue("$.payload", "invalid-success-payload", "Successful responses require a payload and a valid operation."));
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
      typeof input.sessionId !== "string" ||
      typeof input.requestId !== "string" ||
      typeof input.operation !== "string" ||
      typeof input.ok !== "boolean"
    ) return { ok: false, issues };

    return {
      ok: true,
      value: {
        version: COMPANION_PROTOCOL_VERSION,
        sessionId: input.sessionId,
        requestId: input.requestId,
        operation: input.operation as CompanionOperation | "invalid",
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
