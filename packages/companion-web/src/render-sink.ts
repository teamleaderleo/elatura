// SPDX-License-Identifier: MPL-2.0
import type {
  CompanionClientCode,
  CompanionClientSnapshot,
  CompanionConversationMetadata,
  CompanionPageEntry,
  CompanionSearchResult,
} from "@elatura/core/companion";

export type CompanionRenderPolicy = Readonly<{
  maxConversationMetadata: number;
  maxTimelineRows: number;
  maxTimelineTextCodeUnits: number;
  maxSearchResults: number;
  maxSearchTextCodeUnits: number;
  maxCodeTextCodeUnits: number;
  maxEstimatedArtifactBytes: number;
}>;

export const DEFAULT_COMPANION_RENDER_POLICY: CompanionRenderPolicy = Object.freeze({
  maxConversationMetadata: 100,
  maxTimelineRows: 50,
  maxTimelineTextCodeUnits: 524_288,
  maxSearchResults: 50,
  maxSearchTextCodeUnits: 65_536,
  maxCodeTextCodeUnits: 262_144,
  maxEstimatedArtifactBytes: 2_097_152,
});

export type CompanionRenderSnapshot = Readonly<{
  conversations: readonly CompanionConversationMetadata[];
  conversationId: string | null;
  cursor: string | null;
  timeline: readonly CompanionPageEntry[];
  timelineTruncated: boolean;
  searchConversationId: string | null;
  searchResults: readonly CompanionSearchResult[];
  searchTruncated: boolean;
  code: CompanionClientCode | null;
  lastError: CompanionClientSnapshot["lastError"];
  mountedTimelineRowCount: number;
  mountedSearchResultCount: number;
  mountedCodeTextCodeUnits: number;
  estimatedArtifactBytes: number;
}>;

type MutableRenderState = {
  conversations: CompanionConversationMetadata[];
  conversationId: string | null;
  cursor: string | null;
  timeline: CompanionPageEntry[];
  timelineTruncated: boolean;
  searchConversationId: string | null;
  searchResults: CompanionSearchResult[];
  searchTruncated: boolean;
  code: CompanionClientCode | null;
  lastError: CompanionClientSnapshot["lastError"];
};

function resolvePolicy(
  input: Partial<CompanionRenderPolicy> | undefined,
): CompanionRenderPolicy {
  const resolved = { ...DEFAULT_COMPANION_RENDER_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(resolved);
}

function estimatedBytes(value: unknown): number {
  return JSON.stringify(value).length * 2;
}

function copyTimeline(
  source: readonly CompanionPageEntry[],
  policy: CompanionRenderPolicy,
): { entries: CompanionPageEntry[]; truncated: boolean } {
  const entries: CompanionPageEntry[] = [];
  let textCodeUnits = 0;
  let truncated = source.length > policy.maxTimelineRows;
  for (const entry of source.slice(0, policy.maxTimelineRows)) {
    const text = entry.text ?? "";
    const remaining = policy.maxTimelineTextCodeUnits - textCodeUnits;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const clipped = text.slice(0, remaining);
    if (clipped.length < text.length) truncated = true;
    textCodeUnits += clipped.length;
    entries.push({
      ...entry,
      ...(entry.text === undefined ? {} : { text: clipped }),
      textTruncated: entry.textTruncated || clipped.length < text.length,
    });
  }
  return { entries, truncated };
}

function copySearch(
  source: readonly CompanionSearchResult[],
  policy: CompanionRenderPolicy,
): { results: CompanionSearchResult[]; truncated: boolean } {
  const results: CompanionSearchResult[] = [];
  let textCodeUnits = 0;
  let truncated = source.length > policy.maxSearchResults;
  for (const result of source.slice(0, policy.maxSearchResults)) {
    const remaining = policy.maxSearchTextCodeUnits - textCodeUnits;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const snippet = result.snippet.slice(0, remaining);
    if (snippet.length < result.snippet.length) truncated = true;
    textCodeUnits += snippet.length;
    results.push({ ...result, snippet });
  }
  return { results, truncated };
}

function copyCode(
  source: CompanionClientCode | null,
  policy: CompanionRenderPolicy,
): CompanionClientCode | null {
  if (source === null) return null;
  return {
    ...source,
    text: source.text.slice(0, policy.maxCodeTextCodeUnits),
  };
}

function emptyState(): MutableRenderState {
  return {
    conversations: [],
    conversationId: null,
    cursor: null,
    timeline: [],
    timelineTruncated: false,
    searchConversationId: null,
    searchResults: [],
    searchTruncated: false,
    code: null,
    lastError: null,
  };
}

const MINIMUM_ESTIMATED_ARTIFACT_BYTES = estimatedBytes(emptyState());

/**
 * Copies only bounded view artifacts. Authoritative representations and prior
 * pages never enter this sink.
 */
export class BoundedCompanionRenderSink {
  readonly #policy: CompanionRenderPolicy;
  #state: MutableRenderState = emptyState();

  constructor(inputPolicy?: Partial<CompanionRenderPolicy>) {
    const policy = resolvePolicy(inputPolicy);
    if (policy.maxEstimatedArtifactBytes < MINIMUM_ESTIMATED_ARTIFACT_BYTES) {
      throw new RangeError(
        `maxEstimatedArtifactBytes must be at least ${MINIMUM_ESTIMATED_ARTIFACT_BYTES}.`,
      );
    }
    this.#policy = policy;
  }

  get snapshot(): CompanionRenderSnapshot {
    const copied = structuredClone(this.#state);
    return Object.freeze({
      ...copied,
      mountedTimelineRowCount: copied.timeline.length,
      mountedSearchResultCount: copied.searchResults.length,
      mountedCodeTextCodeUnits: copied.code?.text.length ?? 0,
      estimatedArtifactBytes: estimatedBytes(copied),
    });
  }

  replaceFromClient(snapshot: CompanionClientSnapshot): CompanionRenderSnapshot {
    const timeline = copyTimeline(snapshot.page?.entries ?? [], this.#policy);
    const search = copySearch(snapshot.searchResults, this.#policy);
    let candidate: MutableRenderState = {
      conversations: structuredClone(
        snapshot.conversations.slice(0, this.#policy.maxConversationMetadata),
      ),
      conversationId: snapshot.page?.conversationId ?? null,
      cursor: snapshot.page?.cursor ?? null,
      timeline: timeline.entries,
      timelineTruncated: timeline.truncated,
      searchConversationId: snapshot.searchConversationId,
      searchResults: search.results,
      searchTruncated: search.truncated,
      code: copyCode(snapshot.code, this.#policy),
      lastError: snapshot.lastError,
    };

    if (estimatedBytes(candidate) > this.#policy.maxEstimatedArtifactBytes) {
      candidate.code = null;
    }
    while (
      estimatedBytes(candidate) > this.#policy.maxEstimatedArtifactBytes &&
      candidate.searchResults.length > 0
    ) {
      candidate.searchResults.pop();
      candidate.searchTruncated = true;
    }
    while (
      estimatedBytes(candidate) > this.#policy.maxEstimatedArtifactBytes &&
      candidate.timeline.length > 0
    ) {
      candidate.timeline.pop();
      candidate.timelineTruncated = true;
    }
    while (
      estimatedBytes(candidate) > this.#policy.maxEstimatedArtifactBytes &&
      candidate.conversations.length > 0
    ) {
      candidate.conversations.pop();
    }
    if (estimatedBytes(candidate) > this.#policy.maxEstimatedArtifactBytes) {
      candidate = emptyState();
    }

    this.#state = candidate;
    return this.snapshot;
  }

  clearConversation(conversationId: string): CompanionRenderSnapshot {
    if (this.#state.conversationId === conversationId) {
      this.#state.conversationId = null;
      this.#state.cursor = null;
      this.#state.timeline = [];
      this.#state.timelineTruncated = false;
    }
    if (this.#state.searchConversationId === conversationId) {
      this.#state.searchConversationId = null;
      this.#state.searchResults = [];
      this.#state.searchTruncated = false;
    }
    if (this.#state.code?.conversationId === conversationId) {
      this.#state.code = null;
    }
    return this.snapshot;
  }

  clear(): CompanionRenderSnapshot {
    this.#state = emptyState();
    return this.snapshot;
  }
}
