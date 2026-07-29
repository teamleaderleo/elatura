// SPDX-License-Identifier: MPL-2.0
import type { ValidationResult } from "./index.js";
import { measureBoundedJson, type BoundedJsonUsage } from "./resource-accounting.js";
import { isCompanionRecord, parseCompanionResponse, type CompanionCodeResult, type CompanionConversationMetadata, type CompanionEntryView, type CompanionSearchResult, type CompanionTimelinePage, type DeliveredCompanionResponse } from "./companion-protocol.js";

export type CompanionClientPolicy = Readonly<{ maxConversationMetadata: number; maxEntries: number; maxSearchResults: number; maxCodeTextCodeUnits: number; maxSerializedBytes: number }>;
export const DEFAULT_COMPANION_CLIENT_POLICY: CompanionClientPolicy = Object.freeze({ maxConversationMetadata: 256, maxEntries: 80, maxSearchResults: 50, maxCodeTextCodeUnits: 131_072, maxSerializedBytes: 2_097_152 });
function resolvePolicy(input?: Partial<CompanionClientPolicy>): CompanionClientPolicy { const value = { ...DEFAULT_COMPANION_CLIENT_POLICY, ...input }; for (const [name, limit] of Object.entries(value)) if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`${name} must be a positive safe integer.`); return Object.freeze(value); }

export class BoundedCompanionClientState {
  readonly #policy: CompanionClientPolicy; #generation = 0; #conversations: CompanionConversationMetadata[] = []; #active: CompanionConversationMetadata | null = null; #entries: CompanionEntryView[] = []; #search: CompanionSearchResult[] = []; #code: CompanionCodeResult | null = null;
  constructor(policy?: Partial<CompanionClientPolicy>) { this.#policy = resolvePolicy(policy); }
  apply(delivered: DeliveredCompanionResponse): boolean {
    const parsed = parseCompanionResponse(delivered.response, { maxResponseSerializedBytes: this.#policy.maxSerializedBytes });
    if (!parsed.ok || parsed.value.generation < this.#generation) return false;
    const response = parsed.value;
    const previous = [this.#generation, this.#conversations, this.#active, this.#entries, this.#search, this.#code] as const;
    const reject = (): false => {
      [this.#generation, this.#conversations, this.#active, this.#entries, this.#search, this.#code] = previous;
      return false;
    };
    this.#generation = response.generation;
    if (!response.ok) {
      if (["session-revoked", "conversation-closed", "source-expired"].includes(response.code)) {
        this.clear();
        this.#generation = response.generation;
      }
      return false;
    }
    if (response.operation === "close" || response.operation === "revoke") {
      this.clear();
      this.#generation = response.generation;
      return true;
    }
    try {
      if (!isCompanionRecord(response.data)) return reject();
      if (response.operation === "list") {
        const values = response.data.conversations;
        if (!Array.isArray(values) || values.length > this.#policy.maxConversationMetadata) return reject();
        this.#conversations = values.map((value) => ({ ...(value as CompanionConversationMetadata) }));
      }
      if (response.operation === "open" || response.operation === "page") {
        const page = response.data as unknown as CompanionTimelinePage;
        if (!isCompanionRecord(page.conversation) || !Array.isArray(page.entries) || page.entries.length > this.#policy.maxEntries) return reject();
        this.#active = { ...page.conversation };
        this.#entries = page.entries.map((entry) => ({ ...entry, childIds: [...entry.childIds], codeLanguages: [...entry.codeLanguages] }));
        this.#search = [];
        this.#code = null;
      }
      if (response.operation === "search") {
        const values = response.data.results;
        if (!Array.isArray(values) || values.length > this.#policy.maxSearchResults) return reject();
        this.#search = values.map((value) => ({ ...(value as CompanionSearchResult) }));
      }
      if (response.operation === "code") {
        const value = response.data as unknown as CompanionCodeResult;
        if (typeof value.text !== "string" || value.text.length > this.#policy.maxCodeTextCodeUnits) return reject();
        this.#code = { ...value };
      }
      return this.measure().ok ? true : reject();
    } catch {
      return reject();
    }
  }
  clear(): void { this.#conversations = []; this.#active = null; this.#entries = []; this.#search = []; this.#code = null; }
  snapshot(): Readonly<{ generation: number; conversations: readonly CompanionConversationMetadata[]; activeConversation: CompanionConversationMetadata | null; entries: readonly CompanionEntryView[]; searchResults: readonly CompanionSearchResult[]; code: CompanionCodeResult | null }> { return Object.freeze({ generation: this.#generation, conversations: Object.freeze(this.#conversations.map((value) => Object.freeze({ ...value }))), activeConversation: this.#active ? Object.freeze({ ...this.#active }) : null, entries: Object.freeze(this.#entries.map((value) => Object.freeze({ ...value, childIds: Object.freeze([...value.childIds]), codeLanguages: Object.freeze([...value.codeLanguages]) }))), searchResults: Object.freeze(this.#search.map((value) => Object.freeze({ ...value }))), code: this.#code ? Object.freeze({ ...this.#code }) : null }); }
  measure(): ValidationResult<BoundedJsonUsage> { return measureBoundedJson(this.snapshot(), { maxSerializedBytes: this.#policy.maxSerializedBytes, maxNodes: 100_000, maxStringCodeUnits: Math.max(this.#policy.maxCodeTextCodeUnits, 1_024) }); }
}
