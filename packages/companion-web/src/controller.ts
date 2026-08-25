// SPDX-License-Identifier: MPL-2.0
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  type CompanionClientPolicy,
  type CompanionClientSnapshot,
  type CompanionOperation,
  type CompanionRequestEnvelope,
  type CompanionUsage,
} from "@elatura/core/companion";
import {
  BoundedCompanionRenderSink,
  type CompanionRenderPolicy,
  type CompanionRenderSnapshot,
} from "./render-sink.js";
import { extractNavigationRecord } from "./navigation.js";
import { nextCompanionRequestId } from "./request-id.js";
import type {
  CompanionTransport,
  CompanionTransportSnapshot,
} from "./transport.js";

type RequestLane = "list" | "timeline" | "search" | "code" | "navigation" | "lifecycle";

type OwnedRequest = {
  owner: number;
  requestId: string;
  abortController: AbortController;
};

export type CompanionWebControllerSnapshot = Readonly<{
  client: CompanionClientSnapshot;
  render: CompanionRenderSnapshot;
  transport: CompanionTransportSnapshot;
  pendingLaneCount: number;
  /** Requests created so far; capped by COMPANION_REQUEST_ORDINAL_MAX. */
  requestOrdinal: number;
}>;

/**
 * Content-free working-set counters only. No conversation ids, text, or other
 * rendered content crosses this boundary, so the later browser benchmark
 * packet can record resource behavior without recording representations.
 */
export type CompanionWebWorkingSetSnapshot = Readonly<{
  pendingLaneCount: number;
  /** Requests created so far; capped by COMPANION_REQUEST_ORDINAL_MAX. */
  requestOrdinal: number;
  ownerOrdinal: number;
  clientPendingRequestCount: number;
  renderMountedConversationCount: number;
  renderMountedTimelineRowCount: number;
  renderMountedSearchResultCount: number;
  renderMountedCodeTextCodeUnits: number;
  renderEstimatedArtifactBytes: number;
  transportDispatchedRequestCount: number;
  transportCompletedRequestCount: number;
  transportCancelledRequestCount: number;
  transportInFlightRequestCount: number;
}>;

export type CompanionWebDispatchResult = Readonly<{
  outcome: "applied" | "superseded" | "rejected";
  /**
   * The wire request id of the dispatched request, or null exactly when the
   * dispatch was refused at the request-ordinal lifetime bound before any
   * request existed.
   */
  requestId: string | null;
  issueCodes: readonly string[];
  /**
   * Content-free companion working-set usage from the settled response, when a
   * response envelope was received. Never carries conversation content.
   */
  usage: CompanionUsage | null;
  snapshot: CompanionWebControllerSnapshot;
}>;

export type CompanionWebControllerOptions = Readonly<{
  sessionId: string;
  transport: CompanionTransport;
  clientPolicy?: Partial<CompanionClientPolicy>;
  renderPolicy?: Partial<CompanionRenderPolicy>;
}>;

/**
 * Browser-independent controller for a small replacement-based view. Each lane
 * owns at most one request, and late replies lose ownership before they can
 * alter client or render state.
 */
export class CompanionWebController {
  readonly #sessionId: string;
  readonly #transport: CompanionTransport;
  readonly #client: BoundedCompanionClientState;
  readonly #render: BoundedCompanionRenderSink;
  readonly #owned = new Map<RequestLane, OwnedRequest>();
  #ownerOrdinal = 0;
  #requestOrdinal = 0;

  constructor(options: CompanionWebControllerOptions) {
    this.#sessionId = options.sessionId;
    this.#transport = options.transport;
    this.#client = new BoundedCompanionClientState(
      options.sessionId,
      options.clientPolicy,
    );
    this.#render = new BoundedCompanionRenderSink(options.renderPolicy);
  }

  get snapshot(): CompanionWebControllerSnapshot {
    return Object.freeze({
      client: this.#client.snapshot,
      render: this.#render.snapshot,
      transport: this.#transport.snapshot,
      pendingLaneCount: this.#owned.size,
      requestOrdinal: this.#requestOrdinal,
    });
  }

  get workingSetSnapshot(): CompanionWebWorkingSetSnapshot {
    const client = this.#client.snapshot;
    const render = this.#render.snapshot;
    const transport = this.#transport.snapshot;
    return Object.freeze({
      pendingLaneCount: this.#owned.size,
      requestOrdinal: this.#requestOrdinal,
      ownerOrdinal: this.#ownerOrdinal,
      clientPendingRequestCount: client.pendingRequestCount,
      renderMountedConversationCount: render.conversations.length,
      renderMountedTimelineRowCount: render.mountedTimelineRowCount,
      renderMountedSearchResultCount: render.mountedSearchResultCount,
      renderMountedCodeTextCodeUnits: render.mountedCodeTextCodeUnits,
      renderEstimatedArtifactBytes: render.estimatedArtifactBytes,
      transportDispatchedRequestCount: transport.dispatchedRequestCount,
      transportCompletedRequestCount: transport.completedRequestCount,
      transportCancelledRequestCount: transport.cancelledRequestCount,
      transportInFlightRequestCount: transport.inFlightRequestCount,
    });
  }

  #cancelLane(lane: RequestLane): void {
    const pending = this.#owned.get(lane);
    if (!pending) return;
    pending.abortController.abort();
    this.#client.cancel(pending.requestId);
    this.#owned.delete(lane);
  }

  cancelPending(): CompanionWebControllerSnapshot {
    for (const lane of [...this.#owned.keys()]) this.#cancelLane(lane);
    return this.snapshot;
  }

  #claim(lane: RequestLane, requestId: string): OwnedRequest {
    this.#cancelLane(lane);
    const owned: OwnedRequest = {
      owner: ++this.#ownerOrdinal,
      requestId,
      abortController: new AbortController(),
    };
    this.#owned.set(lane, owned);
    return owned;
  }

  #isCurrent(lane: RequestLane, owned: OwnedRequest): boolean {
    const current = this.#owned.get(lane);
    return current?.owner === owned.owner && current.requestId === owned.requestId;
  }

  async #dispatch(
    lane: RequestLane,
    operation: CompanionOperation,
    payload: Record<string, unknown>,
  ): Promise<CompanionWebDispatchResult> {
    // Enforced request-ordinal lifetime bound (see request-id.ts): refusing
    // here creates nothing, registers nothing, dispatches nothing, emits
    // nothing, and leaves pending lane ownership and counters untouched.
    const gate = nextCompanionRequestId(this.#requestOrdinal);
    if (!gate.ok) {
      return Object.freeze({
        outcome: "rejected",
        requestId: null,
        issueCodes: Object.freeze([gate.code]),
        usage: null,
        snapshot: this.snapshot,
      });
    }
    this.#requestOrdinal += 1;
    const owned = this.#claim(lane, gate.requestId);
    const expected = this.#client.expect(owned.requestId, operation);
    if (!expected.ok) {
      this.#owned.delete(lane);
      return Object.freeze({
        outcome: "rejected",
        requestId: owned.requestId,
        issueCodes: Object.freeze(expected.issues.map((issue) => issue.code)),
        usage: null,
        snapshot: this.snapshot,
      });
    }

    const request: CompanionRequestEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      requestId: owned.requestId,
      operation,
      payload,
    };

    try {
      const response = await this.#transport.dispatch(
        request,
        owned.abortController.signal,
      );
      if (!this.#isCurrent(lane, owned)) {
        this.#client.cancel(owned.requestId);
        return Object.freeze({
          outcome: "superseded",
          requestId: owned.requestId,
          issueCodes: Object.freeze([]),
          usage: response.usage,
          snapshot: this.snapshot,
        });
      }

      this.#owned.delete(lane);
      const applied = this.#client.apply(response);
      if (!applied.ok) {
        this.#client.cancel(owned.requestId);
        return Object.freeze({
          outcome: "rejected",
          requestId: owned.requestId,
          issueCodes: Object.freeze(applied.issues.map((issue) => issue.code)),
          usage: response.usage,
          snapshot: this.snapshot,
        });
      }

      if (operation === "revoke") {
        this.#render.clear();
      } else if (operation === "navigate") {
        // The extraction bound comes from this instance's resolved render
        // policy, so custom caps bind the navigate lane exactly.
        const navigation = extractNavigationRecord(
          response.payload,
          this.#render.maxNavigationRelationshipIds,
        );
        if (navigation) {
          this.#render.replaceNavigation(navigation);
        } else {
          this.#render.replaceFromClient(applied.value);
          // A refused extraction must not silently retain the prior record as
          // though it described the current entry; drop it instead.
          this.#render.clearNavigation();
        }
      } else {
        this.#render.replaceFromClient(applied.value);
      }
      return Object.freeze({
        outcome: "applied",
        requestId: owned.requestId,
        issueCodes: Object.freeze([]),
        usage: response.usage,
        snapshot: this.snapshot,
      });
    } catch {
      const disowned = !this.#isCurrent(lane, owned);
      if (!disowned) this.#owned.delete(lane);
      this.#client.cancel(owned.requestId);
      return Object.freeze({
        outcome: disowned || owned.abortController.signal.aborted
          ? "superseded"
          : "rejected",
        requestId: owned.requestId,
        issueCodes: Object.freeze(
          disowned || owned.abortController.signal.aborted ? [] : ["transport-failed"],
        ),
        usage: null,
        snapshot: this.snapshot,
      });
    }
  }

  list(cursor: string | null = null, limit = 100): Promise<CompanionWebDispatchResult> {
    return this.#dispatch("list", "list", { cursor, limit });
  }

  open(
    conversationId: string,
    options: Readonly<{
      anchorEntryId?: string | null;
      before?: number;
      after?: number;
    }> = {},
  ): Promise<CompanionWebDispatchResult> {
    return this.#dispatch("timeline", "open", {
      conversationId,
      anchorEntryId: options.anchorEntryId ?? null,
      before: options.before ?? 24,
      after: options.after ?? 25,
    });
  }

  page(
    conversationId: string,
    cursor: string,
    direction: "before" | "after",
    limit = 50,
  ): Promise<CompanionWebDispatchResult> {
    return this.#dispatch("timeline", "page", {
      conversationId,
      cursor,
      direction,
      limit,
    });
  }

  search(
    conversationId: string,
    query: string,
    limit = 50,
  ): Promise<CompanionWebDispatchResult> {
    return this.#dispatch("search", "search", {
      conversationId,
      query,
      limit,
    });
  }

  code(
    conversationId: string,
    entryId: string,
    blockIndex: number,
  ): Promise<CompanionWebDispatchResult> {
    return this.#dispatch("code", "code", {
      conversationId,
      entryId,
      blockIndex,
    });
  }

  /**
   * Mounts bounded parent/child/sibling/active-path relationships for one
   * entry. The reply never carries timeline text or code.
   */
  navigate(conversationId: string, entryId: string): Promise<CompanionWebDispatchResult> {
    return this.#dispatch("navigation", "navigate", {
      conversationId,
      entryId,
    });
  }

  async close(conversationId: string): Promise<CompanionWebDispatchResult> {
    this.cancelPending();
    const result = await this.#dispatch("lifecycle", "close", { conversationId });
    if (result.outcome === "applied") this.#render.clearConversation(conversationId);
    return Object.freeze({ ...result, snapshot: this.snapshot });
  }

  async revoke(): Promise<CompanionWebDispatchResult> {
    this.cancelPending();
    return this.#dispatch("lifecycle", "revoke", {});
  }
}
