// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity, AdapterVersionPolicy } from "./adapter-contract.js";
import type { ValidationIssue, ValidationResult } from "./index.js";
import { measureBoundedJson, type BoundedJsonUsage } from "./resource-accounting.js";
import type { FreshnessState } from "./representation.js";

export const COMPANION_PROTOCOL_VERSION = 1 as const;
export type CompanionOperation = "list" | "open" | "page" | "entry" | "code" | "search" | "navigate" | "status" | "close" | "revoke";
export type CompanionDirection = "before" | "after";
export type CompanionPolicy = Readonly<{
  maxSessions: number; maxRevokedSessions: number; maxResidentConversations: number;
  maxResidentPages: number; maxEntriesPerPage: number; maxEntryTextCodeUnits: number;
  maxChildIdsPerEntry: number; maxConversationList: number; maxSearchQueryCodeUnits: number;
  maxSearchResults: number; maxSnippetCodeUnits: number; maxNavigationEntries: number;
  maxCodeBlockTextCodeUnits: number; maxPendingPageWork: number; maxResidentPageBytes: number;
  maxAggregateResidentPageBytes: number; maxRequestSerializedBytes: number;
  maxResponseSerializedBytes: number; maxResponseNodes: number;
}>;
export const DEFAULT_COMPANION_POLICY: CompanionPolicy = Object.freeze({
  maxSessions: 8, maxRevokedSessions: 64, maxResidentConversations: 3, maxResidentPages: 12,
  maxEntriesPerPage: 80, maxEntryTextCodeUnits: 32_768, maxChildIdsPerEntry: 256,
  maxConversationList: 256, maxSearchQueryCodeUnits: 1_024, maxSearchResults: 50,
  maxSnippetCodeUnits: 512, maxNavigationEntries: 128, maxCodeBlockTextCodeUnits: 131_072,
  maxPendingPageWork: 8, maxResidentPageBytes: 1_048_576,
  maxAggregateResidentPageBytes: 8_388_608, maxRequestSerializedBytes: 65_536,
  maxResponseSerializedBytes: 1_048_576,
  maxResponseNodes: 100_000,
});
export type SyntheticCompanionSource = Readonly<{ conversationId: string; label?: string; representation: unknown; adapterPolicy: AdapterVersionPolicy }>;
export type CompanionBaseRequest = Readonly<{ version: 1; requestId: string; sessionId: string }>;
export type CompanionRequest =
  | (CompanionBaseRequest & { operation: "list"; limit: number })
  | (CompanionBaseRequest & { operation: "open"; conversationId: string; limit: number })
  | (CompanionBaseRequest & { operation: "page"; conversationId: string; cursor: string; direction: CompanionDirection; limit: number })
  | (CompanionBaseRequest & { operation: "entry"; conversationId: string; entryId: string })
  | (CompanionBaseRequest & { operation: "navigate"; conversationId: string; entryId: string })
  | (CompanionBaseRequest & { operation: "code"; conversationId: string; entryId: string; blockIndex: number })
  | (CompanionBaseRequest & { operation: "search"; conversationId: string; query: string; limit: number })
  | (CompanionBaseRequest & { operation: "status" | "close" | "revoke" });
export type CompanionEntryView = Readonly<{ id: string; parentId: string | null; childIds: readonly string[]; sequence: number; kind: string; label?: string; text?: string; textTruncated: boolean; codeBlockCount: number; codeLanguages: readonly (string | null)[]; jumpBackReference?: string }>;
export type CompanionConversationMetadata = Readonly<{ conversationId: string; label?: string; adapter: AdapterIdentity; freshness: FreshnessState; entryCount: number; activeEntryId: string | null }>;
export type CompanionTimelinePage = Readonly<{ conversation: CompanionConversationMetadata; entries: readonly CompanionEntryView[]; beforeCursor?: string; afterCursor?: string }>;
export type CompanionSearchResult = Readonly<{ entryId: string; sequence: number; kind: string; snippet: string; snippetTruncated: boolean }>;
export type CompanionNavigationResult = Readonly<{ entry: CompanionEntryView; parent: CompanionEntryView | null; children: readonly CompanionEntryView[]; siblings: readonly CompanionEntryView[] }>;
export type CompanionCodeResult = Readonly<{ entryId: string; blockIndex: number; language?: string; text: string }>;
export type CompanionUsage = Readonly<{ sessions: number; revokedSessions: number; activeConversations: number; residentPages: number; residentPageBytes: number; retainedSearchResults: number; retainedCodeUnits: number; pendingPageWork: number }>;
export type CompanionFailureCode = "request-invalid" | "request-inspection-failed" | "session-limit" | "session-revoked" | "conversation-missing" | "source-corrupt" | "source-private-disabled" | "source-expired" | "adapter-id-mismatch" | "adapter-version-incompatible" | "conversation-closed" | "cursor-invalid" | "entry-missing" | "code-missing" | "code-limit" | "search-query-limit" | "search-result-limit" | "navigation-limit" | "page-limit" | "aggregate-page-limit" | "pending-limit" | "late-reply-discarded" | "response-limit" | "internal-failure";
export type CompanionSuccessResponse = Readonly<{ version: 1; requestId: string; sessionId: string; operation: CompanionOperation; generation: number; ok: true; stale: boolean; data: unknown; usage: CompanionUsage }>;
export type CompanionFailureResponse = Readonly<{ version: 1; requestId: string; sessionId: string; operation: CompanionOperation | "invalid"; generation: number; ok: false; code: CompanionFailureCode; usage: CompanionUsage }>;
export type CompanionResponse = CompanionSuccessResponse | CompanionFailureResponse;
export type DeliveredCompanionResponse = Readonly<{ response: CompanionResponse; usage: BoundedJsonUsage }>;
export type PendingCompanionPageWork = Readonly<{ workId: string; request: Extract<CompanionRequest, { operation: "page" }>; generation: number }>;
export type BeginCompanionPageWorkResult = { ok: true; work: PendingCompanionPageWork } | { ok: false; delivered: DeliveredCompanionResponse };

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CURSOR = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/u;
const OPS = new Set<CompanionOperation>(["list", "open", "page", "entry", "code", "search", "navigate", "status", "close", "revoke"]);
const FAILURES = new Set<CompanionFailureCode>(["request-invalid", "request-inspection-failed", "session-limit", "session-revoked", "conversation-missing", "source-corrupt", "source-private-disabled", "source-expired", "adapter-id-mismatch", "adapter-version-incompatible", "conversation-closed", "cursor-invalid", "entry-missing", "code-missing", "code-limit", "search-query-limit", "search-result-limit", "navigation-limit", "page-limit", "aggregate-page-limit", "pending-limit", "late-reply-discarded", "response-limit", "internal-failure"]);
export function companionIssue(path: string, code: string, message: string): ValidationIssue { return { path, code, message }; }
export function isCompanionRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function isCompanionToken(value: unknown): value is string { return typeof value === "string" && TOKEN.test(value); }
export function resolveCompanionPolicy(input?: Partial<CompanionPolicy>): CompanionPolicy {
  const value = { ...DEFAULT_COMPANION_POLICY, ...input };
  for (const [name, limit] of Object.entries(value)) if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`${name} must be a positive safe integer.`);
  return Object.freeze(value);
}
function exact(value: Record<string, unknown>, allowed: readonly string[], issues: ValidationIssue[]): void {
  const set = new Set(allowed); for (const key of Object.keys(value)) if (!set.has(key)) issues.push(companionIssue(`$.${key}`, "unknown-field", "Unexpected field for this protocol version."));
}
function boundedInt(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined) return fallback; return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum ? value as number : null;
}
export function parseCompanionCursor(value: string): { generation: number; start: number } | null {
  const match = CURSOR.exec(value); if (!match) return null; const generation = Number(match[1]); const start = Number(match[2]); return Number.isSafeInteger(generation) && Number.isSafeInteger(start) ? { generation, start } : null;
}
export function makeCompanionCursor(generation: number, start: number): string { return `${generation}:${start}`; }

export function parseCompanionRequest(input: unknown, inputPolicy?: Partial<CompanionPolicy>): ValidationResult<CompanionRequest> {
  let p: CompanionPolicy; try { p = resolveCompanionPolicy(inputPolicy); } catch { return { ok: false, issues: [companionIssue("$.policy", "companion-policy-invalid", "Companion policy is invalid.")] }; }
  const measured = measureBoundedJson(input, {
    maxDepth: 8,
    maxNodes: 64,
    maxStringCodeUnits: Math.max(p.maxSearchQueryCodeUnits, 512),
    maxSerializedBytes: p.maxRequestSerializedBytes,
  });
  if (!measured.ok) return measured;
  try {
    if (!isCompanionRecord(input)) return { ok: false, issues: [companionIssue("$", "companion-request-not-object", "Expected a request object.")] };
    const issues: ValidationIssue[] = []; const op = input.operation;
    if (input.version !== 1) issues.push(companionIssue("$.version", "unsupported-companion-version", "Unsupported version."));
    if (!isCompanionToken(input.requestId)) issues.push(companionIssue("$.requestId", "invalid-request-id", "Invalid request id."));
    if (!isCompanionToken(input.sessionId)) issues.push(companionIssue("$.sessionId", "invalid-session-id", "Invalid session id."));
    if (typeof op !== "string" || !OPS.has(op as CompanionOperation)) issues.push(companionIssue("$.operation", "invalid-operation", "Unsupported operation."));
    if (issues.length || typeof op !== "string" || !OPS.has(op as CompanionOperation)) return { ok: false, issues };
    const base = { version: 1 as const, requestId: input.requestId as string, sessionId: input.sessionId as string }; const keys = ["version", "requestId", "sessionId", "operation"];
    if (op === "status" || op === "close" || op === "revoke") { exact(input, keys, issues); return issues.length ? { ok: false, issues } : { ok: true, value: { ...base, operation: op }, warnings: [] }; }
    if (op === "list") { exact(input, [...keys, "limit"], issues); const limit = boundedInt(input.limit, p.maxConversationList, p.maxConversationList); if (limit === null) issues.push(companionIssue("$.limit", "request-limit", "Invalid list limit.")); return issues.length || limit === null ? { ok: false, issues } : { ok: true, value: { ...base, operation: op, limit }, warnings: [] }; }
    if (!isCompanionToken(input.conversationId)) issues.push(companionIssue("$.conversationId", "invalid-conversation-id", "Invalid conversation id."));
    if (op === "open") { exact(input, [...keys, "conversationId", "limit"], issues); const limit = boundedInt(input.limit, p.maxEntriesPerPage, p.maxEntriesPerPage); if (limit === null) issues.push(companionIssue("$.limit", "request-limit", "Invalid page limit.")); return issues.length || limit === null ? { ok: false, issues } : { ok: true, value: { ...base, operation: op, conversationId: input.conversationId as string, limit }, warnings: [] }; }
    if (op === "page") { exact(input, [...keys, "conversationId", "cursor", "direction", "limit"], issues); if (typeof input.cursor !== "string" || !CURSOR.test(input.cursor)) issues.push(companionIssue("$.cursor", "invalid-cursor", "Invalid cursor.")); if (input.direction !== "before" && input.direction !== "after") issues.push(companionIssue("$.direction", "invalid-direction", "Invalid direction.")); const limit = boundedInt(input.limit, p.maxEntriesPerPage, p.maxEntriesPerPage); if (limit === null) issues.push(companionIssue("$.limit", "request-limit", "Invalid page limit.")); return issues.length || limit === null ? { ok: false, issues } : { ok: true, value: { ...base, operation: op, conversationId: input.conversationId as string, cursor: input.cursor as string, direction: input.direction as CompanionDirection, limit }, warnings: [] }; }
    if (!isCompanionToken(input.entryId) && op !== "search") issues.push(companionIssue("$.entryId", "invalid-entry-id", "Invalid entry id."));
    if (op === "entry" || op === "navigate") { exact(input, [...keys, "conversationId", "entryId"], issues); return issues.length ? { ok: false, issues } : { ok: true, value: { ...base, operation: op, conversationId: input.conversationId as string, entryId: input.entryId as string }, warnings: [] }; }
    if (op === "code") { exact(input, [...keys, "conversationId", "entryId", "blockIndex"], issues); if (!Number.isSafeInteger(input.blockIndex) || (input.blockIndex as number) < 0) issues.push(companionIssue("$.blockIndex", "invalid-block-index", "Invalid code index.")); return issues.length ? { ok: false, issues } : { ok: true, value: { ...base, operation: op, conversationId: input.conversationId as string, entryId: input.entryId as string, blockIndex: input.blockIndex as number }, warnings: [] }; }
    exact(input, [...keys, "conversationId", "query", "limit"], issues); if (typeof input.query !== "string" || input.query.length === 0 || input.query.length > p.maxSearchQueryCodeUnits) issues.push(companionIssue("$.query", "search-query-limit", "Invalid search query.")); const limit = boundedInt(input.limit, p.maxSearchResults, p.maxSearchResults); if (limit === null) issues.push(companionIssue("$.limit", "search-result-limit", "Invalid search limit.")); return issues.length || limit === null ? { ok: false, issues } : { ok: true, value: { ...base, operation: "search", conversationId: input.conversationId as string, query: input.query as string, limit }, warnings: [] };
  } catch { return { ok: false, issues: [companionIssue("$", "companion-request-inspection-failed", "Request inspection failed safely.")] }; }
}

function parseUsage(value: unknown, issues: ValidationIssue[]): CompanionUsage | null {
  if (!isCompanionRecord(value)) { issues.push(companionIssue("$.usage", "invalid-companion-usage", "Invalid usage.")); return null; }
  const names = ["sessions", "revokedSessions", "activeConversations", "residentPages", "residentPageBytes", "retainedSearchResults", "retainedCodeUnits", "pendingPageWork"] as const; exact(value, names, issues);
  for (const name of names) if (!Number.isSafeInteger(value[name]) || (value[name] as number) < 0) issues.push(companionIssue(`$.usage.${name}`, "invalid-companion-usage", "Usage must be non-negative."));
  if (issues.length) return null; return Object.freeze(Object.fromEntries(names.map((name) => [name, value[name]])) as unknown as CompanionUsage);
}
export function parseCompanionResponse(input: unknown, inputPolicy?: Partial<CompanionPolicy>): ValidationResult<CompanionResponse> {
  let p: CompanionPolicy; try { p = resolveCompanionPolicy(inputPolicy); } catch { return { ok: false, issues: [companionIssue("$.policy", "companion-policy-invalid", "Companion policy is invalid.")] }; }
  const measured = measureBoundedJson(input, { maxNodes: p.maxResponseNodes, maxSerializedBytes: p.maxResponseSerializedBytes, maxStringCodeUnits: Math.max(p.maxCodeBlockTextCodeUnits, p.maxEntryTextCodeUnits) }); if (!measured.ok) return measured;
  try {
    if (!isCompanionRecord(input)) return { ok: false, issues: [companionIssue("$", "companion-response-not-object", "Expected a response object.")] };
    const issues: ValidationIssue[] = []; const op = input.operation;
    if (input.version !== 1) issues.push(companionIssue("$.version", "unsupported-companion-version", "Unsupported version.")); if (!isCompanionToken(input.requestId) || !isCompanionToken(input.sessionId)) issues.push(companionIssue("$", "invalid-response-id", "Invalid response ids.")); if (typeof op !== "string" || (op !== "invalid" && !OPS.has(op as CompanionOperation))) issues.push(companionIssue("$.operation", "invalid-operation", "Invalid operation.")); if (!Number.isSafeInteger(input.generation) || (input.generation as number) < 0) issues.push(companionIssue("$.generation", "invalid-generation", "Invalid generation."));
    const usage = parseUsage(input.usage, issues);
    if (input.ok === true) { exact(input, ["version", "requestId", "sessionId", "operation", "generation", "ok", "stale", "data", "usage"], issues); if (op === "invalid" || typeof input.stale !== "boolean") issues.push(companionIssue("$", "invalid-success-response", "Invalid success response.")); if (issues.length || !usage) return { ok: false, issues }; return { ok: true, value: Object.freeze({ version: 1, requestId: input.requestId as string, sessionId: input.sessionId as string, operation: op as CompanionOperation, generation: input.generation as number, ok: true, stale: input.stale as boolean, data: input.data, usage }), warnings: [] }; }
    if (input.ok === false) { exact(input, ["version", "requestId", "sessionId", "operation", "generation", "ok", "code", "usage"], issues); if (typeof input.code !== "string" || !FAILURES.has(input.code as CompanionFailureCode)) issues.push(companionIssue("$.code", "invalid-failure-code", "Invalid failure code.")); if (issues.length || !usage) return { ok: false, issues }; return { ok: true, value: Object.freeze({ version: 1, requestId: input.requestId as string, sessionId: input.sessionId as string, operation: op as CompanionOperation | "invalid", generation: input.generation as number, ok: false, code: input.code as CompanionFailureCode, usage }), warnings: [] }; }
    return { ok: false, issues: [companionIssue("$.ok", "invalid-response-kind", "Invalid response kind.")] };
  } catch { return { ok: false, issues: [companionIssue("$", "companion-response-inspection-failed", "Response inspection failed safely.")] }; }
}
export function requestFailureCode(issues: readonly ValidationIssue[]): CompanionFailureCode { const codes = new Set(issues.map((value) => value.code)); if (codes.has("companion-request-inspection-failed")) return "request-inspection-failed"; if (codes.has("search-query-limit")) return "search-query-limit"; if (codes.has("search-result-limit")) return "search-result-limit"; if (codes.has("invalid-cursor")) return "cursor-invalid"; if (codes.has("request-limit")) return "page-limit"; return "request-invalid"; }
