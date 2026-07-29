// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import {
  resolveFreshnessState,
  validateAndMeasureReadOnlyRepresentation,
  type FreshnessState,
  type ReadOnlyCodeBlock,
  type ReadOnlyEntry,
  type ReadOnlyRepresentation,
} from "./representation.js";
import {
  accountedResidentBytes,
  measureBoundedJson,
  serializeBoundedJson,
  type BoundedJsonUsage,
} from "./resource-accounting.js";
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
  provenance: ReadOnlyRepresentation["provenance"];
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

export type SyntheticCompanionConversationInput = {
  id: string;
  representation: unknown;
};

export type SyntheticCompanionDispatchOptions = {
  beforeCommit?: () => Promise<void>;
};

export type SyntheticCompanionOptions = {
  sessionId: string;
  conversations: readonly SyntheticCompanionConversationInput[];
  acceptedAdapters?: readonly AdapterIdentity[];
  policy?: Partial<CompanionWorkingSetPolicy>;
  now?: () => number;
};

const CAPABILITIES: CompanionCapabilities = Object.freeze({
  paging: true,
  search: true,
  branches: true,
  codeOnDemand: true,
  jumpBack: true,
  submission: false,
  persistence: false,
  privateContent: false,
});

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
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

function token(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.length > 0);
}

function policy(input: Partial<CompanionWorkingSetPolicy> | undefined): CompanionWorkingSetPolicy {
  const resolved = { ...DEFAULT_COMPANION_WORKING_SET_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(resolved);
}

function pair(identity: AdapterIdentity): string {
  return `${identity.id}\u0000${identity.version}`;
}

function payloadForOperation(
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
      if (!(input.cursor === null || token(input.cursor))) issues.push(issue("$.payload.cursor", "invalid-cursor", "Expected null or a bounded cursor token."));
      if (!positiveInteger(input.limit)) issues.push(issue("$.payload.limit", "invalid-limit", "Expected a positive integer."));
      break;
    case "open":
      exact(["conversationId", "anchorEntryId", "before", "after"]);
      if (!token(input.conversationId)) issues.push(issue("$.payload.conversationId", "invalid-id", "Expected a bounded conversation id."));
      if (!(input.anchorEntryId === null || token(input.anchorEntryId))) issues.push(issue("$.payload.anchorEntryId", "invalid-id", "Expected null or a bounded entry id."));
      if (!nonNegativeInteger(input.before) || !nonNegativeInteger(input.after)) issues.push(issue("$.payload", "invalid-window", "Expected non-negative page bounds."));
      break;
    case "page":
      exact(["conversationId", "cursor", "direction", "limit"]);
      if (!token(input.conversationId) || !token(input.cursor)) issues.push(issue("$.payload", "invalid-id", "Expected bounded conversation and cursor ids."));
      if (input.direction !== "before" && input.direction !== "after") issues.push(issue("$.payload.direction", "invalid-direction", "Expected before or after."));
      if (!positiveInteger(input.limit)) issues.push(issue("$.payload.limit", "invalid-limit", "Expected a positive integer."));
      break;
    case "entry":
    case "navigate":
      exact(["conversationId", "entryId"]);
      if (!token(input.conversationId) || !token(input.entryId)) issues.push(issue("$.payload", "invalid-id", "Expected bounded conversation and entry ids."));
      break;
    case "code":
      exact(["conversationId", "entryId", "blockIndex"]);
      if (!token(input.conversationId) || !token(input.entryId)) issues.push(issue("$.payload", "invalid-id", "Expected bounded conversation and entry ids."));
      if (!nonNegativeInteger(input.blockIndex)) issues.push(issue("$.payload.blockIndex", "invalid-index", "Expected a non-negative block index."));
      break;
    case "search":
      exact(["conversationId", "query", "limit"]);
      if (!token(input.conversationId)) issues.push(issue("$.payload.conversationId", "invalid-id", "Expected a bounded conversation id."));
      if (!boundedString(input.query, 4_096)) issues.push(issue("$.payload.query", "invalid-query", "Expected a bounded non-empty query."));
      if (!positiveInteger(input.limit)) issues.push(issue("$.payload.limit", "invalid-limit", "Expected a positive integer."));
      break;
    case "status":
      exact(["conversationId"]);
      if (!(input.conversationId === null || token(input.conversationId))) issues.push(issue("$.payload.conversationId", "invalid-id", "Expected null or a bounded conversation id."));
      break;
    case "close":
      exact(["conversationId"]);
      if (!token(input.conversationId)) issues.push(issue("$.payload.conversationId", "invalid-id", "Expected a bounded conversation id."));
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
    resolved = policy(inputPolicy);
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
    if (!isRecord(input)) return { ok: false, issues: [issue("$", "request-not-object", "Expected a protocol request object.")] };
    const issues: ValidationIssue[] = [];
    exactKeys(input, ["version", "sessionId", "requestId", "operation", "payload"], "$", issues);
    if (input.version !== COMPANION_PROTOCOL_VERSION) issues.push(issue("$.version", "unsupported-protocol-version", "Unsupported protocol version."));
    if (!token(input.sessionId)) issues.push(issue("$.sessionId", "invalid-session-id", "Expected a bounded session id."));
    if (!token(input.requestId)) issues.push(issue("$.requestId", "invalid-request-id", "Expected a bounded request id."));
    if (typeof input.operation !== "string" || !OPERATIONS.has(input.operation as CompanionOperation)) {
      issues.push(issue("$.operation", "unsupported-operation", "Unsupported protocol operation."));
    }
    const operation = typeof input.operation === "string" && OPERATIONS.has(input.operation as CompanionOperation)
      ? input.operation as CompanionOperation
      : null;
    const payload = operation ? payloadForOperation(operation, input.payload, issues) : null;
    if (issues.length > 0 || !operation || !payload || typeof input.sessionId !== "string" || typeof input.requestId !== "string") {
      return { ok: false, issues };
    }
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

type SourceConversation = {
  id: string;
  representation: ReadOnlyRepresentation | null;
};

type ResidentConversation = {
  id: string;
  generation: number;
  lastAccess: number;
  recordKeys: Set<string>;
};

type ResidentRecord = {
  key: string;
  kind: "page" | "search";
  conversationId: string;
  generation: number;
  serialized: string;
  serializedBytes: number;
  accountedBytes: number;
  entryCount: number;
  textCodeUnits: number;
  lastAccess: number;
};

type PreparedOperation = {
  conversationId: string | null;
  generation: number | null;
  commit: () => { payload: unknown; resident?: ResidentRecord } | CompanionErrorCode;
};

function truncate(value: string | undefined, maximum: number): { value?: string; truncated: boolean } {
  if (value === undefined) return { truncated: false };
  if (value.length <= maximum) return { value, truncated: false };
  return { value: value.slice(0, maximum), truncated: true };
}

function cursorFor(conversationId: string, generation: number, start: number, end: number): string {
  return `p1_${conversationId}_${generation}_${start}_${end}`;
}

function parseCursor(cursor: string): { conversationId: string; generation: number; start: number; end: number } | null {
  const match = /^p1_([A-Za-z0-9][A-Za-z0-9_-]{0,127})_([0-9]+)_([0-9]+)_([0-9]+)$/u.exec(cursor);
  if (!match) return null;
  const generation = Number(match[2]);
  const start = Number(match[3]);
  const end = Number(match[4]);
  if (![generation, start, end].every(Number.isSafeInteger) || generation < 0 || start < 0 || end < start) return null;
  return { conversationId: match[1]!, generation, start, end };
}

function snippet(text: string, needle: string, maximum: number): string {
  const lower = text.toLocaleLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0) return "";
  const half = Math.floor(maximum / 2);
  const start = Math.max(0, index - half);
  return text.slice(start, start + maximum);
}

export class SyntheticCompanion {
  readonly #sessionId: string;
  readonly #createdAt: number;
  readonly #sources = new Map<string, SourceConversation>();
  readonly #residentConversations = new Map<string, ResidentConversation>();
  readonly #records = new Map<string, ResidentRecord>();
  readonly #generations = new Map<string, number>();
  readonly #policy: CompanionWorkingSetPolicy;
  readonly #now: () => number;
  #acceptedAdapters = new Set<string>();
  #active = true;
  #sessionEpoch = 0;
  #access = 0;
  #inFlight = 0;
  #queuedPages = 0;
  #residentEntries = 0;
  #residentTextCodeUnits = 0;
  #residentSerializedBytes = 0;
  #residentAccountedBytes = 0;

  constructor(options: SyntheticCompanionOptions) {
    if (!token(options.sessionId)) throw new TypeError("sessionId must be a bounded local token.");
    this.#sessionId = options.sessionId;
    this.#policy = policy(options.policy);
    this.#now = options.now ?? Date.now;
    this.#createdAt = this.#now();

    for (const input of options.conversations) {
      if (!token(input.id) || this.#sources.has(input.id)) throw new TypeError("Conversation ids must be unique bounded local tokens.");
      const validated = validateAndMeasureReadOnlyRepresentation(input.representation);
      this.#sources.set({} as never, {} as never);
      this.#sources.delete({} as never);
      this.#sources.set(input.id, {
        id: input.id,
        representation: validated.ok ? validated.value.representation : null,
      });
      this.#generations.set(input.id, 0);
    }

    const accepted = options.acceptedAdapters ?? [...this.#sources.values()]
      .map((source) => source.representation?.adapter)
      .filter((value): value is AdapterIdentity => value !== undefined);
    this.#acceptedAdapters = new Set(accepted.map(pair));
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get policy(): CompanionWorkingSetPolicy {
    return this.#policy;
  }

  get usage(): CompanionUsage {
    return Object.freeze({
      residentConversationCount: this.#residentConversations.size,
      residentRecordCount: this.#records.size,
      residentEntryCount: this.#residentEntries,
      residentTextCodeUnits: this.#residentTextCodeUnits,
      residentSerializedBytes: this.#residentSerializedBytes,
      residentAccountedBytes: this.#residentAccountedBytes,
      inFlightRequests: this.#inFlight,
      queuedPageRequests: this.#queuedPages,
    });
  }

  updateAcceptedAdapters(identities: readonly AdapterIdentity[]): void {
    this.#acceptedAdapters = new Set(identities.map(pair));
    for (const [id, source] of this.#sources) {
      if (source.representation && !this.#acceptedAdapters.has(pair(source.representation.adapter))) {
        this.#releaseConversation(id);
      }
    }
  }

  #error(
    requestId: string,
    operation: CompanionOperation | "invalid",
    code: CompanionErrorCode,
  ): CompanionResponseEnvelope {
    return {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId: token(requestId) ? requestId : "invalid",
      operation,
      ok: false,
      payload: null,
      errorCode: code,
      usage: this.usage,
    };
  }

  #response(
    requestId: string,
    operation: CompanionOperation,
    payload: unknown,
  ): CompanionResponseEnvelope {
    const candidate: CompanionResponseEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId,
      operation,
      ok: true,
      payload,
      errorCode: null,
      usage: this.usage,
    };
    const measured = serializeBoundedJson(candidate, {
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringCodeUnits: this.#policy.maxCodeResponseCodeUnits,
      maxSerializedBytes: this.#policy.maxResponseSerializedBytes,
    });
    return measured.ok ? candidate : this.#error(requestId, operation, "response-too-large");
  }

  #sourceState(conversationId: string):
    | { source: SourceConversation; representation: ReadOnlyRepresentation; freshness: Exclude<FreshnessState, "expired"> }
    | CompanionErrorCode {
    const source = this.#sources.get(conversationId);
    if (!source) return "conversation-missing";
    if (!source.representation) return "conversation-corrupt";
    if (!this.#acceptedAdapters.has(pair(source.representation.adapter))) return "adapter-drift";
    const freshness = resolveFreshnessState(source.representation.provenance.freshness, this.#now());
    if (freshness === "expired") {
      this.#releaseConversation(conversationId);
      return "conversation-expired";
    }
    return { source, representation: source.representation, freshness };
  }

  #generation(conversationId: string): number {
    return this.#generations.get(conversationId) ?? 0;
  }

  #removeRecord(key: string): boolean {
    const record = this.#records.get(key);
    if (!record) return false;
    this.#records.delete(key);
    this.#residentEntries -= record.entryCount;
    this.#residentTextCodeUnits -= record.textCodeUnits;
    this.#residentSerializedBytes -= record.serializedBytes;
    this.#residentAccountedBytes -= record.accountedBytes;
    const conversation = this.#residentConversations.get(record.conversationId);
    conversation?.recordKeys.delete(key);
    return true;
  }

  #releaseConversation(conversationId: string): boolean {
    const conversation = this.#residentConversations.get(conversationId);
    if (conversation) {
      for (const key of [...conversation.recordKeys]) this.#removeRecord(key);
      this.#residentConversations.delete(conversationId);
    }
    this.#generations.set(conversationId, this.#generation(conversationId) + 1);
    return conversation !== undefined;
  }

  #clearResident(): void {
    this.#records.clear();
    this.#residentConversations.clear();
    this.#residentEntries = 0;
    this.#residentTextCodeUnits = 0;
    this.#residentSerializedBytes = 0;
    this.#residentAccountedBytes = 0;
    for (const id of this.#sources.keys()) this.#generations.set(id, this.#generation(id) + 1);
  }

  #touchConversation(conversationId: string): ResidentConversation {
    let conversation = this.#residentConversations.get(conversationId);
    if (!conversation) {
      if (this.#residentConversations.size >= this.#policy.maxResidentConversations) {
        const oldest = [...this.#residentConversations.values()]
          .sort((left, right) => left.lastAccess - right.lastAccess || left.id.localeCompare(right.id))[0];
        if (oldest) this.#releaseConversation(oldest.id);
      }
      conversation = {
        id: conversationId,
        generation: this.#generation(conversationId),
        lastAccess: ++this.#access,
        recordKeys: new Set(),
      };
      this.#residentConversations.set(conversationId, conversation);
    } else {
      conversation.lastAccess = ++this.#access;
    }
    return conversation;
  }

  #admit(record: ResidentRecord): CompanionErrorCode | null {
    if (
      record.entryCount > this.#policy.maxResidentEntries ||
      record.textCodeUnits > this.#policy.maxResidentTextCodeUnits ||
      record.serializedBytes > this.#policy.maxResidentSerializedBytes ||
      record.accountedBytes > this.#policy.maxResidentAccountedBytes
    ) return "resident-limit";

    const conversation = this.#touchConversation(record.conversationId);
    const existing = this.#records.get(record.key);
    const removals = new Set<string>();
    if (existing) removals.add(existing.key);

    const sameKind = [...conversation.recordKeys]
      .map((key) => this.#records.get(key))
      .filter((value): value is ResidentRecord => value !== undefined && value.kind === record.kind && value.key !== record.key)
      .sort((left, right) => left.lastAccess - right.lastAccess || left.key.localeCompare(right.key));
    const maximumKind = record.kind === "page"
      ? this.#policy.maxResidentPagesPerConversation
      : this.#policy.maxResidentSearchesPerConversation;
    const excessKind = Math.max(0, sameKind.length + 1 - maximumKind);
    sameKind.slice(0, excessKind).forEach((value) => removals.add(value.key));

    const all = [...this.#records.values()]
      .filter((value) => value.key !== record.key)
      .sort((left, right) => left.lastAccess - right.lastAccess || left.key.localeCompare(right.key));
    let futureCount = this.#records.size + 1;
    let futureEntries = this.#residentEntries + record.entryCount;
    let futureText = this.#residentTextCodeUnits + record.textCodeUnits;
    let futureSerialized = this.#residentSerializedBytes + record.serializedBytes;
    let futureAccounted = this.#residentAccountedBytes + record.accountedBytes;
    for (const key of removals) {
      const removed = this.#records.get(key);
      if (!removed) continue;
      futureCount -= 1;
      futureEntries -= removed.entryCount;
      futureText -= removed.textCodeUnits;
      futureSerialized -= removed.serializedBytes;
      futureAccounted -= removed.accountedBytes;
    }

    for (const candidate of all) {
      if (
        futureCount <= this.#policy.maxResidentRecords &&
        futureEntries <= this.#policy.maxResidentEntries &&
        futureText <= this.#policy.maxResidentTextCodeUnits &&
        futureSerialized <= this.#policy.maxResidentSerializedBytes &&
        futureAccounted <= this.#policy.maxResidentAccountedBytes
      ) break;
      if (removals.has(candidate.key)) continue;
      removals.add(candidate.key);
      futureCount -= 1;
      futureEntries -= candidate.entryCount;
      futureText -= candidate.textCodeUnits;
      futureSerialized -= candidate.serializedBytes;
      futureAccounted -= candidate.accountedBytes;
    }

    if (
      futureCount > this.#policy.maxResidentRecords ||
      futureEntries > this.#policy.maxResidentEntries ||
      futureText > this.#policy.maxResidentTextCodeUnits ||
      futureSerialized > this.#policy.maxResidentSerializedBytes ||
      futureAccounted > this.#policy.maxResidentAccountedBytes
    ) return "resident-limit";

    for (const key of removals) this.#removeRecord(key);
    record.lastAccess = ++this.#access;
    this.#records.set(record.key, record);
    conversation.recordKeys.add(record.key);
    conversation.lastAccess = record.lastAccess;
    this.#residentEntries += record.entryCount;
    this.#residentTextCodeUnits += record.textCodeUnits;
    this.#residentSerializedBytes += record.serializedBytes;
    this.#residentAccountedBytes += record.accountedBytes;
    return null;
  }

  #residentRecord(
    kind: "page" | "search",
    conversationId: string,
    generation: number,
    key: string,
    payload: unknown,
    entryCount: number,
    textCodeUnits: number,
    maximumBytes: number,
  ): ResidentRecord | CompanionErrorCode {
    const serialized = serializeBoundedJson(payload, {
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringCodeUnits: this.#policy.maxCodeResponseCodeUnits,
      maxSerializedBytes: maximumBytes,
    });
    if (!serialized.ok) return kind === "page" ? "page-too-large" : "search-limit";
    let accountedBytes: number;
    try {
      accountedBytes = accountedResidentBytes(serialized.value.serialized, 1);
    } catch {
      return "resident-limit";
    }
    return {
      key,
      kind,
      conversationId,
      generation,
      serialized: serialized.value.serialized,
      serializedBytes: serialized.value.usage.serializedBytes,
      accountedBytes,
      entryCount,
      textCodeUnits,
      lastAccess: 0,
    };
  }

  #pagePayload(
    conversationId: string,
    representation: ReadOnlyRepresentation,
    freshness: Exclude<FreshnessState, "expired">,
    generation: number,
    start: number,
    end: number,
  ): { payload: CompanionPagePayload; record: ResidentRecord } | CompanionErrorCode {
    const active = new Set(representation.activePath);
    let textCodeUnits = 0;
    const entries: CompanionPageEntry[] = [];
    for (const entry of representation.entries.slice(start, end)) {
      const clipped = truncate(entry.text, this.#policy.maxPageEntryTextCodeUnits);
      textCodeUnits += clipped.value?.length ?? 0;
      if (textCodeUnits > this.#policy.maxPageTextCodeUnits) return "page-limit";
      entries.push({
        id: entry.id,
        parentId: entry.parentId,
        childCount: entry.childIds.length,
        sequence: entry.sequence,
        kind: entry.kind,
        ...(entry.label ? { label: entry.label } : {}),
        ...(clipped.value !== undefined ? { text: clipped.value } : {}),
        textTruncated: clipped.truncated,
        codeBlockCount: entry.codeBlocks.length,
        active: active.has(entry.id),
        ...(entry.jumpBackReference ? { jumpBackReference: entry.jumpBackReference } : {}),
      });
    }
    const cursor = cursorFor(conversationId, generation, start, end);
    const payload: CompanionPagePayload = {
      conversationId,
      generation,
      cursor,
      hasBefore: start > 0,
      hasAfter: end < representation.entries.length,
      freshness,
      adapter: representation.adapter,
      provenance: representation.provenance,
      entries,
    };
    const record = this.#residentRecord(
      "page",
      conversationId,
      generation,
      `page:${cursor}`,
      payload,
      entries.length,
      textCodeUnits,
      this.#policy.maxPageSerializedBytes,
    );
    return typeof record === "string" ? record : { payload, record };
  }

  #conversationMetadata(source: SourceConversation): CompanionConversationMetadata {
    if (!source.representation) {
      return { id: source.id, entryCount: 0, adapter: null, freshness: "corrupt", capabilities: CAPABILITIES };
    }
    const drifted = !this.#acceptedAdapters.has(pair(source.representation.adapter));
    return {
      id: source.id,
      entryCount: source.representation.entries.length,
      adapter: source.representation.adapter,
      freshness: drifted ? "drifted" : resolveFreshnessState(source.representation.provenance.freshness, this.#now()),
      capabilities: CAPABILITIES,
    };
  }

  #prepare(request: CompanionRequestEnvelope): PreparedOperation | CompanionErrorCode {
    const payload = request.payload;
    const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : null;
    const initialGeneration = conversationId ? this.#generation(conversationId) : null;

    switch (request.operation) {
      case "list": {
        const limit = Math.min(payload.limit as number, 100);
        const sorted = [...this.#sources.values()].sort((left, right) => left.id.localeCompare(right.id));
        const offset = payload.cursor === null ? 0 : Number(String(payload.cursor).replace(/^l1_/, ""));
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > sorted.length) return "cursor-invalid";
        const items = sorted.slice(offset, offset + limit).map((source) => this.#conversationMetadata(source));
        return {
          conversationId: null,
          generation: null,
          commit: () => ({ payload: { items, nextCursor: offset + items.length < sorted.length ? `l1_${offset + items.length}` : null } }),
        };
      }
      case "open": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const before = payload.before as number;
        const after = payload.after as number;
        if (before + after + 1 > this.#policy.maxPageEntries) return "page-limit";
        const anchorId = payload.anchorEntryId as string | null;
        const anchor = anchorId === null
          ? Math.max(0, state.representation.entries.findIndex((entry) => entry.id === state.representation.activePath.at(-1)))
          : state.representation.entries.findIndex((entry) => entry.id === anchorId);
        if (anchor < 0) return "entry-missing";
        const start = Math.max(0, anchor - before);
        const end = Math.min(state.representation.entries.length, anchor + after + 1);
        const page = this.#pagePayload(conversationId, state.representation, state.freshness, initialGeneration!, start, end);
        if (typeof page === "string") return page;
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            const error = this.#admit(page.record);
            return error ?? { payload: page.payload, resident: page.record };
          },
        };
      }
      case "page": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const decoded = parseCursor(payload.cursor as string);
        if (!decoded || decoded.conversationId !== conversationId) return "cursor-invalid";
        if (decoded.generation !== initialGeneration) return "cursor-stale";
        const limit = payload.limit as number;
        if (limit > this.#policy.maxPageEntries) return "page-limit";
        const start = payload.direction === "before"
          ? Math.max(0, decoded.start - limit)
          : decoded.end;
        const end = payload.direction === "before"
          ? decoded.start
          : Math.min(state.representation.entries.length, decoded.end + limit);
        if (start === end) return "page-limit";
        const page = this.#pagePayload(conversationId, state.representation, state.freshness, initialGeneration!, start, end);
        if (typeof page === "string") return page;
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            const error = this.#admit(page.record);
            return error ?? { payload: page.payload, resident: page.record };
          },
        };
      }
      case "entry": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const entry = state.representation.entries.find((candidate) => candidate.id === payload.entryId);
        if (!entry) return "entry-missing";
        const clipped = truncate(entry.text, this.#policy.maxPageEntryTextCodeUnits);
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => ({ payload: {
            conversationId,
            generation: initialGeneration,
            entry: {
              id: entry.id,
              parentId: entry.parentId,
              childCount: entry.childIds.length,
              sequence: entry.sequence,
              kind: entry.kind,
              ...(entry.label ? { label: entry.label } : {}),
              ...(clipped.value !== undefined ? { text: clipped.value } : {}),
              textTruncated: clipped.truncated,
              codeBlockCount: entry.codeBlocks.length,
              ...(entry.jumpBackReference ? { jumpBackReference: entry.jumpBackReference } : {}),
            },
            freshness: state.freshness,
          } }),
        };
      }
      case "code": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const entry = state.representation.entries.find((candidate) => candidate.id === payload.entryId);
        const block = entry?.codeBlocks[payload.blockIndex as number];
        if (!block) return "code-missing";
        if (block.text.length > this.#policy.maxCodeResponseCodeUnits) return "resource-too-large";
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => ({ payload: {
            conversationId,
            generation: initialGeneration,
            entryId: entry!.id,
            blockIndex: payload.blockIndex,
            block: { ...block },
          } }),
        };
      }
      case "search": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const maximum = Math.min(payload.limit as number, this.#policy.maxSearchResults);
        const needle = (payload.query as string).trim().toLocaleLowerCase();
        if (!needle) return "search-limit";
        let indexEntries = 0;
        let indexText = 0;
        const results: CompanionSearchResult[] = [];
        for (const entry of state.representation.entries) {
          indexEntries += 1;
          if (indexEntries > this.#policy.maxIndexEntries) return "index-limit";
          const sources = [entry.label, entry.text, ...entry.codeBlocks.map((block) => block.text)]
            .filter((value): value is string => typeof value === "string");
          indexText += sources.reduce((total, value) => total + value.length, 0);
          if (indexText > this.#policy.maxIndexTextCodeUnits) return "index-limit";
          let found = "";
          for (const source of sources) {
            found = snippet(source, needle, this.#policy.maxSnippetCodeUnits);
            if (found) break;
          }
          if (found) {
            results.push({
              entryId: entry.id,
              sequence: entry.sequence,
              ...(entry.label ? { label: entry.label } : {}),
              snippet: found,
            });
          }
          if (results.length >= maximum) break;
        }
        const responsePayload = {
          conversationId,
          generation: initialGeneration,
          freshness: state.freshness,
          results,
          truncated: results.length >= maximum,
        };
        const textUnits = results.reduce((total, result) => total + result.snippet.length, 0);
        const record = this.#residentRecord(
          "search",
          conversationId,
          initialGeneration!,
          `search:${conversationId}:${initialGeneration}:${request.requestId}`,
          responsePayload,
          results.length,
          textUnits,
          this.#policy.maxSearchSerializedBytes,
        );
        if (typeof record === "string") return record;
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            const error = this.#admit(record);
            return error ?? { payload: responsePayload, resident: record };
          },
        };
      }
      case "navigate": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const entry = state.representation.entries.find((candidate) => candidate.id === payload.entryId);
        if (!entry) return "entry-missing";
        const parent = entry.parentId;
        const children = entry.childIds.slice(0, this.#policy.maxRelationshipIds);
        const parentEntry = parent
          ? state.representation.entries.find((candidate) => candidate.id === parent)
          : undefined;
        const siblings = parentEntry
          ? parentEntry.childIds.filter((id) => id !== entry.id).slice(0, this.#policy.maxRelationshipIds)
          : [];
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => ({ payload: {
            conversationId,
            generation: initialGeneration,
            entryId: entry.id,
            parentId: parent,
            childIds: children,
            childCount: entry.childIds.length,
            siblingIds: siblings,
            siblingCount: parentEntry ? Math.max(0, parentEntry.childIds.length - 1) : 0,
            activePath: state.representation.activePath.slice(0, this.#policy.maxRelationshipIds),
            jumpBackReference: entry.jumpBackReference ?? state.representation.provenance.authority.reference ?? null,
          } }),
        };
      }
      case "status": {
        const requested = payload.conversationId as string | null;
        const metadata = requested === null
          ? null
          : this.#sources.has(requested)
            ? this.#conversationMetadata(this.#sources.get(requested)!)
            : null;
        if (requested !== null && metadata === null) return "conversation-missing";
        return {
          conversationId: requested,
          generation: requested ? initialGeneration : null,
          commit: () => ({ payload: {
            active: this.#active,
            sessionExpiresAt: this.#createdAt + this.#policy.sessionTtlMs,
            conversation: metadata,
            usage: this.usage,
          } }),
        };
      }
      case "close":
        if (!conversationId || !this.#sources.has(conversationId)) return "conversation-missing";
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            this.#releaseConversation(conversationId);
            return { payload: { conversationId, released: true, generation: this.#generation(conversationId) } };
          },
        };
      case "revoke":
        return {
          conversationId: null,
          generation: null,
          commit: () => {
            this.#active = false;
            this.#sessionEpoch += 1;
            this.#clearResident();
            return { payload: { revoked: true } };
          },
        };
    }
  }

  async dispatch(
    input: unknown,
    options: SyntheticCompanionDispatchOptions = {},
  ): Promise<CompanionResponseEnvelope> {
    const parsed = parseCompanionRequest(input, this.#policy);
    if (!parsed.ok) return this.#error("invalid", "invalid", "invalid-request");
    const request = parsed.value;
    if (request.sessionId !== this.#sessionId) return this.#error(request.requestId, request.operation, "session-mismatch");
    if (!this.#active) return this.#error(request.requestId, request.operation, "session-revoked");
    if (this.#now() >= this.#createdAt + this.#policy.sessionTtlMs) {
      this.#active = false;
      this.#sessionEpoch += 1;
      this.#clearResident();
      return this.#error(request.requestId, request.operation, "session-expired");
    }
    if (this.#inFlight >= this.#policy.maxInFlightRequests) {
      return this.#error(request.requestId, request.operation, "too-many-in-flight");
    }
    const queued = request.operation === "open" || request.operation === "page";
    if (queued && this.#queuedPages >= this.#policy.maxQueuedPageRequests) {
      return this.#error(request.requestId, request.operation, "too-many-queued-pages");
    }

    const prepared = this.#prepare(request);
    if (typeof prepared === "string") return this.#error(request.requestId, request.operation, prepared);
    const epoch = this.#sessionEpoch;
    this.#inFlight += 1;
    if (queued) this.#queuedPages += 1;
    let result: { payload: unknown; resident?: ResidentRecord } | CompanionErrorCode;
    try {
      try {
        await options.beforeCommit?.();
      } catch {
        return this.#error(request.requestId, request.operation, "request-cancelled");
      }
      if (!this.#active || this.#sessionEpoch !== epoch) {
        return this.#error(request.requestId, request.operation, "request-cancelled");
      }
      if (
        prepared.conversationId !== null &&
        prepared.generation !== null &&
        this.#generation(prepared.conversationId) !== prepared.generation
      ) {
        return this.#error(request.requestId, request.operation, "request-cancelled");
      }
      result = prepared.commit();
    } finally {
      this.#inFlight -= 1;
      if (queued) this.#queuedPages -= 1;
    }
    if (typeof result === "string") return this.#error(request.requestId, request.operation, result);
    return this.#response(request.requestId, request.operation, result.payload);
  }
}

export type CompanionClientPolicy = Readonly<{
  maxPendingRequests: number;
  maxConversationMetadata: number;
  maxTimelineEntries: number;
  maxSearchResults: number;
  maxCodeTextCodeUnits: number;
  maxStateSerializedBytes: number;
}>;

export const DEFAULT_COMPANION_CLIENT_POLICY: CompanionClientPolicy = Object.freeze({
  maxPendingRequests: 8,
  maxConversationMetadata: 100,
  maxTimelineEntries: 50,
  maxSearchResults: 50,
  maxCodeTextCodeUnits: 262_144,
  maxStateSerializedBytes: 2_097_152,
});

export type CompanionClientSnapshot = Readonly<{
  conversations: readonly CompanionConversationMetadata[];
  page: CompanionPagePayload | null;
  searchResults: readonly CompanionSearchResult[];
  code: (ReadOnlyCodeBlock & { conversationId: string; entryId: string; blockIndex: number }) | null;
  lastError: CompanionErrorCode | null;
  pendingRequestCount: number;
}>;

function clientPolicy(input: Partial<CompanionClientPolicy> | undefined): CompanionClientPolicy {
  const resolved = { ...DEFAULT_COMPANION_CLIENT_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return Object.freeze(resolved);
}

export class BoundedCompanionClientState {
  readonly #sessionId: string;
  readonly #policy: CompanionClientPolicy;
  readonly #pending = new Set<string>();
  #snapshot: CompanionClientSnapshot = Object.freeze({
    conversations: Object.freeze([]),
    page: null,
    searchResults: Object.freeze([]),
    code: null,
    lastError: null,
    pendingRequestCount: 0,
  });

  constructor(sessionId: string, inputPolicy?: Partial<CompanionClientPolicy>) {
    if (!token(sessionId)) throw new TypeError("sessionId must be a bounded local token.");
    this.#sessionId = sessionId;
    this.#policy = clientPolicy(inputPolicy);
  }

  get snapshot(): CompanionClientSnapshot {
    return structuredClone(this.#snapshot);
  }

  expect(requestId: string): ValidationResult<number> {
    if (!token(requestId)) return { ok: false, issues: [issue("$.requestId", "invalid-request-id", "Expected a bounded request id.")] };
    if (this.#pending.size >= this.#policy.maxPendingRequests) {
      return { ok: false, issues: [issue("$.pending", "client-pending-limit", "Client pending-request limit reached.")] };
    }
    this.#pending.add(requestId);
    this.#refreshPendingCount();
    return { ok: true, value: this.#pending.size, warnings: [] };
  }

  cancel(requestId: string): boolean {
    const removed = this.#pending.delete(requestId);
    this.#refreshPendingCount();
    return removed;
  }

  clear(): void {
    this.#pending.clear();
    this.#snapshot = Object.freeze({
      conversations: Object.freeze([]),
      page: null,
      searchResults: Object.freeze([]),
      code: null,
      lastError: null,
      pendingRequestCount: 0,
    });
  }

  #refreshPendingCount(): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, pendingRequestCount: this.#pending.size });
  }

  apply(response: CompanionResponseEnvelope): ValidationResult<CompanionClientSnapshot> {
    if (response.sessionId !== this.#sessionId || !this.#pending.has(response.requestId)) {
      return { ok: false, issues: [issue("$", "client-response-unexpected", "Response does not match a pending local request.")] };
    }
    this.#pending.delete(response.requestId);
    let candidate: CompanionClientSnapshot = {
      ...this.#snapshot,
      pendingRequestCount: this.#pending.size,
      lastError: response.ok ? null : response.errorCode,
    };

    if (response.ok && isRecord(response.payload)) {
      switch (response.operation) {
        case "list": {
          const items = Array.isArray(response.payload.items)
            ? response.payload.items.slice(0, this.#policy.maxConversationMetadata) as CompanionConversationMetadata[]
            : [];
          candidate = { ...candidate, conversations: items };
          break;
        }
        case "open":
        case "page": {
          const page = response.payload as unknown as CompanionPagePayload;
          if (!Array.isArray(page.entries) || page.entries.length > this.#policy.maxTimelineEntries) {
            return { ok: false, issues: [issue("$.payload.entries", "client-timeline-limit", "Timeline response exceeds the client policy.")] };
          }
          candidate = { ...candidate, page: structuredClone(page), code: null };
          break;
        }
        case "search": {
          const results = Array.isArray(response.payload.results)
            ? response.payload.results.slice(0, this.#policy.maxSearchResults) as CompanionSearchResult[]
            : [];
          candidate = { ...candidate, searchResults: structuredClone(results) };
          break;
        }
        case "code": {
          const block = isRecord(response.payload.block) ? response.payload.block : null;
          if (!block || typeof block.text !== "string" || block.text.length > this.#policy.maxCodeTextCodeUnits) {
            return { ok: false, issues: [issue("$.payload.block", "client-code-limit", "Code response exceeds the client policy.")] };
          }
          candidate = {
            ...candidate,
            code: {
              ...(typeof block.language === "string" ? { language: block.language } : {}),
              text: block.text,
              conversationId: String(response.payload.conversationId),
              entryId: String(response.payload.entryId),
              blockIndex: Number(response.payload.blockIndex),
            },
          };
          break;
        }
        case "close": {
          const closed = response.payload.conversationId;
          candidate = {
            ...candidate,
            page: candidate.page?.conversationId === closed ? null : candidate.page,
            searchResults: candidate.page?.conversationId === closed ? [] : candidate.searchResults,
            code: candidate.code?.conversationId === closed ? null : candidate.code,
          };
          break;
        }
        case "revoke":
          this.clear();
          return { ok: true, value: this.snapshot, warnings: [] };
        default:
          break;
      }
    }

    const measured = serializeBoundedJson(candidate, {
      maxDepth: 64,
      maxNodes: 100_000,
      maxStringCodeUnits: this.#policy.maxCodeTextCodeUnits,
      maxSerializedBytes: this.#policy.maxStateSerializedBytes,
    });
    if (!measured.ok) {
      this.#refreshPendingCount();
      return { ok: false, issues: [issue("$", "client-state-limit", "Client state exceeds the local resource policy.")] };
    }
    this.#snapshot = Object.freeze(JSON.parse(measured.value.serialized) as CompanionClientSnapshot);
    return { ok: true, value: this.snapshot, warnings: [] };
  }
}
