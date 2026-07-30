// SPDX-License-Identifier: MPL-2.0

export type LatestMessageCompletion = "complete" | "incomplete" | "unknown";

export type LatestConversationSnapshot = Readonly<{
  conversationId: string;
  title: string | null;
  latestMessageId: string;
  latestMessageCreatedAt: number | null;
  sourceUpdatedAt: number | null;
  importedAt: number;
  completion: LatestMessageCompletion;
  text: string;
  textTruncated: boolean;
  sourceFingerprint: string;
}>;

export type LatestMessageCachePolicy = Readonly<{
  maxEntries: number;
  maxConversationIdCodeUnits: number;
  maxMessageIdCodeUnits: number;
  maxTitleCodeUnits: number;
  maxMessageCodeUnits: number;
  maxFingerprintCodeUnits: number;
  maxTotalTextCodeUnits: number;
  maxSerializedBytes: number;
}>;

export const DEFAULT_LATEST_MESSAGE_CACHE_POLICY: LatestMessageCachePolicy =
  Object.freeze({
    maxEntries: 1_000,
    maxConversationIdCodeUnits: 512,
    maxMessageIdCodeUnits: 512,
    maxTitleCodeUnits: 512,
    maxMessageCodeUnits: 262_144,
    maxFingerprintCodeUnits: 256,
    maxTotalTextCodeUnits: 4_194_304,
    maxSerializedBytes: 8_388_608,
  });

export type LatestMessageCacheCounters = Readonly<{
  hits: number;
  misses: number;
  inserted: number;
  replaced: number;
  duplicates: number;
  stale: number;
  rejected: number;
  evicted: number;
  clears: number;
}>;

export type LatestMessageCacheSnapshot = Readonly<{
  entries: readonly LatestConversationSnapshot[];
  entryCount: number;
  totalTextCodeUnits: number;
  serializedBytes: number;
  counters: LatestMessageCacheCounters;
}>;

export type LatestMessagePublishResult = Readonly<{
  outcome: "inserted" | "replaced" | "duplicate" | "stale" | "rejected";
  changed: boolean;
  reason: string | null;
  evictedConversationIds: readonly string[];
  snapshot: LatestMessageCacheSnapshot;
}>;

export type ChatGptExportImportOptions = Readonly<{
  now?: number;
  maxTitleCodeUnits?: number;
  maxMessageCodeUnits?: number;
  maxAncestryHops?: number;
  maxFallbackNodes?: number;
}>;

export type ChatGptExportImportResult =
  | Readonly<{ ok: true; value: LatestConversationSnapshot }>
  | Readonly<{ ok: false; reason: string }>;

type MutableCounters = {
  hits: number;
  misses: number;
  inserted: number;
  replaced: number;
  duplicates: number;
  stale: number;
  rejected: number;
  evicted: number;
  clears: number;
};

type ParsedMessage = Readonly<{
  messageId: string;
  createdAt: number | null;
  completion: LatestMessageCompletion;
  text: string;
  textTruncated: boolean;
}>;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function resolvePolicy(
  input: Partial<LatestMessageCachePolicy> | undefined,
): LatestMessageCachePolicy {
  const resolved = { ...DEFAULT_LATEST_MESSAGE_CACHE_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!positiveSafeInteger(value)) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  if (resolved.maxMessageCodeUnits > resolved.maxTotalTextCodeUnits) {
    throw new RangeError("maxMessageCodeUnits must fit maxTotalTextCodeUnits.");
  }
  return Object.freeze(resolved);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function ownData(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function ownString(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = ownData(record, key);
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function ownTimestamp(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = ownData(record, key);
  return nonNegativeFinite(value) ? value : null;
}

function clip(value: string, limit: number): { value: string; truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit), truncated: true };
}

function cloneSnapshot(value: LatestConversationSnapshot): LatestConversationSnapshot {
  return Object.freeze({ ...value });
}

function textUnits(value: LatestConversationSnapshot): number {
  return value.text.length + (value.title?.length ?? 0);
}

function estimatedSerializedBytes(value: LatestConversationSnapshot): number {
  return JSON.stringify(value).length * 2;
}

function revisionTime(value: LatestConversationSnapshot): number {
  return value.sourceUpdatedAt ?? value.latestMessageCreatedAt ?? value.importedAt;
}

function normalizeSnapshot(
  input: unknown,
  policy: LatestMessageCachePolicy,
): LatestConversationSnapshot | null {
  const record = asRecord(input);
  if (!record) return null;

  const conversationId = ownString(record, "conversationId");
  const title = ownString(record, "title");
  const latestMessageId = ownString(record, "latestMessageId");
  const latestMessageCreatedAtValue = ownData(record, "latestMessageCreatedAt");
  const sourceUpdatedAtValue = ownData(record, "sourceUpdatedAt");
  const importedAt = ownData(record, "importedAt");
  const completion = ownString(record, "completion");
  const text = ownString(record, "text");
  const textTruncated = ownData(record, "textTruncated");
  const sourceFingerprint = ownString(record, "sourceFingerprint");

  if (
    typeof conversationId !== "string" ||
    conversationId.length < 1 ||
    conversationId.length > policy.maxConversationIdCodeUnits ||
    typeof latestMessageId !== "string" ||
    latestMessageId.length < 1 ||
    latestMessageId.length > policy.maxMessageIdCodeUnits ||
    !nonNegativeFinite(importedAt) ||
    !["complete", "incomplete", "unknown"].includes(completion ?? "") ||
    typeof text !== "string" ||
    typeof textTruncated !== "boolean" ||
    typeof sourceFingerprint !== "string" ||
    sourceFingerprint.length < 1 ||
    sourceFingerprint.length > policy.maxFingerprintCodeUnits
  ) {
    return null;
  }

  const latestMessageCreatedAt =
    latestMessageCreatedAtValue === null
      ? null
      : nonNegativeFinite(latestMessageCreatedAtValue)
        ? latestMessageCreatedAtValue
        : undefined;
  const sourceUpdatedAt =
    sourceUpdatedAtValue === null
      ? null
      : nonNegativeFinite(sourceUpdatedAtValue)
        ? sourceUpdatedAtValue
        : undefined;
  if (latestMessageCreatedAt === undefined || sourceUpdatedAt === undefined) {
    return null;
  }
  if (title !== null && typeof title !== "string") return null;

  const clippedTitle = title === null ? null : clip(title, policy.maxTitleCodeUnits).value;
  const clippedText = clip(text, policy.maxMessageCodeUnits);
  const normalized: LatestConversationSnapshot = Object.freeze({
    conversationId,
    title: clippedTitle,
    latestMessageId,
    latestMessageCreatedAt,
    sourceUpdatedAt,
    importedAt,
    completion: completion as LatestMessageCompletion,
    text: clippedText.value,
    textTruncated: textTruncated || clippedText.truncated,
    sourceFingerprint,
  });

  if (
    textUnits(normalized) > policy.maxTotalTextCodeUnits ||
    estimatedSerializedBytes(normalized) > policy.maxSerializedBytes
  ) {
    return null;
  }
  return normalized;
}

function freezeCounters(counters: MutableCounters): LatestMessageCacheCounters {
  return Object.freeze({ ...counters });
}

function fnv1a64(parts: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= BigInt(part.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
    hash ^= 0xffn;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function completionFromStatus(status: string | null | undefined): LatestMessageCompletion {
  if (status === "finished_successfully") return "complete";
  if (status === "in_progress" || status === "streaming") return "incomplete";
  return "unknown";
}

function extractText(
  message: Record<string, unknown>,
  maxMessageCodeUnits: number,
): { text: string; truncated: boolean } | null {
  const content = asRecord(ownData(message, "content"));
  if (!content) return null;
  const partsValue = ownData(content, "parts");
  if (!Array.isArray(partsValue)) return null;

  const chunks: string[] = [];
  let remaining = maxMessageCodeUnits;
  let truncated = false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(partsValue, "length");
  const length =
    lengthDescriptor && "value" in lengthDescriptor && positiveSafeInteger(lengthDescriptor.value)
      ? lengthDescriptor.value
      : lengthDescriptor && "value" in lengthDescriptor && lengthDescriptor.value === 0
        ? 0
        : null;
  if (length === null) return null;

  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(partsValue, String(index));
    if (!descriptor || !("value" in descriptor)) continue;
    const part = descriptor.value;
    let value: string | null = null;
    if (typeof part === "string") {
      value = part;
    } else {
      const partRecord = asRecord(part);
      const text = partRecord ? ownString(partRecord, "text") : undefined;
      if (typeof text === "string") value = text;
    }
    if (value === null) continue;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const clipped = value.slice(0, remaining);
    chunks.push(clipped);
    remaining -= clipped.length;
    if (clipped.length < value.length) {
      truncated = true;
      break;
    }
  }
  return { text: chunks.join("\n"), truncated };
}

function parseAssistantMessage(
  node: Record<string, unknown>,
  maxMessageCodeUnits: number,
): ParsedMessage | null {
  const message = asRecord(ownData(node, "message"));
  if (!message) return null;
  const author = asRecord(ownData(message, "author"));
  if (!author || ownString(author, "role") !== "assistant") return null;

  const messageId = ownString(message, "id") ?? ownString(node, "id");
  if (typeof messageId !== "string" || messageId.length < 1) return null;
  const extracted = extractText(message, maxMessageCodeUnits);
  if (!extracted) return null;
  const status = ownString(message, "status");
  return Object.freeze({
    messageId,
    createdAt: ownTimestamp(message, "create_time"),
    completion: completionFromStatus(status),
    text: extracted.text,
    textTruncated: extracted.truncated,
  });
}

function parentId(node: Record<string, unknown>): string | null {
  const value = ownString(node, "parent");
  return typeof value === "string" ? value : null;
}

function newerMessage(candidate: ParsedMessage, current: ParsedMessage | null): boolean {
  if (!current) return true;
  const candidateTime = candidate.createdAt ?? -1;
  const currentTime = current.createdAt ?? -1;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return candidate.messageId > current.messageId;
}

export function toLatestSnapshotFromChatGptExport(
  input: unknown,
  options: ChatGptExportImportOptions = {},
): ChatGptExportImportResult {
  const record = asRecord(input);
  if (!record) return Object.freeze({ ok: false, reason: "conversation-not-object" });

  const conversationId = ownString(record, "id") ?? ownString(record, "conversation_id");
  if (typeof conversationId !== "string" || conversationId.length < 1) {
    return Object.freeze({ ok: false, reason: "conversation-id-invalid" });
  }
  const titleValue = ownString(record, "title");
  if (titleValue !== null && titleValue !== undefined && typeof titleValue !== "string") {
    return Object.freeze({ ok: false, reason: "conversation-title-invalid" });
  }
  const mapping = asRecord(ownData(record, "mapping"));
  if (!mapping) return Object.freeze({ ok: false, reason: "conversation-mapping-invalid" });

  const maxTitleCodeUnits = options.maxTitleCodeUnits ?? 512;
  const maxMessageCodeUnits = options.maxMessageCodeUnits ?? 262_144;
  const maxAncestryHops = options.maxAncestryHops ?? 1_000;
  const maxFallbackNodes = options.maxFallbackNodes ?? 10_000;
  const importedAt = options.now ?? Date.now();
  if (
    !positiveSafeInteger(maxTitleCodeUnits) ||
    !positiveSafeInteger(maxMessageCodeUnits) ||
    !positiveSafeInteger(maxAncestryHops) ||
    !positiveSafeInteger(maxFallbackNodes) ||
    !nonNegativeFinite(importedAt)
  ) {
    throw new RangeError("Import limits and time must be bounded positive values.");
  }

  let selected: ParsedMessage | null = null;
  let nodeId = ownString(record, "current_node");
  const visited = new Set<string>();
  let hops = 0;
  while (typeof nodeId === "string" && hops < maxAncestryHops && !visited.has(nodeId)) {
    visited.add(nodeId);
    hops += 1;
    const node = asRecord(ownData(mapping, nodeId));
    if (!node) break;
    const candidate = parseAssistantMessage(node, maxMessageCodeUnits);
    if (candidate) {
      selected = candidate;
      break;
    }
    nodeId = parentId(node);
  }

  if (!selected) {
    let inspected = 0;
    for (const key in mapping) {
      if (inspected >= maxFallbackNodes) break;
      const descriptor = Object.getOwnPropertyDescriptor(mapping, key);
      if (!descriptor || !("value" in descriptor)) continue;
      inspected += 1;
      const node = asRecord(descriptor.value);
      if (!node) continue;
      const candidate = parseAssistantMessage(node, maxMessageCodeUnits);
      if (candidate && newerMessage(candidate, selected)) selected = candidate;
    }
  }

  if (!selected) return Object.freeze({ ok: false, reason: "assistant-message-unavailable" });
  const clippedTitle = titleValue == null ? null : clip(titleValue, maxTitleCodeUnits).value;
  const sourceUpdatedAt = ownTimestamp(record, "update_time");
  const sourceFingerprint = `chatgpt-export-v1:${fnv1a64([
    conversationId,
    selected.messageId,
    String(selected.createdAt ?? ""),
    String(sourceUpdatedAt ?? ""),
    selected.completion,
    selected.text,
  ])}`;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      conversationId,
      title: clippedTitle,
      latestMessageId: selected.messageId,
      latestMessageCreatedAt: selected.createdAt,
      sourceUpdatedAt,
      importedAt,
      completion: selected.completion,
      text: selected.text,
      textTruncated: selected.textTruncated,
      sourceFingerprint,
    }),
  });
}

export class BoundedLatestMessageCache {
  readonly #policy: LatestMessageCachePolicy;
  readonly #entries = new Map<string, LatestConversationSnapshot>();
  readonly #counters: MutableCounters = {
    hits: 0,
    misses: 0,
    inserted: 0,
    replaced: 0,
    duplicates: 0,
    stale: 0,
    rejected: 0,
    evicted: 0,
    clears: 0,
  };
  #totalTextCodeUnits = 0;
  #serializedBytes = 0;

  constructor(policy: Partial<LatestMessageCachePolicy> = {}) {
    this.#policy = resolvePolicy(policy);
  }

  get snapshot(): LatestMessageCacheSnapshot {
    return Object.freeze({
      entries: Object.freeze(
        [...this.#entries.values()].reverse().map(cloneSnapshot),
      ),
      entryCount: this.#entries.size,
      totalTextCodeUnits: this.#totalTextCodeUnits,
      serializedBytes: this.#serializedBytes,
      counters: freezeCounters(this.#counters),
    });
  }

  get(conversationId: string): LatestConversationSnapshot | null {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      this.#counters.misses += 1;
      return null;
    }
    this.#entries.delete(conversationId);
    this.#entries.set(conversationId, entry);
    this.#counters.hits += 1;
    return cloneSnapshot(entry);
  }

  publish(input: unknown): LatestMessagePublishResult {
    const normalized = normalizeSnapshot(input, this.#policy);
    if (!normalized) {
      this.#counters.rejected += 1;
      return Object.freeze({
        outcome: "rejected",
        changed: false,
        reason: "snapshot-invalid-or-over-limit",
        evictedConversationIds: Object.freeze([]),
        snapshot: this.snapshot,
      });
    }

    const existing = this.#entries.get(normalized.conversationId);
    if (existing?.sourceFingerprint === normalized.sourceFingerprint) {
      this.#counters.duplicates += 1;
      return Object.freeze({
        outcome: "duplicate",
        changed: false,
        reason: null,
        evictedConversationIds: Object.freeze([]),
        snapshot: this.snapshot,
      });
    }
    if (existing && revisionTime(normalized) < revisionTime(existing)) {
      this.#counters.stale += 1;
      return Object.freeze({
        outcome: "stale",
        changed: false,
        reason: "older-source-revision",
        evictedConversationIds: Object.freeze([]),
        snapshot: this.snapshot,
      });
    }

    if (existing) {
      this.#entries.delete(existing.conversationId);
      this.#totalTextCodeUnits -= textUnits(existing);
      this.#serializedBytes -= estimatedSerializedBytes(existing);
    }
    this.#entries.set(normalized.conversationId, normalized);
    this.#totalTextCodeUnits += textUnits(normalized);
    this.#serializedBytes += estimatedSerializedBytes(normalized);

    const evictedConversationIds: string[] = [];
    while (
      this.#entries.size > this.#policy.maxEntries ||
      this.#totalTextCodeUnits > this.#policy.maxTotalTextCodeUnits ||
      this.#serializedBytes > this.#policy.maxSerializedBytes
    ) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      const evicted = this.#entries.get(oldest);
      if (!evicted) break;
      this.#entries.delete(oldest);
      this.#totalTextCodeUnits -= textUnits(evicted);
      this.#serializedBytes -= estimatedSerializedBytes(evicted);
      this.#counters.evicted += 1;
      evictedConversationIds.push(oldest);
    }

    const outcome = existing ? "replaced" : "inserted";
    if (existing) this.#counters.replaced += 1;
    else this.#counters.inserted += 1;
    return Object.freeze({
      outcome,
      changed: true,
      reason: null,
      evictedConversationIds: Object.freeze(evictedConversationIds),
      snapshot: this.snapshot,
    });
  }

  clear(): LatestMessageCacheSnapshot {
    this.#entries.clear();
    this.#totalTextCodeUnits = 0;
    this.#serializedBytes = 0;
    this.#counters.clears += 1;
    return this.snapshot;
  }
}
