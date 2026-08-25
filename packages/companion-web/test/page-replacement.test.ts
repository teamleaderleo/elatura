// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  DEFAULT_COMPANION_CLIENT_POLICY,
  DEFAULT_COMPANION_WORKING_SET_POLICY,
  SyntheticCompanion,
  type CompanionRequestEnvelope,
  type CompanionResponseEnvelope,
  type CompanionUsage,
} from "@elatura/core/companion";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
  type ReadOnlyRepresentationPolicy,
} from "@elatura/core/representation";
import { generateSyntheticConversation } from "@elatura/fixtures";
import { toSyntheticChatGptRepresentation } from "@elatura/adapter-chatgpt/contracts";
import { validateChatGptConversation } from "@elatura/adapter-chatgpt";
import { CompanionWebController } from "../src/controller.js";
import {
  DEFAULT_COMPANION_RENDER_POLICY,
} from "../src/render-sink.js";
import {
  evaluateWorkingSetPlateau,
} from "../src/plateau.js";
import {
  InProcessCompanionTransport,
  type CompanionTransport,
  type CompanionTransportSnapshot,
} from "../src/transport.js";

const SESSION = "surface-session";
const AUTHORITY_ORIGIN = "https://synthetic.elatura.invalid";
const AUTHORITY_REFERENCE = `${AUTHORITY_ORIGIN}/conversation`;

function fixtureRepresentation(
  turnGroups: number,
  hiddenNodesPerTurn: number,
  options: {
    seed?: number;
    staleAt?: number;
    expiresAt?: number;
    representationPolicy?: Partial<ReadOnlyRepresentationPolicy>;
  } = {},
): ReadOnlyRepresentation {
  const fixture = generateSyntheticConversation({
    turnGroups,
    branchEvery: options.seed === 4242 ? 3 : 0,
    hiddenNodesPerTurn,
    payloadBytesPerMessage: 16,
    seed: options.seed ?? 86,
  });
  const validated = validateChatGptConversation(fixture);
  if (!validated.ok) throw new Error("Synthetic fixture failed validation.");
  const represented = toSyntheticChatGptRepresentation(validated.value, {
    authorityOrigin: AUTHORITY_ORIGIN,
    authorityReference: AUTHORITY_REFERENCE,
    capturedAt: 100,
    staleAt: options.staleAt ?? 1_000,
    expiresAt: options.expiresAt ?? 10_000,
    ...(options.representationPolicy ? { representationPolicy: options.representationPolicy } : {}),
  });
  if (!represented.ok) throw new Error("Synthetic representation rejected.");
  return represented.value;
}

function conversation(id: string, representation: ReadOnlyRepresentation) {
  return { id, representation };
}

function zeroUsage(): CompanionUsage {
  return Object.freeze({
    residentConversationCount: 0,
    residentRecordCount: 0,
    residentEntryCount: 0,
    residentTextCodeUnits: 0,
    residentSerializedBytes: 0,
    residentAccountedBytes: 0,
    inFlightRequests: 0,
    queuedPageRequests: 0,
  });
}

type Pending = {
  request: CompanionRequestEnvelope;
  resolve: (response: CompanionResponseEnvelope) => void;
};

class DeferredTransport implements CompanionTransport {
  readonly pending: Pending[] = [];
  #dispatched = 0;

  get snapshot(): CompanionTransportSnapshot {
    return {
      dispatchedRequestCount: this.#dispatched,
      completedRequestCount: this.pending.filter(() => true).length,
      cancelledRequestCount: 0,
      inFlightRequestCount: this.pending.length,
    };
  }

  dispatch(request: CompanionRequestEnvelope): Promise<CompanionResponseEnvelope> {
    this.#dispatched += 1;
    return new Promise((resolve) => {
      this.pending.push({
        request,
        resolve: (response) => resolve(response),
      });
    });
  }

  reply(index: number, payload: unknown, ok = true): void {
    const pending = this.pending[index];
    if (!pending) throw new Error(`No deferred request at index ${index}.`);
    pending.resolve({
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: pending.request.sessionId,
      requestId: pending.request.requestId,
      operation: pending.request.operation,
      ok,
      payload: ok ? payload : null,
      errorCode: ok ? null : "conversation-missing",
      usage: zeroUsage(),
    });
  }
}

describe("browser surface page replacement", () => {
  it("replaces the mounted window on older/newer paging without growing rows", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        conversation("paged-conversation", fixtureRepresentation(60, 1)),
      ],
    });
    const transport = new InProcessCompanionTransport(companion);
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
      renderPolicy: { maxTimelineRows: 20 },
    });

    expect((await controller.open("paged-conversation")).outcome).toBe("applied");
    const initialIds = controller.snapshot.client.page?.entries.map((entry) => entry.id);
    expect(initialIds?.length).toBeGreaterThan(0);
    expect(initialIds?.length).toBeLessThanOrEqual(
      DEFAULT_COMPANION_CLIENT_POLICY.maxTimelineEntries,
    );

    const cursor = controller.snapshot.client.page?.cursor ?? "";
    const pagedOlder = await controller.page("paged-conversation", cursor, "before");
    expect(pagedOlder.outcome).toBe("applied");
    const olderIds = controller.snapshot.client.page?.entries.map((entry) => entry.id);
    expect(olderIds).not.toEqual(initialIds);

    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.renderMountedTimelineRowCount).toBeLessThanOrEqual(20);
    expect(workingSet.renderEstimatedArtifactBytes).toBeLessThanOrEqual(
      DEFAULT_COMPANION_RENDER_POLICY.maxEstimatedArtifactBytes,
    );
    // The mounted view is exactly the bounded projection of the one retained
    // client window: independent caps, no duplication of prior pages.
    const clientRowCount = controller.snapshot.client.page?.entries.length ?? 0;
    expect(clientRowCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_CLIENT_POLICY.maxTimelineEntries,
    );
    expect(workingSet.renderMountedTimelineRowCount).toBe(
      Math.min(clientRowCount, 20),
    );
  }, 30_000);

  it("reaches a stable plateau when switching beyond the resident limit", async () => {
    const ids = [
      "plateau-a", "plateau-b", "plateau-c",
      "plateau-d", "plateau-e", "plateau-f",
    ];
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: ids.map((id) =>
        conversation(id, fixtureRepresentation(8, 0)),
      ),
    });
    const transport = new InProcessCompanionTransport(companion);
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });

    const samples: Record<string, number>[] = [];
    for (let round = 0; round < 2; round += 1) {
      for (const id of ids) {
        const opened = await controller.open(id);
        expect(opened.outcome).toBe("applied");
        const usage = opened.usage;
        const client = controller.snapshot.client;
        samples.push({
          residentConversations: companion.usage.residentConversationCount,
          residentRecords: usage?.residentRecordCount ?? 0,
          residentEntries: usage?.residentEntryCount ?? 0,
          renderedRows: controller.snapshot.render.mountedTimelineRowCount,
          retainedClientRecords:
            client.conversations.length +
            (client.page?.entries.length ?? 0) +
            client.searchResults.length +
            (client.code === null ? 0 : 1),
          cacheEntries: 0,
          cacheBytes: 0,
          artifactBytes: controller.snapshot.render.estimatedArtifactBytes,
        });
      }
    }

    const verdict = evaluateWorkingSetPlateau(samples, { minimumSamples: 6 });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    // Companion-side residency stays pinned at the policy cap across switches.
    expect(companion.usage.residentConversationCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxResidentConversations,
    );
    expect(samples.every((sample) => sample.renderedRows > 0)).toBe(true);
  });

  it("returns every volatile counter to zero after 100 real open/close cycles", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        conversation("cycle-conversation", fixtureRepresentation(12, 0)),
      ],
    });
    const transport = new InProcessCompanionTransport(companion);
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });

    for (let index = 0; index < 100; index += 1) {
      const opened = await controller.open("cycle-conversation");
      expect(opened.outcome).toBe("applied");
      const closed = await controller.close("cycle-conversation");
      expect(closed.outcome).toBe("applied");
    }
    ledgerProbe(companion, controller, transport);
    expect(controller.workingSetSnapshot.transportInFlightRequestCount).toBe(0);
    expect(controller.workingSetSnapshot.pendingLaneCount).toBe(0);
    expect(controller.snapshot.client.pendingRequestCount).toBe(0);
  }, 60_000);
});

function ledgerProbe(
  companion: SyntheticCompanion,
  controller: CompanionWebController,
  transport: InProcessCompanionTransport,
): void {
  // Companion residency must unwind to the empty session state.
  expect(companion.usage.residentRecordCount).toBe(0);
  expect(companion.usage.residentEntryCount).toBe(0);
  expect(companion.usage.inFlightRequests).toBe(0);
  expect(transport.snapshot.inFlightRequestCount).toBe(0);
  expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);
}

describe("out-of-order and late replies cannot repopulate released state", () => {
  it("ignores an earlier timeline reply that resolves after a newer one applied", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });

    const first = controller.open("order-first");
    const second = controller.open("order-second");

    // Resolve out of order: the newer request applies first.
    transport.reply(1, {
      conversationId: "order-second",
      generation: 0,
      cursor: `p1_order-second_0_0_1`,
      hasBefore: false,
      hasAfter: false,
      freshness: "fresh",
      adapter: { id: "synthetic-adapter", version: "1.0.0" },
      provenance: {
        authority: { origin: AUTHORITY_ORIGIN },
        capturedAt: 100,
        adapter: { id: "synthetic-adapter", version: "1.0.0" },
        transformation: { kind: "alternate-representation", id: "synthetic-read-only", version: "1.0.0" },
        cache: { kind: "none" },
        freshness: { capturedAt: 100, staleAt: 1_000, expiresAt: 10_000 },
        synthetic: true,
      },
      entries: [
        {
          id: "order-second-entry-0",
          parentId: null,
          childCount: 0,
          sequence: 0,
          kind: "message",
          text: "second wins",
          textTruncated: false,
          codeBlockCount: 0,
          active: true,
        },
      ],
    });
    expect((await second).outcome).toBe("applied");

    transport.reply(0, {
      conversationId: "order-first",
      generation: 0,
      cursor: "p1_order-first_0_0_1",
      hasBefore: false,
      hasAfter: false,
      freshness: "fresh",
      adapter: { id: "synthetic-adapter", version: "1.0.0" },
      provenance: {
        authority: { origin: AUTHORITY_ORIGIN },
        capturedAt: 100,
        adapter: { id: "synthetic-adapter", version: "1.0.0" },
        transformation: { kind: "alternate-representation", id: "synthetic-read-only", version: "1.0.0" },
        cache: { kind: "none" },
        freshness: { capturedAt: 100, staleAt: 1_000, expiresAt: 10_000 },
        synthetic: true,
      },
      entries: [
        {
          id: "order-first-entry-0",
          parentId: null,
          childCount: 0,
          sequence: 0,
          kind: "message",
          text: "late first reply must never mount",
          textTruncated: false,
          codeBlockCount: 0,
          active: true,
        },
      ],
    });
    expect((await first).outcome).toBe("superseded");

    expect(controller.snapshot.client.page?.conversationId).toBe("order-second");
    expect(controller.snapshot.render.conversationId).toBe("order-second");
    const serialized = JSON.stringify(controller.snapshot.render.timeline);
    expect(serialized).not.toContain("late first reply");
    expect(controller.workingSetSnapshot.pendingLaneCount).toBe(0);
  });

  it("keeps close/revoke releases intact against replies arriving afterwards", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });

    const openingSearch = controller.search("released-conversation", "needle", 5);
    const revoking = controller.revoke();

    transport.reply(1, { revoked: true });
    expect((await revoking).outcome).toBe("applied");

    transport.reply(0, {
      conversationId: "released-conversation",
      results: [],
    });
    expect((await openingSearch).outcome).toBe("superseded");
    expect(controller.workingSetSnapshot.renderMountedSearchResultCount).toBe(0);
    expect(controller.snapshot.client.pendingRequestCount).toBe(0);
    expect(controller.snapshot.client.conversations).toHaveLength(0);
  });
});

describe("bounded diagnostics for hostile and oversized replies", () => {
  it("surfaces page-limit as a visible diagnostic without clearing the session", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        conversation("limit-conversation", fixtureRepresentation(10, 0)),
      ],
    });
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport: new InProcessCompanionTransport(companion),
    });
    expect((await controller.list(null, 10)).outcome).toBe("applied");

    // before+after+1 exceeds maxPageEntries=50 -> fixed protocol refusal.
    const opened = await controller.open("limit-conversation", { before: 40, after: 40 });
    expect(opened.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("page-limit");
    expect(controller.snapshot.client.page).toBeNull();

    // The list metadata remains usable after the failed open.
    expect(controller.snapshot.client.conversations[0]?.id).toBe("limit-conversation");
  });

  it("rejects structurally malformed replies into a bounded visible state", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });
    const opening = controller.open("malformed-conversation");
    transport.reply(0, { not: "a-page-payload" });
    const result = await opening;
    expect(result.outcome).toBe("rejected");
    expect(result.issueCodes.length).toBeGreaterThan(0);
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);
    expect(controller.workingSetSnapshot.pendingLaneCount).toBe(0);
  });
});
