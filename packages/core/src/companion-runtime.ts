// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import {
  COMPANION_CAPABILITIES,
  COMPANION_PROTOCOL_VERSION,
  isCompanionToken,
  parseCompanionRequest,
  resolveCompanionWorkingSetPolicy,
  type CompanionConversationMetadata,
  type CompanionErrorCode,
  type CompanionOperation,
  type CompanionPageEntry,
  type CompanionPagePayload,
  type CompanionRequestEnvelope,
  type CompanionResponseEnvelope,
  type CompanionSearchResult,
  type CompanionUsage,
  type CompanionWorkingSetPolicy,
} from "./companion-protocol.js";
import {
  resolveFreshnessState,
  validateAndMeasureReadOnlyRepresentation,
  type FreshnessState,
  type ReadOnlyRepresentation,
} from "./representation.js";
import {
  accountedResidentBytes,
  serializeBoundedJson,
} from "./resource-accounting.js";

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

type PreparedCommitResult =
  | { payload: unknown; residentRecord?: ResidentRecord }
  | CompanionErrorCode;

type PreparedOperation = {
  conversationId: string | null;
  generation: number | null;
  commit: () => PreparedCommitResult;
};

function pair(identity: AdapterIdentity): string {
  return `${identity.id}\u0000${identity.version}`;
}

function truncate(
  value: string | undefined,
  maximum: number,
): { value?: string; truncated: boolean } {
  if (value === undefined) return { truncated: false };
  if (value.length <= maximum) return { value, truncated: false };
  return { value: value.slice(0, maximum), truncated: true };
}

function cursorFor(
  conversationId: string,
  generation: number,
  start: number,
  end: number,
): string {
  return `p1_${conversationId}_${generation}_${start}_${end}`;
}

function parseCursor(
  cursor: string,
): { conversationId: string; generation: number; start: number; end: number } | null {
  const match = /^p1_([A-Za-z0-9][A-Za-z0-9_-]{0,127})_([0-9]+)_([0-9]+)_([0-9]+)$/u.exec(
    cursor,
  );
  if (!match) return null;
  const generation = Number(match[2]);
  const start = Number(match[3]);
  const end = Number(match[4]);
  if (
    ![generation, start, end].every(Number.isSafeInteger) ||
    generation < 0 ||
    start < 0 ||
    end < start
  ) return null;
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

function numeric(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
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
  #acceptedAdapters: Set<string>;
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
    if (!isCompanionToken(options.sessionId)) {
      throw new TypeError("sessionId must be a bounded local token.");
    }
    this.#sessionId = options.sessionId;
    this.#policy = resolveCompanionWorkingSetPolicy(options.policy);
    this.#now = options.now ?? Date.now;
    this.#createdAt = this.#now();

    for (const input of options.conversations) {
      if (!isCompanionToken(input.id) || this.#sources.has(input.id)) {
        throw new TypeError("Conversation ids must be unique bounded local tokens.");
      }
      const validated = validateAndMeasureReadOnlyRepresentation(input.representation);
      this.#sources.set(input.id, {
        id: input.id,
        representation: validated.ok ? validated.value.representation : null,
      });
      this.#generations.set(input.id, 0);
    }

    const accepted =
      options.acceptedAdapters ??
      [...this.#sources.values()]
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
      if (
        source.representation &&
        !this.#acceptedAdapters.has(pair(source.representation.adapter))
      ) {
        this.#releaseConversation(id);
      }
    }
  }

  #generation(conversationId: string): number {
    return this.#generations.get(conversationId) ?? 0;
  }

  #error(
    requestId: string,
    operation: CompanionOperation | "invalid",
    code: CompanionErrorCode,
  ): CompanionResponseEnvelope {
    return {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId: isCompanionToken(requestId) ? requestId : "invalid",
      operation,
      ok: false,
      payload: null,
      errorCode: code,
      usage: this.usage,
    };
  }

  #success(
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
    return measured.ok
      ? candidate
      : this.#error(requestId, operation, "response-too-large");
  }

  #sourceState(
    conversationId: string,
  ):
    | {
        source: SourceConversation;
        representation: ReadOnlyRepresentation;
        freshness: Exclude<FreshnessState, "expired">;
      }
    | CompanionErrorCode {
    const source = this.#sources.get(conversationId);
    if (!source) return "conversation-missing";
    if (!source.representation) return "conversation-corrupt";
    if (!this.#acceptedAdapters.has(pair(source.representation.adapter))) {
      return "adapter-drift";
    }
    const freshness = resolveFreshnessState(
      source.representation.provenance.freshness,
      this.#now(),
    );
    if (freshness === "expired") {
      this.#releaseConversation(conversationId);
      return "conversation-expired";
    }
    return { source, representation: source.representation, freshness };
  }

  #subtract(record: ResidentRecord): void {
    this.#residentEntries -= record.entryCount;
    this.#residentTextCodeUnits -= record.textCodeUnits;
    this.#residentSerializedBytes -= record.serializedBytes;
    this.#residentAccountedBytes -= record.accountedBytes;
  }

  #add(record: ResidentRecord): void {
    this.#residentEntries += record.entryCount;
    this.#residentTextCodeUnits += record.textCodeUnits;
    this.#residentSerializedBytes += record.serializedBytes;
    this.#residentAccountedBytes += record.accountedBytes;
  }

  #removeRecord(key: string): boolean {
    const record = this.#records.get(key);
    if (!record) return false;
    this.#records.delete(key);
    this.#subtract(record);
    this.#residentConversations.get(record.conversationId)?.recordKeys.delete(key);
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
    for (const id of this.#sources.keys()) {
      this.#generations.set(id, this.#generation(id) + 1);
    }
  }

  #orderedRecords(): ResidentRecord[] {
    return [...this.#records.values()].sort(
      (left, right) => left.lastAccess - right.lastAccess || left.key.localeCompare(right.key),
    );
  }

  #orderedConversations(): ResidentConversation[] {
    return [...this.#residentConversations.values()].sort(
      (left, right) => left.lastAccess - right.lastAccess || left.id.localeCompare(right.id),
    );
  }

  #admit(record: ResidentRecord): CompanionErrorCode | null {
    if (
      record.entryCount > this.#policy.maxResidentEntries ||
      record.textCodeUnits > this.#policy.maxResidentTextCodeUnits ||
      record.serializedBytes > this.#policy.maxResidentSerializedBytes ||
      record.accountedBytes > this.#policy.maxResidentAccountedBytes
    ) {
      return "resident-limit";
    }

    const removals = new Set<string>();
    const candidateExisting = this.#residentConversations.get(record.conversationId);
    const existingRecord = this.#records.get(record.key);
    if (existingRecord) removals.add(existingRecord.key);

    const projectedConversations = new Set(this.#residentConversations.keys());
    projectedConversations.add(record.conversationId);
    for (const conversation of this.#orderedConversations()) {
      if (projectedConversations.size <= this.#policy.maxResidentConversations) break;
      if (conversation.id === record.conversationId) continue;
      projectedConversations.delete(conversation.id);
      for (const key of conversation.recordKeys) removals.add(key);
    }

    const sameKind = [...(candidateExisting?.recordKeys ?? [])]
      .map((key) => this.#records.get(key))
      .filter(
        (value): value is ResidentRecord =>
          value !== undefined &&
          value.kind === record.kind &&
          value.key !== record.key &&
          !removals.has(value.key),
      )
      .sort(
        (left, right) => left.lastAccess - right.lastAccess || left.key.localeCompare(right.key),
      );
    const maximumKind =
      record.kind === "page"
        ? this.#policy.maxResidentPagesPerConversation
        : this.#policy.maxResidentSearchesPerConversation;
    const kindExcess = Math.max(0, sameKind.length + 1 - maximumKind);
    for (const candidate of sameKind.slice(0, kindExcess)) removals.add(candidate.key);

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

    for (const candidate of this.#orderedRecords()) {
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

    const conversationsToDrop = new Set<string>();
    for (const conversation of this.#residentConversations.values()) {
      if (conversation.id === record.conversationId) continue;
      if ([...conversation.recordKeys].every((key) => removals.has(key))) {
        conversationsToDrop.add(conversation.id);
      }
    }

    for (const key of removals) this.#removeRecord(key);
    for (const id of conversationsToDrop) {
      this.#residentConversations.delete(id);
      this.#generations.set(id, this.#generation(id) + 1);
    }

    let conversation = this.#residentConversations.get(record.conversationId);
    if (!conversation) {
      conversation = {
        id: record.conversationId,
        generation: record.generation,
        lastAccess: 0,
        recordKeys: new Set(),
      };
      this.#residentConversations.set(record.conversationId, conversation);
    }
    record.lastAccess = ++this.#access;
    conversation.lastAccess = record.lastAccess;
    conversation.generation = record.generation;
    conversation.recordKeys.add(record.key);
    this.#records.set(record.key, record);
    this.#add(record);
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
  ):
    | { payload: CompanionPagePayload; record: ResidentRecord }
    | CompanionErrorCode {
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
        ...(entry.jumpBackReference
          ? { jumpBackReference: entry.jumpBackReference }
          : {}),
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

  #metadata(source: SourceConversation): CompanionConversationMetadata {
    if (!source.representation) {
      return {
        id: source.id,
        entryCount: 0,
        adapter: null,
        freshness: "corrupt",
        capabilities: COMPANION_CAPABILITIES,
      };
    }
    const drifted = !this.#acceptedAdapters.has(pair(source.representation.adapter));
    return {
      id: source.id,
      entryCount: source.representation.entries.length,
      adapter: source.representation.adapter,
      freshness: drifted
        ? "drifted"
        : resolveFreshnessState(
            source.representation.provenance.freshness,
            this.#now(),
          ),
      capabilities: COMPANION_CAPABILITIES,
    };
  }

  #prepare(request: CompanionRequestEnvelope): PreparedOperation | CompanionErrorCode {
    const payload = request.payload;
    const conversationId =
      typeof payload.conversationId === "string" ? payload.conversationId : null;
    const initialGeneration = conversationId
      ? this.#generation(conversationId)
      : null;

    switch (request.operation) {
      case "list": {
        const limit = Math.min(
          numeric(payload.limit),
          this.#policy.maxResourceMetadataRecords,
        );
        const sorted = [...this.#sources.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        );
        const offset =
          payload.cursor === null
            ? 0
            : Number(String(payload.cursor).replace(/^l1_/, ""));
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > sorted.length
        ) return "cursor-invalid";
        const items = sorted
          .slice(offset, offset + limit)
          .map((source) => this.#metadata(source));
        return {
          conversationId: null,
          generation: null,
          commit: () => ({
            payload: {
              items,
              nextCursor:
                offset + items.length < sorted.length
                  ? `l1_${offset + items.length}`
                  : null,
            },
          }),
        };
      }
      case "open": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const before = numeric(payload.before);
        const after = numeric(payload.after);
        if (before + after + 1 > this.#policy.maxPageEntries) {
          return "page-limit";
        }
        const anchorId = payload.anchorEntryId as string | null;
        const activeId = state.representation.activePath.at(-1);
        const anchor =
          anchorId === null
            ? state.representation.entries.findIndex(
                (entry) => entry.id === activeId,
              )
            : state.representation.entries.findIndex(
                (entry) => entry.id === anchorId,
              );
        if (anchor < 0) return "entry-missing";
        const start = Math.max(0, anchor - before);
        const end = Math.min(
          state.representation.entries.length,
          anchor + after + 1,
        );
        const page = this.#pagePayload(
          conversationId,
          state.representation,
          state.freshness,
          initialGeneration!,
          start,
          end,
        );
        if (typeof page === "string") return page;
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            const error = this.#admit(page.record);
            return error ?? { payload: page.payload, residentRecord: page.record };
          },
        };
      }
      case "page": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const decoded = parseCursor(String(payload.cursor));
        if (!decoded || decoded.conversationId !== conversationId) {
          return "cursor-invalid";
        }
        if (decoded.generation !== initialGeneration) return "cursor-stale";
        const limit = numeric(payload.limit);
        if (limit > this.#policy.maxPageEntries) return "page-limit";
        const start =
          payload.direction === "before"
            ? Math.max(0, decoded.start - limit)
            : decoded.end;
        const end =
          payload.direction === "before"
            ? decoded.start
            : Math.min(
                state.representation.entries.length,
                decoded.end + limit,
              );
        if (start === end) return "page-limit";
        const page = this.#pagePayload(
          conversationId,
          state.representation,
          state.freshness,
          initialGeneration!,
          start,
          end,
        );
        if (typeof page === "string") return page;
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            const error = this.#admit(page.record);
            return error ?? { payload: page.payload, residentRecord: page.record };
          },
        };
      }
      case "entry": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const entry = state.representation.entries.find(
          (candidate) => candidate.id === payload.entryId,
        );
        if (!entry) return "entry-missing";
        const clipped = truncate(
          entry.text,
          this.#policy.maxPageEntryTextCodeUnits,
        );
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => ({
            payload: {
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
                ...(entry.jumpBackReference
                  ? { jumpBackReference: entry.jumpBackReference }
                  : {}),
              },
              freshness: state.freshness,
            },
          }),
        };
      }
      case "code": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const entry = state.representation.entries.find(
          (candidate) => candidate.id === payload.entryId,
        );
        if (!entry) return "entry-missing";
        if (
          entry.codeBlocks.length > this.#policy.maxResourceMetadataRecords
        ) return "resource-too-large";
        const block = entry.codeBlocks[numeric(payload.blockIndex)];
        if (!block) return "code-missing";
        if (block.text.length > this.#policy.maxCodeResponseCodeUnits) {
          return "resource-too-large";
        }
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => ({
            payload: {
              conversationId,
              generation: initialGeneration,
              entryId: entry.id,
              blockIndex: payload.blockIndex,
              block: { ...block },
            },
          }),
        };
      }
      case "search": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const maximum = Math.min(
          numeric(payload.limit),
          this.#policy.maxSearchResults,
        );
        const needle = String(payload.query).trim().toLocaleLowerCase();
        if (!needle) return "search-limit";
        let indexEntries = 0;
        let indexText = 0;
        const results: CompanionSearchResult[] = [];
        for (const entry of state.representation.entries) {
          indexEntries += 1;
          if (indexEntries > this.#policy.maxIndexEntries) return "index-limit";
          const sources = [
            entry.label,
            entry.text,
            ...entry.codeBlocks.map((block) => block.text),
          ].filter((value): value is string => typeof value === "string");
          indexText += sources.reduce(
            (total, value) => total + value.length,
            0,
          );
          if (indexText > this.#policy.maxIndexTextCodeUnits) {
            return "index-limit";
          }
          let found = "";
          for (const source of sources) {
            found = snippet(
              source,
              needle,
              this.#policy.maxSnippetCodeUnits,
            );
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
        const textUnits = results.reduce(
          (total, result) => total + result.snippet.length,
          0,
        );
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
            return error ?? {
              payload: responsePayload,
              residentRecord: record,
            };
          },
        };
      }
      case "navigate": {
        if (!conversationId) return "conversation-missing";
        const state = this.#sourceState(conversationId);
        if (typeof state === "string") return state;
        const entry = state.representation.entries.find(
          (candidate) => candidate.id === payload.entryId,
        );
        if (!entry) return "entry-missing";
        const parentEntry = entry.parentId
          ? state.representation.entries.find(
              (candidate) => candidate.id === entry.parentId,
            )
          : undefined;
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => ({
            payload: {
              conversationId,
              generation: initialGeneration,
              entryId: entry.id,
              parentId: entry.parentId,
              childIds: entry.childIds.slice(
                0,
                this.#policy.maxRelationshipIds,
              ),
              childCount: entry.childIds.length,
              siblingIds: parentEntry
                ? parentEntry.childIds
                    .filter((id) => id !== entry.id)
                    .slice(0, this.#policy.maxRelationshipIds)
                : [],
              siblingCount: parentEntry
                ? Math.max(0, parentEntry.childIds.length - 1)
                : 0,
              activePath: state.representation.activePath.slice(
                0,
                this.#policy.maxRelationshipIds,
              ),
              jumpBackReference:
                entry.jumpBackReference ??
                state.representation.provenance.authority.reference ??
                null,
            },
          }),
        };
      }
      case "status": {
        const requested = payload.conversationId as string | null;
        const metadata =
          requested === null
            ? null
            : this.#sources.has(requested)
              ? this.#metadata(this.#sources.get(requested)!)
              : null;
        if (requested !== null && metadata === null) {
          return "conversation-missing";
        }
        return {
          conversationId: requested,
          generation: requested ? initialGeneration : null,
          commit: () => ({
            payload: {
              active: this.#active,
              sessionExpiresAt:
                this.#createdAt + this.#policy.sessionTtlMs,
              conversation: metadata,
              usage: this.usage,
            },
          }),
        };
      }
      case "close":
        if (!conversationId || !this.#sources.has(conversationId)) {
          return "conversation-missing";
        }
        return {
          conversationId,
          generation: initialGeneration,
          commit: () => {
            this.#releaseConversation(conversationId);
            return {
              payload: {
                conversationId,
                released: true,
                generation: this.#generation(conversationId),
              },
            };
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
    if (request.sessionId !== this.#sessionId) {
      return this.#error(request.requestId, request.operation, "session-mismatch");
    }
    if (!this.#active) {
      return this.#error(request.requestId, request.operation, "session-revoked");
    }
    if (this.#now() >= this.#createdAt + this.#policy.sessionTtlMs) {
      this.#active = false;
      this.#sessionEpoch += 1;
      this.#clearResident();
      return this.#error(request.requestId, request.operation, "session-expired");
    }
    if (this.#inFlight >= this.#policy.maxInFlightRequests) {
      return this.#error(
        request.requestId,
        request.operation,
        "too-many-in-flight",
      );
    }
    const queued = request.operation === "open" || request.operation === "page";
    if (queued && this.#queuedPages >= this.#policy.maxQueuedPageRequests) {
      return this.#error(
        request.requestId,
        request.operation,
        "too-many-queued-pages",
      );
    }

    const prepared = this.#prepare(request);
    if (typeof prepared === "string") {
      return this.#error(request.requestId, request.operation, prepared);
    }

    const epoch = this.#sessionEpoch;
    this.#inFlight += 1;
    if (queued) this.#queuedPages += 1;
    let result: PreparedCommitResult = "request-cancelled";
    try {
      try {
        await options.beforeCommit?.();
      } catch {
        result = "request-cancelled";
        return this.#error(request.requestId, request.operation, result);
      }
      if (!this.#active || this.#sessionEpoch !== epoch) {
        result = "request-cancelled";
      } else if (
        prepared.conversationId !== null &&
        prepared.generation !== null &&
        this.#generation(prepared.conversationId) !== prepared.generation
      ) {
        result = "request-cancelled";
      } else {
        result = prepared.commit();
      }
    } finally {
      this.#inFlight -= 1;
      if (queued) this.#queuedPages -= 1;
    }

    return typeof result === "string"
      ? this.#error(request.requestId, request.operation, result)
      : this.#success(request.requestId, request.operation, result.payload);
  }
}
