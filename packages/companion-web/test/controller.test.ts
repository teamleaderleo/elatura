// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type {
  CompanionRequestEnvelope,
  CompanionResponseEnvelope,
  CompanionUsage,
} from "@elatura/core/companion";
import { CompanionWebController } from "../src/controller.js";
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
