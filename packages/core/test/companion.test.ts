// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  parseCompanionRequest,
  parseCompanionResponse,
  type CompanionOperation,
  type CompanionPagePayload,
  type CompanionRequestEnvelope,
  type CompanionResponseEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "session-a";

function representation(
  count: number,
  options: {
    adapterId?: string;
    adapterVersion?: string;
    staleAt?: number;
    expiresAt?: number;
    codeEvery?: number;
    textPrefix?: string;
  } = {},
): ReadOnlyRepresentation {
  const adapter = {
    id: options.adapterId ?? "synthetic-adapter",
    version: options.adapterVersion ?? "1",
  };
  const entries = Array.from({ length: count }, (_, index) => {
    const id = `entry-${index}`;
    const parentId = index === 0 ? null : `entry-${index - 1}`;
    const childIds = index + 1 < count ? [`entry-${index + 1}`] : [];
    const hasCode = (options.codeEvery ?? 10) > 0 && index % (options.codeEvery ?? 10) === 0;
    return {
      id,
      parentId,
      childIds,
      sequence: index,
      kind: "message",
      label: index % 2 === 0 ? "user" : "assistant",
      text: `${options.textPrefix ?? "timeline"} ${index} searchable value`,
      codeBlocks: hasCode
        ? [{ language: "ts", text: `const privateCode${index} = ${index};` }]
        : [],
      jumpBackReference: `https://synthetic.elatura.invalid/timeline#${id}`,
    };
  });
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter,
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/timeline",
      },
      capturedAt: 100,
      adapter,
      transformation: {
        kind: "alternate-representation",
        id: "synthetic-read-only",
        version: "1",
      },
      cache: { kind: "none" },
      freshness: {
        capturedAt: 100,
        staleAt: options.staleAt ?? 200,
        expiresAt: options.expiresAt ?? 10_000,
      },
      synthetic: true,
    },
    roots: count === 0 ? [] : ["entry-0"],
    activePath: entries.map((entry) => entry.id),
    entries,
  };
}

function request(
  operation: CompanionOperation,
  payload: Record<string, unknown>,
  requestId = `${operation}-1`,
): CompanionRequestEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId,
    operation,
    payload,
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function page(response: CompanionResponseEnvelope): CompanionPagePayload {
  expect(response.ok).toBe(true);
  return response.payload as CompanionPagePayload;
}

describe("bounded synthetic companion protocol", () => {
  it("strictly parses bounded requests and responses", () => {
    const valid = request("open", {
      conversationId: "conversation-a",
      anchorEntryId: null,
      before: 2,
      after: 2,
    });
    expect(parseCompanionRequest(valid).ok).toBe(true);

    const extra = structuredClone(valid) as CompanionRequestEnvelope & { hidden?: string };
    extra.hidden = "unsupported";
    expect(parseCompanionRequest(extra).ok).toBe(false);

    const oversized = structuredClone(valid);
    oversized.payload = { ...oversized.payload, padding: "x".repeat(70_000) };
    const rejected = parseCompanionRequest(oversized);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.issues[0]?.code).toBe("request-resource-limit");

    const response: CompanionResponseEnvelope = {
      version: 1,
      sessionId: SESSION,
      requestId: "open-1",
      operation: "open",
      ok: false,
      payload: null,
      errorCode: "conversation-missing",
      usage: {
        residentConversationCount: 0,
        residentRecordCount: 0,
        residentEntryCount: 0,
        residentTextCodeUnits: 0,
        residentSerializedBytes: 0,
        residentAccountedBytes: 0,
        inFlightRequests: 0,
        queuedPageRequests: 0,
      },
    };
    expect(parseCompanionResponse(response).ok).toBe(true);
    const malformed = structuredClone(response);
    malformed.payload = { private: "not allowed on an error" };
    expect(parseCompanionResponse(malformed).ok).toBe(false);
  });

  it("lists visible stale, corrupt, and drifted source states", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 250,
      conversations: [
        { id: "fresh", representation: representation(3, { staleAt: 500 }) },
        { id: "stale", representation: representation(3, { staleAt: 200 }) },
        { id: "corrupt", representation: { bad: true } },
        {
          id: "drifted",
          representation: representation(3, {
            adapterId: "other-adapter",
            adapterVersion: "9",
          }),
        },
      ],
      acceptedAdapters: [{ id: "synthetic-adapter", version: "1" }],
    });
    const response = await companion.dispatch(
      request("list", { cursor: null, limit: 10 }),
    );
    expect(response.ok).toBe(true);
    const items = (response.payload as { items: Array<{ id: string; freshness: string }> }).items;
    expect(Object.fromEntries(items.map((item) => [item.id, item.freshness]))).toEqual({
      corrupt: "corrupt",
      drifted: "drifted",
      fresh: "fresh",
      stale: "stale",
    });
  });

  it("transfers only bounded timeline pages and fetches code on demand", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "huge", representation: representation(2_000) }],
    });
    const opened = await companion.dispatch(
      request("open", {
        conversationId: "huge",
        anchorEntryId: "entry-1974",
        before: 24,
        after: 25,
      }),
    );
    const payload = page(opened);
    expect(payload.entries).toHaveLength(50);
    expect(payload.hasBefore).toBe(true);
    expect(payload.hasAfter).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("privateCode");
    expect(payload.entries.some((entry) => entry.codeBlockCount > 0)).toBe(true);
    expect(opened.usage).toMatchObject({
      residentConversationCount: 1,
      residentRecordCount: 1,
      residentEntryCount: 50,
    });

    const codedEntry = payload.entries.find((entry) => entry.codeBlockCount > 0)!;
    const code = await companion.dispatch(
      request(
        "code",
        {
          conversationId: "huge",
          entryId: codedEntry.id,
          blockIndex: 0,
        },
        "code-1",
      ),
    );
    expect(code.ok).toBe(true);
    expect(JSON.stringify(code.payload)).toContain("privateCode");
    expect((code.payload as { block: { text: string } }).block.text.length).toBeLessThanOrEqual(
      companion.policy.maxCodeResponseCodeUnits,
    );
  });

  it("bounds copied search snippets, results, and index work", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        {
          id: "searchable",
          representation: representation(500, {
            textPrefix: "needle context with additional surrounding content",
            codeEvery: 1,
          }),
        },
      ],
      policy: {
        maxSearchResults: 7,
        maxSnippetCodeUnits: 32,
        maxIndexEntries: 100,
        maxIndexTextCodeUnits: 1_000_000,
      },
    });
    const response = await companion.dispatch(
      request("search", {
        conversationId: "searchable",
        query: "needle",
        limit: 50,
      }),
    );
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      results: Array<{ snippet: string }>;
      truncated: boolean;
    };
    expect(payload.results).toHaveLength(7);
    expect(payload.results.every((result) => result.snippet.length <= 32)).toBe(true);
    expect(payload.truncated).toBe(true);
    expect(response.usage.residentRecordCount).toBe(1);

    const limited = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "limited", representation: representation(20) }],
      policy: { maxIndexEntries: 2 },
    });
    const rejected = await limited.dispatch(
      request("search", {
        conversationId: "limited",
        query: "missing-value",
        limit: 10,
      }),
    );
    expect(rejected).toMatchObject({ ok: false, errorCode: "index-limit" });
  });

  it("reaches deterministic resident plateaus across more conversations than the limit", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: Array.from({ length: 6 }, (_, index) => ({
        id: `conversation-${index}`,
        representation: representation(20, { textPrefix: `conversation ${index}` }),
      })),
      policy: {
        maxResidentConversations: 3,
        maxResidentRecords: 3,
        maxResidentPagesPerConversation: 1,
      },
    });
    const cursors: string[] = [];
    let plateau: CompanionResponseEnvelope["usage"] | null = null;
    for (let index = 0; index < 6; index += 1) {
      const response = await companion.dispatch(
        request(
          "open",
          {
            conversationId: `conversation-${index}`,
            anchorEntryId: null,
            before: 2,
            after: 2,
          },
          `open-${index}`,
        ),
      );
      cursors.push(page(response).cursor);
      expect(response.usage.residentConversationCount).toBeLessThanOrEqual(3);
      expect(response.usage.residentRecordCount).toBeLessThanOrEqual(3);
      if (index >= 2) {
        plateau ??= response.usage;
        expect(response.usage).toEqual(plateau);
      }
    }

    const staleCursor = await companion.dispatch(
      request("page", {
        conversationId: "conversation-0",
        cursor: cursors[0],
        direction: "before",
        limit: 1,
      }),
    );
    expect(staleCursor).toMatchObject({ ok: false, errorCode: "cursor-stale" });
  });

  it("returns to zero usage after repeated open and close cycles", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "cycle", representation: representation(100) }],
    });
    for (let index = 0; index < 25; index += 1) {
      const opened = await companion.dispatch(
        request(
          "open",
          {
            conversationId: "cycle",
            anchorEntryId: "entry-94",
            before: 4,
            after: 5,
          },
          `open-cycle-${index}`,
        ),
      );
      const openedPage = page(opened);
      expect(openedPage.entries).toHaveLength(10);
      expect(opened.usage).toMatchObject({
        residentConversationCount: 1,
        residentRecordCount: 1,
        residentEntryCount: 10,
        inFlightRequests: 0,
        queuedPageRequests: 0,
      });
      expect(opened.usage.residentSerializedBytes).toBeLessThanOrEqual(
        companion.policy.maxResidentSerializedBytes,
      );
      expect(opened.usage.residentAccountedBytes).toBeLessThanOrEqual(
        companion.policy.maxResidentAccountedBytes,
      );
      const closed = await companion.dispatch(
        request("close", { conversationId: "cycle" }, `close-cycle-${index}`),
      );
      expect(closed.ok).toBe(true);
      expect(closed.usage).toMatchObject({
        residentConversationCount: 0,
        residentRecordCount: 0,
        residentEntryCount: 0,
        residentTextCodeUnits: 0,
        residentSerializedBytes: 0,
        residentAccountedBytes: 0,
      });
    }
  });

  it("prevents delayed work from repopulating closed or revoked state", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "delayed", representation: representation(100) }],
    });
    const gate = deferred();
    const delayed = companion.dispatch(
      request("open", {
        conversationId: "delayed",
        anchorEntryId: null,
        before: 2,
        after: 2,
      }),
      { beforeCommit: () => gate.promise },
    );
    const closed = await companion.dispatch(
      request("close", { conversationId: "delayed" }, "close-delayed"),
    );
    expect(closed.ok).toBe(true);
    gate.resolve();
    expect(await delayed).toMatchObject({ ok: false, errorCode: "request-cancelled" });
    expect(companion.usage.residentRecordCount).toBe(0);

    const secondGate = deferred();
    const second = companion.dispatch(
      request(
        "open",
        {
          conversationId: "delayed",
          anchorEntryId: null,
          before: 2,
          after: 2,
        },
        "open-after-close",
      ),
      { beforeCommit: () => secondGate.promise },
    );
    const revoked = await companion.dispatch(
      request("revoke", {}, "revoke-1"),
    );
    expect(revoked.ok).toBe(true);
    secondGate.resolve();
    expect(await second).toMatchObject({ ok: false, errorCode: "request-cancelled" });
    expect(companion.usage.residentRecordCount).toBe(0);
    expect(
      await companion.dispatch(
        request("status", { conversationId: null }, "status-after-revoke"),
      ),
    ).toMatchObject({ ok: false, errorCode: "session-revoked" });
  });

  it("surfaces expiration and adapter drift with bounded failure responses", async () => {
    let now = 150;
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => now,
      conversations: [
        { id: "expiring", representation: representation(5, { expiresAt: 200 }) },
      ],
    });
    now = 200;
    expect(
      await companion.dispatch(
        request("open", {
          conversationId: "expiring",
          anchorEntryId: null,
          before: 1,
          after: 1,
        }),
      ),
    ).toMatchObject({ ok: false, errorCode: "conversation-expired" });

    now = 150;
    const drift = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => now,
      conversations: [{ id: "drift", representation: representation(5) }],
    });
    drift.updateAcceptedAdapters([{ id: "different", version: "1" }]);
    expect(
      await drift.dispatch(
        request("open", {
          conversationId: "drift",
          anchorEntryId: null,
          before: 1,
          after: 1,
        }),
      ),
    ).toMatchObject({ ok: false, errorCode: "adapter-drift" });
  });

  it("enforces in-flight and queued-page caps", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "queue", representation: representation(20) }],
      policy: { maxInFlightRequests: 2, maxQueuedPageRequests: 1 },
    });
    const gate = deferred();
    const first = companion.dispatch(
      request("open", {
        conversationId: "queue",
        anchorEntryId: null,
        before: 1,
        after: 1,
      }),
      { beforeCommit: () => gate.promise },
    );
    const queued = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "queue",
          anchorEntryId: null,
          before: 1,
          after: 1,
        },
        "open-queued",
      ),
    );
    expect(queued).toMatchObject({ ok: false, errorCode: "too-many-queued-pages" });

    const secondGate = deferred();
    const search = companion.dispatch(
      request(
        "search",
        { conversationId: "queue", query: "timeline", limit: 1 },
        "search-delayed",
      ),
      { beforeCommit: () => secondGate.promise },
    );
    const capped = await companion.dispatch(
      request("status", { conversationId: null }, "status-capped"),
    );
    expect(capped).toMatchObject({ ok: false, errorCode: "too-many-in-flight" });
    gate.resolve();
    secondGate.resolve();
    await Promise.all([first, search]);
    expect(companion.usage.inFlightRequests).toBe(0);
    expect(companion.usage.queuedPageRequests).toBe(0);
  });
});

describe("bounded companion client state", () => {
  it("retains only one bounded page, search result set, and code block", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "client", representation: representation(100) }],
    });
    const client = new BoundedCompanionClientState(SESSION);

    client.expect("list-client", "list");
    const listed = await companion.dispatch(
      request("list", { cursor: null, limit: 10 }, "list-client"),
    );
    expect(client.apply(listed).ok).toBe(true);
    expect(client.snapshot.conversations).toHaveLength(1);

    client.expect("open-client", "open");
    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "client",
          anchorEntryId: "entry-94",
          before: 4,
          after: 5,
        },
        "open-client",
      ),
    );
    expect(client.apply(opened).ok).toBe(true);
    expect(client.snapshot.page?.entries).toHaveLength(10);
    expect(JSON.stringify(client.snapshot.page)).not.toContain("privateCode");

    client.expect("search-client", "search");
    const searched = await companion.dispatch(
      request(
        "search",
        { conversationId: "client", query: "searchable", limit: 5 },
        "search-client",
      ),
    );
    expect(client.apply(searched).ok).toBe(true);
    expect(client.snapshot.searchConversationId).toBe("client");
    expect(client.snapshot.searchResults.length).toBeLessThanOrEqual(5);

    const entry = client.snapshot.page!.entries.find((candidate) => candidate.codeBlockCount > 0)!;
    client.expect("code-client", "code");
    const coded = await companion.dispatch(
      request(
        "code",
        { conversationId: "client", entryId: entry.id, blockIndex: 0 },
        "code-client",
      ),
    );
    expect(client.apply(coded).ok).toBe(true);
    expect(client.snapshot.code?.text).toContain("privateCode");

    client.expect("close-client", "close");
    const closed = await companion.dispatch(
      request("close", { conversationId: "client" }, "close-client"),
    );
    expect(client.apply(closed).ok).toBe(true);
    expect(client.snapshot).toMatchObject({
      page: null,
      searchConversationId: null,
      searchResults: [],
      code: null,
      pendingRequestCount: 0,
    });
  });

  it("rejects duplicate, excess, unsolicited, and operation-mismatched replies", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "client", representation: representation(5) }],
    });
    const client = new BoundedCompanionClientState(SESSION, {
      maxPendingRequests: 1,
    });
    expect(client.expect("one", "list").ok).toBe(true);
    expect(client.expect("one", "list").ok).toBe(false);
    expect(client.expect("two", "status").ok).toBe(false);

    const unsolicited = await companion.dispatch(
      request("list", { cursor: null, limit: 1 }, "unsolicited"),
    );
    expect(client.apply(unsolicited).ok).toBe(false);

    const mismatch = await companion.dispatch(
      request("status", { conversationId: null }, "one"),
    );
    expect(client.apply(mismatch).ok).toBe(false);
    expect(client.snapshot.pendingRequestCount).toBe(1);
    expect(client.cancel("one")).toBe(true);
  });

  it("rejects oversized timeline state and drops pending ownership", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "large-client", representation: representation(20) }],
    });
    const client = new BoundedCompanionClientState(SESSION, {
      maxTimelineEntries: 2,
    });
    client.expect("open-large-client", "open");
    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "large-client",
          anchorEntryId: null,
          before: 2,
          after: 2,
        },
        "open-large-client",
      ),
    );
    const result = client.apply(opened);
    expect(result.ok).toBe(false);
    expect(client.snapshot.pendingRequestCount).toBe(0);
    expect(client.snapshot.page).toBeNull();
  });

  it("clears all client state on revoke", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "client", representation: representation(5) }],
    });
    const client = new BoundedCompanionClientState(SESSION);
    client.expect("list-before-revoke", "list");
    client.apply(
      await companion.dispatch(
        request("list", { cursor: null, limit: 5 }, "list-before-revoke"),
      ),
    );
    client.expect("revoke-client", "revoke");
    const revoked = await companion.dispatch(
      request("revoke", {}, "revoke-client"),
    );
    expect(client.apply(revoked).ok).toBe(true);
    expect(client.snapshot).toEqual({
      conversations: [],
      page: null,
      searchConversationId: null,
      searchResults: [],
      code: null,
      lastError: null,
      pendingRequestCount: 0,
    });
  });
});
