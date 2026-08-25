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
  InProcessCompanionTransport,
  type CompanionTransport,
  type CompanionTransportSnapshot,
} from "../src/transport.js";

const SESSION = "lifecycle-session";
const AUTHORITY_ORIGIN = "https://synthetic.elatura.invalid";
const AUTHORITY_REFERENCE = `${AUTHORITY_ORIGIN}/conversation`;

type FixtureOptions = {
  seed?: number;
  staleAt?: number;
  expiresAt?: number;
  representationPolicy?: Partial<ReadOnlyRepresentationPolicy>;
};

/**
 * Deterministic synthetic source built through the merged fixture path
 * (@elatura/fixtures) and the merged ChatGPT alternate-representation path
 * (toSyntheticChatGptRepresentation). Total entries are exactly
 * 1 + turnGroups * (2 + hiddenNodesPerTurn).
 */
function fixtureRepresentation(
  turnGroups: number,
  hiddenNodesPerTurn: number,
  options: FixtureOptions = {},
): ReadOnlyRepresentation {
  const fixture = generateSyntheticConversation({
    turnGroups,
    branchEvery: 0,
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
    ...(options.representationPolicy
      ? { representationPolicy: options.representationPolicy }
      : {}),
  });
  if (!represented.ok) {
    throw new Error(
      `Synthetic representation rejected: ${represented.issues[0]?.code ?? "unknown"}`,
    );
  }
  return represented.value;
}

function conversation(id: string, representation: ReadOnlyRepresentation) {
  return { id, representation };
}

function webController(
  companion: SyntheticCompanion,
  renderPolicy?: { maxSearchResults: number },
): { controller: CompanionWebController; transport: InProcessCompanionTransport } {
  const transport = new InProcessCompanionTransport(companion);
  return {
    controller: new CompanionWebController({
      sessionId: SESSION,
      transport,
      ...(renderPolicy ? { renderPolicy } : {}),
    }),
    transport,
  };
}

function requestIdSuffix(requestId: string): number {
  const match = /^web-([0-9]+)$/u.exec(requestId);
  if (!match) throw new Error(`Unexpected controller request id ${requestId}.`);
  return Number(match[1]);
}

function timelinePayload(conversationId: string): unknown {
  return {
    conversationId,
    generation: 0,
    cursor: `p1_${conversationId}_0_0_2`,
    hasBefore: false,
    hasAfter: false,
    freshness: "fresh",
    adapter: { id: "synthetic-adapter", version: "1.0.0" },
    provenance: {
      authority: { origin: AUTHORITY_ORIGIN },
      capturedAt: 100,
      adapter: { id: "synthetic-adapter", version: "1.0.0" },
      transformation: {
        kind: "alternate-representation",
        id: "synthetic-read-only",
        version: "1.0.0",
      },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 1_000, expiresAt: 10_000 },
      synthetic: true,
    },
    entries: [
      {
        id: `${conversationId}-entry-0`,
        parentId: null,
        childCount: 0,
        sequence: 0,
        kind: "message",
        text: "late reply that must never mount",
        textTruncated: false,
        codeBlockCount: 0,
        active: true,
      },
    ],
  };
}

type Pending = {
  request: CompanionRequestEnvelope;
  resolve: (response: CompanionResponseEnvelope) => void;
};

class DeferredTransport implements CompanionTransport {
  readonly pending: Pending[] = [];
  readonly completedOrder: string[] = [];
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
          this.completedOrder.push(request.requestId);
          resolve(response);
        },
      });
    });
  }

  reply(index: number, payload: unknown): void {
    const pending = this.pending[index];
    if (!pending) throw new Error(`No deferred request at index ${index}.`);
    pending.resolve({
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: pending.request.sessionId,
      requestId: pending.request.requestId,
      operation: pending.request.operation,
      ok: true,
      payload,
      errorCode: null,
      usage: zeroUsage(),
    });
  }
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

describe("companion web deterministic synthetic coverage", () => {
  it("opens an exactly-100-entry fixture-path source through bounded client and render state", async () => {
    const representation = fixtureRepresentation(33, 1);
    expect(representation.entries).toHaveLength(100);

    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [conversation("sized-100", representation)],
    });
    const { controller } = webController(companion);

    expect((await controller.list(null, 10)).outcome).toBe("applied");
    expect(controller.snapshot.client.conversations[0]).toMatchObject({
      id: "sized-100",
      entryCount: 100,
      freshness: "fresh",
    });

    const opened = await controller.open("sized-100");
    expect(opened.outcome).toBe("applied");
    expect(opened.requestId).toMatch(/^web-[0-9]+$/u);

    const page = controller.snapshot.client.page;
    expect(page?.conversationId).toBe("sized-100");
    expect(page?.entries.length).toBeGreaterThan(0);
    expect(page?.entries.length).toBeLessThanOrEqual(
      DEFAULT_COMPANION_CLIENT_POLICY.maxTimelineEntries,
    );

    // Determinism: the same seed rebuilds the exact same mounted timeline.
    const rebuilt = fixtureRepresentation(33, 1, { seed: 86 });
    expect(rebuilt.entries.map((entry) => entry.id)).toEqual(
      representation.entries.map((entry) => entry.id),
    );

    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.renderMountedTimelineRowCount).toBe(page?.entries.length ?? 0);
    expect(workingSet.renderEstimatedArtifactBytes).toBeLessThanOrEqual(
      DEFAULT_COMPANION_RENDER_POLICY.maxEstimatedArtifactBytes,
    );
    // Monotonic ownership receipts: list then open strictly increase.
    expect(workingSet.requestOrdinal).toBe(2);
    expect(workingSet.pendingLaneCount).toBe(0);
    expect(workingSet.transportInFlightRequestCount).toBe(0);
  });

  it("opens an exactly-10,000-entry fixture-path source without retaining the source", async () => {
    const representation = fixtureRepresentation(99, 99);
    expect(representation.entries).toHaveLength(10_000);

    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [conversation("sized-10000", representation)],
    });
    const { controller } = webController(companion);

    const opened = await controller.open("sized-10000");
    expect(opened.outcome).toBe("applied");

    const page = controller.snapshot.client.page;
    expect(page?.entries.length).toBeGreaterThan(0);
    expect(page?.entries.length).toBeLessThanOrEqual(
      DEFAULT_COMPANION_CLIENT_POLICY.maxTimelineEntries,
    );
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(
      page?.entries.length ?? 0,
    );
    // Companion-side structural bound: resident records stay far below the source.
    expect(companion.usage.residentEntryCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxResidentEntries,
    );
  }, 30_000);

  it("admits an exactly-100,000-entry source through the explicit large-source policy and keeps every mounted view bounded", async () => {
    const representationPolicy: Partial<ReadOnlyRepresentationPolicy> = {
      maxEntries: 100_000,
      maxRepresentationNodes: 4_000_000,
      maxRepresentationSerializedBytes: 134_217_728,
    };
    const representation = fixtureRepresentation(2_439, 39, {
      representationPolicy,
    });
    expect(representation.entries).toHaveLength(100_000);

    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      representationPolicy,
      conversations: [conversation("sized-100000", representation)],
    });
    const { controller } = webController(companion);

    const listed = await controller.list(null, 10);
    expect(listed.outcome).toBe("applied");
    expect(controller.snapshot.client.conversations[0]).toMatchObject({
      id: "sized-100000",
      entryCount: 100_000,
    });

    const opened = await controller.open("sized-100000");
    expect(opened.outcome).toBe("applied");
    expect(controller.snapshot.client.page?.entries.length).toBeGreaterThan(0);
    expect(controller.snapshot.client.page?.entries.length).toBeLessThanOrEqual(
      DEFAULT_COMPANION_CLIENT_POLICY.maxTimelineEntries,
    );

    const paged = await controller.page(
      "sized-100000",
      controller.snapshot.client.page?.cursor ?? "",
      "before",
    );
    expect(paged.outcome).toBe("applied");
    expect(controller.snapshot.client.page?.entries.length).toBeLessThanOrEqual(
      DEFAULT_COMPANION_CLIENT_POLICY.maxTimelineEntries,
    );

    // Neither the client page nor the render sink ever approaches the source size.
    expect(companion.usage.residentEntryCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxResidentEntries,
    );
    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.renderMountedTimelineRowCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_RENDER_POLICY.maxTimelineRows,
    );
    expect(workingSet.renderEstimatedArtifactBytes).toBeLessThanOrEqual(
      DEFAULT_COMPANION_RENDER_POLICY.maxEstimatedArtifactBytes,
    );
    expect(workingSet.transportInFlightRequestCount).toBe(0);
    expect(workingSet.pendingLaneCount).toBe(0);
  }, 120_000);
});

describe("companion web switching beyond resident limits", () => {
  it("keeps every switch applied while the companion evicts beyond its resident-conversation cap", async () => {
    const ids = ["switch-a", "switch-b", "switch-c", "switch-d", "switch-e"];
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: ids.map((id) =>
        conversation(id, fixtureRepresentation(8, 0)),
      ),
    });
    const { controller } = webController(companion);

    const seenRequestIds: number[] = [];
    for (const id of ids) {
      const opened = await controller.open(id);
      expect(opened.outcome).toBe("applied");
      seenRequestIds.push(requestIdSuffix(opened.requestId));
      expect(controller.snapshot.client.page?.conversationId).toBe(id);
    }

    // Strictly monotonic ownership across switches.
    expect(seenRequestIds).toEqual([...seenRequestIds].sort((left, right) => left - right));
    expect(new Set(seenRequestIds).size).toBe(ids.length);

    // More switches than maxResidentConversations: eviction kept residency bounded.
    expect(companion.usage.residentConversationCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxResidentConversations,
    );

    const closing = await controller.close("switch-e");
    expect(closing.outcome).toBe("applied");
    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.pendingLaneCount).toBe(0);
    expect(workingSet.clientPendingRequestCount).toBe(0);
    expect(workingSet.transportInFlightRequestCount).toBe(0);
  });
});

describe("companion web repeated real-transport lifecycle cycles", () => {
  it("returns client, transport, render, and pending counters to zero after 100 open/close cycles", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        conversation("cycle-conversation", fixtureRepresentation(12, 0)),
      ],
    });
    const { controller, transport } = webController(companion);

    for (let index = 0; index < 100; index += 1) {
      const opened = await controller.open("cycle-conversation");
      expect(opened.outcome).toBe("applied");
      const closed = await controller.close("cycle-conversation");
      expect(closed.outcome).toBe("applied");
    }

    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.pendingLaneCount).toBe(0);
    expect(workingSet.clientPendingRequestCount).toBe(0);
    expect(workingSet.renderMountedConversationCount).toBe(0);
    expect(workingSet.renderMountedTimelineRowCount).toBe(0);
    expect(workingSet.renderMountedSearchResultCount).toBe(0);
    expect(workingSet.renderMountedCodeTextCodeUnits).toBe(0);
    expect(workingSet.transportInFlightRequestCount).toBe(0);
    expect(workingSet.transportDispatchedRequestCount).toBe(200);
    expect(workingSet.transportCompletedRequestCount).toBe(200);
    expect(transport.snapshot.inFlightRequestCount).toBe(0);
  }, 60_000);
});

describe("companion web bounded search and one-block code on demand", () => {
  it("mounts search results under both protocol and render caps with bounded snippets", async () => {
    const representation = fixtureRepresentation(33, 1);
    const needleEntry = representation.entries.find(
      (entry) => typeof entry.text === "string" && entry.text.length >= 6,
    );
    if (!needleEntry?.text) throw new Error("Fixture produced no searchable text.");
    const needle = needleEntry.text.slice(0, 6);

    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [conversation("search-conversation", representation)],
    });
    const { controller } = webController(companion, { maxSearchResults: 2 });

    const searched = await controller.search("search-conversation", needle, 3);
    expect(searched.outcome).toBe("applied");

    const results = controller.snapshot.client.searchResults;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const result of results) {
      expect(result.snippet.length).toBeLessThanOrEqual(
        DEFAULT_COMPANION_WORKING_SET_POLICY.maxSnippetCodeUnits,
      );
    }

    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.renderMountedSearchResultCount).toBeLessThanOrEqual(2);
    if (results.length > workingSet.renderMountedSearchResultCount) {
      expect(controller.snapshot.render.searchTruncated).toBe(true);
    }
    expect(workingSet.renderEstimatedArtifactBytes).toBeLessThanOrEqual(
      DEFAULT_COMPANION_RENDER_POLICY.maxEstimatedArtifactBytes,
    );
    expect(controller.snapshot.render.searchConversationId).toBe(
      "search-conversation",
    );
  });

  it("fetches exactly one code block on demand and replaces it with the next requested block", async () => {
    const representation = structuredClone(fixtureRepresentation(20, 0));
    const target = representation.entries[representation.entries.length - 3]!;
    target.codeBlocks.push(
      { language: "ts", text: "const first = 41;" },
      { language: "js", text: "const second = 42;" },
    );

    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [conversation("code-conversation", representation)],
    });
    const { controller } = webController(companion);

    expect((await controller.open("code-conversation")).outcome).toBe("applied");
    const mountedEntry = controller.snapshot.client.page?.entries.find(
      (entry) => entry.codeBlockCount === 2,
    );
    expect(mountedEntry?.id).toBe(target.id);

    const firstBlock = await controller.code("code-conversation", target.id, 0);
    expect(firstBlock.outcome).toBe("applied");
    expect(controller.snapshot.client.code).toMatchObject({
      conversationId: "code-conversation",
      entryId: target.id,
      blockIndex: 0,
    });
    expect(controller.snapshot.render.code?.text).toContain("const first = 41;");
    expect(controller.workingSetSnapshot.renderMountedCodeTextCodeUnits).toBe(
      controller.snapshot.render.code?.text.length ?? 0,
    );

    const secondBlock = await controller.code("code-conversation", target.id, 1);
    expect(secondBlock.outcome).toBe("applied");
    expect(controller.snapshot.render.code?.text).toContain("const second = 42;");
    expect(controller.snapshot.render.code?.text).not.toContain("const first = 41;");

    const missingBlock = await controller.code("code-conversation", target.id, 7);
    expect(missingBlock.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("code-missing");
  });
});

describe("companion web freshness and admission states", () => {
  it("reports stale sources while still serving pages", async () => {
    const representation = fixtureRepresentation(10, 0, {
      staleAt: 200,
      expiresAt: 10_000,
    });
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 500,
      conversations: [conversation("stale-conversation", representation)],
    });
    const { controller } = webController(companion);

    expect((await controller.list(null, 10)).outcome).toBe("applied");
    expect(controller.snapshot.client.conversations[0]?.freshness).toBe("stale");

    const opened = await controller.open("stale-conversation");
    expect(opened.outcome).toBe("applied");
    expect(controller.snapshot.client.page?.freshness).toBe("stale");
  });

  it("rejects opens on expired sources and records the bounded error state", async () => {
    const representation = fixtureRepresentation(10, 0, {
      staleAt: 200,
      expiresAt: 1_000,
    });
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 5_000,
      conversations: [conversation("expired-conversation", representation)],
    });
    const { controller } = webController(companion);

    expect((await controller.list(null, 10)).outcome).toBe("applied");
    expect(controller.snapshot.client.conversations[0]?.freshness).toBe("expired");

    const opened = await controller.open("expired-conversation");
    expect(opened.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("conversation-expired");
    expect(controller.snapshot.client.page).toBeNull();
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);
  });

  it("marks sources drifted when accepted adapters change and refuses opens", async () => {
    const representation = fixtureRepresentation(10, 0);
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [conversation("drifted-conversation", representation)],
    });
    const { controller } = webController(companion);

    companion.updateAcceptedAdapters([{ id: "other-adapter", version: "9.9.9" }]);

    expect((await controller.list(null, 10)).outcome).toBe("applied");
    expect(controller.snapshot.client.conversations[0]?.freshness).toBe("drifted");

    const opened = await controller.open("drifted-conversation");
    expect(opened.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("adapter-drift");
  });

  it("reports corrupt sources without mounting any content", async () => {
    // Runtime-invalid input on purpose: a mutated protocol version must be
    // rejected at admission and surface as a corrupt conversation.
    const invalid = {
      ...fixtureRepresentation(4, 0),
      version: READ_ONLY_REPRESENTATION_VERSION + 1,
    };
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        { id: "corrupt-conversation", representation: invalid },
      ],
    });
    const { controller } = webController(companion);

    expect((await controller.list(null, 10)).outcome).toBe("applied");
    expect(controller.snapshot.client.conversations[0]).toMatchObject({
      id: "corrupt-conversation",
      freshness: "corrupt",
      adapter: null,
      entryCount: 0,
    });

    const opened = await controller.open("corrupt-conversation");
    expect(opened.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("conversation-corrupt");
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);
  });
});

describe("companion web cancellation and late-reply ownership", () => {
  it("cancels a displaced in-process request through the real transport and ignores its late envelope", async () => {
    const representation = fixtureRepresentation(10, 0);
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        conversation("cancel-a", representation),
        conversation("cancel-b", fixtureRepresentation(10, 0, { seed: 87 })),
      ],
    });
    const { controller } = webController(companion);

    const first = controller.open("cancel-a");
    const second = controller.open("cancel-b");

    const firstResult = await first;
    expect(firstResult.outcome).toBe("superseded");
    const secondResult = await second;
    expect(secondResult.outcome).toBe("applied");
    expect(requestIdSuffix(firstResult.requestId)).toBeLessThan(
      requestIdSuffix(secondResult.requestId),
    );

    expect(controller.snapshot.render.conversationId).toBe("cancel-b");
    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.transportCancelledRequestCount).toBe(1);
    expect(workingSet.transportInFlightRequestCount).toBe(0);
    expect(workingSet.pendingLaneCount).toBe(0);
    expect(workingSet.clientPendingRequestCount).toBe(0);
  });

  it("ignores a late successful timeline reply that resolves after close cleared the view", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });

    const opening = controller.open("late-close-conversation");
    const closing = controller.close("late-close-conversation");

    transport.reply(1, {
      conversationId: "late-close-conversation",
      released: true,
      generation: 1,
    });
    expect((await closing).outcome).toBe("applied");
    expect(controller.snapshot.render.mountedTimelineRowCount).toBe(0);

    transport.reply(0, timelinePayload("late-close-conversation"));
    expect((await opening).outcome).toBe("superseded");

    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.renderMountedTimelineRowCount).toBe(0);
    expect(workingSet.pendingLaneCount).toBe(0);
    expect(workingSet.transportInFlightRequestCount).toBe(0);
  });

  it("ignores a late successful timeline reply that resolves after revoke cleared the session", async () => {
    const transport = new DeferredTransport();
    const controller = new CompanionWebController({
      sessionId: SESSION,
      transport,
    });

    const opening = controller.open("late-revoke-conversation");
    const revoking = controller.revoke();

    transport.reply(1, { revoked: true });
    expect((await revoking).outcome).toBe("applied");
    expect(controller.snapshot.client.pendingRequestCount).toBe(0);

    transport.reply(0, timelinePayload("late-revoke-conversation"));
    expect((await opening).outcome).toBe("superseded");

    const workingSet = controller.workingSetSnapshot;
    expect(workingSet.renderMountedTimelineRowCount).toBe(0);
    expect(workingSet.renderMountedSearchResultCount).toBe(0);
    expect(workingSet.renderMountedCodeTextCodeUnits).toBe(0);
    expect(workingSet.clientPendingRequestCount).toBe(0);
    expect(workingSet.pendingLaneCount).toBe(0);
    expect(workingSet.transportInFlightRequestCount).toBe(0);
  });
});
