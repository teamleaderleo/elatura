// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type {
  CompanionRequestEnvelope,
  CompanionResponseEnvelope,
  CompanionUsage,
} from "@elatura/core/companion";
import { CompanionWebController } from "../src/controller.js";
import type {
  CompanionWebDispatchResult,
} from "../src/controller.js";
import { BoundedCompanionRenderSink } from "../src/render-sink.js";
import type {
  CompanionTransport,
  CompanionTransportSnapshot,
} from "../src/transport.js";

const USAGE: CompanionUsage = Object.freeze({
  residentConversationCount: 0,
  residentRecordCount: 0,
  residentEntryCount: 0,
  residentTextCodeUnits: 0,
  residentSerializedBytes: 0,
  residentAccountedBytes: 0,
  inFlightRequests: 0,
  queuedPageRequests: 0,
});

const ADAPTER = Object.freeze({ id: "synthetic-adapter", version: "1.0.0" });

function pagePayload(conversationId: string, count: number) {
  return {
    conversationId,
    generation: 0,
    cursor: `p1_${conversationId}_0_0_${count}`,
    hasBefore: false,
    hasAfter: false,
    freshness: "fresh" as const,
    adapter: ADAPTER,
    provenance: {
      authority: { origin: "https://synthetic.elatura.invalid" },
      capturedAt: 100,
      adapter: ADAPTER,
      transformation: {
        kind: "alternate-representation" as const,
        id: "synthetic-read-only",
        version: "1.0.0",
      },
      cache: { kind: "none" as const },
      freshness: { capturedAt: 100, staleAt: 1_000, expiresAt: 10_000 },
      synthetic: true,
    },
    entries: Array.from({ length: count }, (_, sequence) => ({
      id: `${conversationId}-entry-${sequence}`,
      parentId: sequence === 0 ? null : `${conversationId}-entry-${sequence - 1}`,
      childCount: sequence + 1 < count ? 1 : 0,
      sequence,
      kind: "message",
      text: `message ${sequence}`,
      textTruncated: false,
      codeBlockCount: 0,
      active: sequence + 1 === count,
    })),
  };
}

function success(
  request: CompanionRequestEnvelope,
  payload: unknown,
): CompanionResponseEnvelope {
  return {
    version: 1,
    sessionId: request.sessionId,
    requestId: request.requestId,
    operation: request.operation,
    ok: true,
    payload,
    errorCode: null,
    usage: USAGE,
  };
}

function navigatePayload(
  conversationId: string,
  entryId: string,
  lists: {
    parentId?: string | null;
    childIds?: string[];
    siblingIds?: string[];
    activePath?: string[];
  } = {},
) {
  const childIds = lists.childIds ?? [];
  const siblingIds = lists.siblingIds ?? [];
  const activePath = lists.activePath ?? [entryId];
  const parentId = lists.parentId === undefined ? null : lists.parentId;
  return {
    conversationId,
    generation: 0,
    entryId,
    parentId,
    childIds,
    childCount: childIds.length,
    siblingIds,
    siblingCount: siblingIds.length,
    activePath,
    jumpBackReference: null,
  };
}

async function settleOpen(
  transport: DeferredTransport,
  controller: CompanionWebController,
  conversationId: string,
): Promise<void> {
  const opening = controller.open(conversationId);
  const pending = transport.pending[transport.pending.length - 1]!;
  pending.resolve(success(pending.request, pagePayload(conversationId, 2)));
  expect((await opening).outcome).toBe("applied");
}

async function settleNavigate(
  transport: DeferredTransport,
  controller: CompanionWebController,
  payload: unknown,
): Promise<CompanionWebDispatchResult> {
  const navigating = controller.navigate("nav-conversation", "nav-conversation-entry-0");
  const pending = transport.pending[transport.pending.length - 1]!;
  pending.resolve(success(pending.request, payload));
  return navigating;
}

type Pending = {
  request: CompanionRequestEnvelope;
  resolve: (response: CompanionResponseEnvelope) => void;
};

class DeferredTransport implements CompanionTransport {
  readonly pending: Pending[] = [];
  #dispatched = 0;
  #completed = 0;
  #inFlight = 0;

  get snapshot(): CompanionTransportSnapshot {
    return {
      dispatchedRequestCount: this.#dispatched,
      completedRequestCount: this.#completed,
      cancelledRequestCount: 0,
      inFlightRequestCount: this.#inFlight,
    };
  }

  dispatch(request: CompanionRequestEnvelope): Promise<CompanionResponseEnvelope> {
    this.#dispatched += 1;
    this.#inFlight += 1;
    return new Promise((resolve) => {
      this.pending.push({
        request,
        resolve: (response) => {
          this.#completed += 1;
          this.#inFlight -= 1;
          resolve(response);
        },
      });
    });
  }
}

class ImmediateTransport implements CompanionTransport {
  #dispatched = 0;
  #completed = 0;
  #inFlight = 0;

  get snapshot(): CompanionTransportSnapshot {
    return {
      dispatchedRequestCount: this.#dispatched,
      completedRequestCount: this.#completed,
      cancelledRequestCount: 0,
      inFlightRequestCount: this.#inFlight,
    };
  }

  async dispatch(request: CompanionRequestEnvelope): Promise<CompanionResponseEnvelope> {
    this.#dispatched += 1;
    this.#inFlight += 1;
    try {
      if (request.operation === "open") {
        return success(request, pagePayload(String(request.payload.conversationId), 3));
      }
      if (request.operation === "close") {
        return success(request, {
          conversationId: request.payload.conversationId,
          released: true,
          generation: 1,
        });
      }
      if (request.operation === "revoke") {
        return success(request, { revoked: true });
      }
      throw new Error("Unexpected operation in immediate test transport.");
    } finally {
      this.#completed += 1;
      this.#inFlight -= 1;
    }
  }
}

describe("CompanionWebController", () => {
  it("rejects an artifact cap smaller than the irreducible empty render", () => {
    expect(
      () =>
        new CompanionWebController({
          sessionId: "impossible-render-policy",
          transport: new ImmediateTransport(),
          renderPolicy: { maxEstimatedArtifactBytes: 1 },
        }),
    ).toThrow(/maxEstimatedArtifactBytes must be at least/);
  });

  it("falls back to the empty render when scalar fields exceed a valid cap", () => {
    const maxEstimatedArtifactBytes = 400;
    const controller = new CompanionWebController({
      sessionId: "scalar-render-source",
      transport: new ImmediateTransport(),
    });
    const sink = new BoundedCompanionRenderSink({ maxEstimatedArtifactBytes });
    const snapshot = sink.replaceFromClient({
      ...controller.snapshot.client,
      searchConversationId: `conversation-${"x".repeat(500)}`,
    });

    expect(snapshot.searchConversationId).toBeNull();
    expect(snapshot.mountedTimelineRowCount).toBe(0);
    expect(snapshot.estimatedArtifactBytes).toBeLessThanOrEqual(
      maxEstimatedArtifactBytes,
    );
  });

  it("ignores a late timeline reply after a newer open owns the lane", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: "web-session",
      transport,
    });

    const first = controller.open("conversation-a");
    const second = controller.open("conversation-b");
    expect(transport.pending).toHaveLength(2);

    const secondPending = transport.pending[1]!;
    secondPending.resolve(
      success(secondPending.request, pagePayload("conversation-b", 2)),
    );
    expect((await second).outcome).toBe("applied");

    const firstPending = transport.pending[0]!;
    firstPending.resolve(
      success(firstPending.request, pagePayload("conversation-a", 2)),
    );
    expect((await first).outcome).toBe("superseded");
    expect(controller.snapshot.render.conversationId).toBe("conversation-b");
    expect(controller.snapshot.client.pendingRequestCount).toBe(0);
  });

  it("emits stable six-digit request ids on the ordinary dispatch path", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: "id-width-session",
      transport,
    });

    const conversations = ["id-a", "id-b", "id-c"];
    const openings = conversations.map((conversationId) =>
      controller.open(conversationId),
    );
    for (const [index, pending] of transport.pending.entries()) {
      pending.resolve(
        success(pending.request, pagePayload(conversations[index]!, 1)),
      );
    }
    const results = await Promise.all(openings);

    expect(results.map((result) => result.requestId)).toEqual([
      "web-000001",
      "web-000002",
      "web-000003",
    ]);
    for (const requestId of results.map((result) => result.requestId)) {
      expect(requestId).toMatch(/^web-[0-9]{6}$/u);
    }
    expect(controller.snapshot.requestOrdinal).toBe(3);
  });

  it("mounts only the configured number of timeline rows", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: "bounded-render-session",
      transport,
      renderPolicy: { maxTimelineRows: 2 },
      clientPolicy: { maxTimelineEntries: 10 },
    });

    const opening = controller.open("large-conversation");
    const pending = transport.pending[0]!;
    pending.resolve(success(pending.request, pagePayload("large-conversation", 5)));
    expect((await opening).outcome).toBe("applied");
    expect(controller.snapshot.client.page?.entries).toHaveLength(5);
    expect(controller.snapshot.render.timeline).toHaveLength(2);
    expect(controller.snapshot.render.timelineTruncated).toBe(true);
  });

  it("returns all client, render, and transport counters to zero across repeated cycles", async () => {
    const transport = new ImmediateTransport();
    const controller = new CompanionWebController({
      sessionId: "cycle-session",
      transport,
    });

    for (let index = 0; index < 100; index += 1) {
      expect((await controller.open("cycle-conversation")).outcome).toBe("applied");
      expect((await controller.close("cycle-conversation")).outcome).toBe("applied");
    }

    const snapshot = controller.snapshot;
    expect(snapshot.pendingLaneCount).toBe(0);
    expect(snapshot.client.pendingRequestCount).toBe(0);
    expect(snapshot.render.mountedTimelineRowCount).toBe(0);
    expect(snapshot.render.mountedSearchResultCount).toBe(0);
    expect(snapshot.render.mountedCodeTextCodeUnits).toBe(0);
    expect(snapshot.transport.inFlightRequestCount).toBe(0);
  });

  it("clears every local view artifact when the session is revoked", async () => {
    const transport = new ImmediateTransport();
    const controller = new CompanionWebController({
      sessionId: "revoke-session",
      transport,
    });

    await controller.open("revoke-conversation");
    expect(controller.snapshot.render.mountedTimelineRowCount).toBeGreaterThan(0);
    expect((await controller.revoke()).outcome).toBe("applied");
    expect(controller.snapshot.client.pendingRequestCount).toBe(0);
    expect(controller.snapshot.render.mountedTimelineRowCount).toBe(0);
  });
});

describe("CompanionWebController navigation policy binding", () => {
  it("exposes the resolved navigation cap as an immutable scalar", () => {
    expect(new BoundedCompanionRenderSink().maxNavigationRelationshipIds).toBe(64);
    expect(
      new BoundedCompanionRenderSink({ maxNavigationRelationshipIds: 7 })
        .maxNavigationRelationshipIds,
    ).toBe(7);
  });

  it("mounts navigation lists up to a configured cap below the default exactly", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: "nav-cap-low-session",
      transport,
      renderPolicy: { maxNavigationRelationshipIds: 4 },
    });
    await settleOpen(transport, controller, "nav-conversation");

    const applied = await settleNavigate(
      transport,
      controller,
      navigatePayload("nav-conversation", "nav-conversation-entry-0", {
        childIds: ["nav-conversation-entry-1", "nav-conversation-entry-2"],
        siblingIds: ["nav-conversation-entry-3", "nav-conversation-entry-4"],
        activePath: [
          "nav-conversation-entry-5",
          "nav-conversation-entry-6",
          "nav-conversation-entry-7",
          "nav-conversation-entry-8",
        ],
      }),
    );
    expect(applied.outcome).toBe("applied");

    const navigation = controller.snapshot.render.navigation;
    expect(navigation).not.toBeNull();
    // Every mounted list equals its true payload size and obeys the exact
    // configured bound of 4 — not the module default of 64.
    expect(navigation!.childIds).toHaveLength(2);
    expect(navigation!.siblingIds).toHaveLength(2);
    expect(navigation!.activePath).toHaveLength(4);
    for (const list of [navigation!.childIds, navigation!.siblingIds, navigation!.activePath]) {
      expect(list.length).toBeLessThanOrEqual(4);
    }
    // The mounted counter tracks childIds + activePath + parent (null here).
    expect(controller.snapshot.render.mountedNavigationRelationshipCount).toBe(6);
    expect(controller.workingSetSnapshot.renderEstimatedArtifactBytes)
      .toBeLessThanOrEqual(2_097_152);
  });

  it("drops instead of retaining stale navigation when extraction refuses an over-cap reply", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: "nav-cap-refusal-session",
      transport,
      renderPolicy: { maxNavigationRelationshipIds: 4 },
    });
    await settleOpen(transport, controller, "nav-conversation");

    const first = await settleNavigate(
      transport,
      controller,
      navigatePayload("nav-conversation", "nav-conversation-entry-0", {
        childIds: ["nav-conversation-entry-1"],
      }),
    );
    expect(first.outcome).toBe("applied");
    expect(controller.snapshot.render.navigation).not.toBeNull();

    // A second navigate whose activePath exceeds the configured cap is
    // refused by extraction; the previously mounted record must not survive
    // as a stale stand-in for the refused reply.
    const second = await settleNavigate(
      transport,
      controller,
      navigatePayload("nav-conversation", "nav-conversation-entry-1", {
        activePath: [
          "nav-conversation-entry-2",
          "nav-conversation-entry-3",
          "nav-conversation-entry-4",
          "nav-conversation-entry-5",
          "nav-conversation-entry-6",
        ],
      }),
    );
    expect(second.outcome).toBe("applied");
    expect(controller.snapshot.render.navigation).toBeNull();
    expect(controller.snapshot.render.mountedNavigationRelationshipCount).toBe(0);
  });

  it("binds the navigate lane to a configured cap above the legacy constant", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: "nav-cap-high-session",
      transport,
      renderPolicy: { maxNavigationRelationshipIds: 80 },
    });
    await settleOpen(transport, controller, "nav-conversation");

    const longPath = Array.from({ length: 70 }, (_, index) =>
      `nav-conversation-entry-${index + 10}`,
    );
    const applied = await settleNavigate(
      transport,
      controller,
      navigatePayload("nav-conversation", "nav-conversation-entry-0", {
        activePath: longPath,
      }),
    );
    expect(applied.outcome).toBe("applied");

    // A 70-id activePath exceeds the legacy hardcoded constant of 64 but fits
    // the instance's configured cap of 80, so it must mount in full.
    const navigation = controller.snapshot.render.navigation;
    expect(navigation).not.toBeNull();
    expect(navigation!.activePath).toHaveLength(70);
    expect(navigation!.childIds.length).toBeLessThanOrEqual(80);
    expect(navigation!.siblingIds.length).toBeLessThanOrEqual(80);
    expect(navigation!.activePath.length).toBeLessThanOrEqual(80);

    // Aggregate artifact accounting stays truthful about what is mounted.
    const bytesWithNavigation =
      controller.workingSetSnapshot.renderEstimatedArtifactBytes;
    expect(bytesWithNavigation).toBeGreaterThan(0);
    expect(bytesWithNavigation)
      .toBeLessThanOrEqual(2_097_152);
    const revoking = controller.revoke();
    const revokePending = transport.pending[transport.pending.length - 1]!;
    revokePending.resolve(success(revokePending.request, { revoked: true }));
    expect((await revoking).outcome).toBe("applied");
    expect(controller.workingSetSnapshot.renderEstimatedArtifactBytes)
      .toBeLessThan(bytesWithNavigation);
    expect(controller.snapshot.render.navigation).toBeNull();
  });
});
