// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  parseCompanionRequest,
  parseCompanionResponse,
  type DeliveredCompanionResponse,
  type SyntheticCompanionSource,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

function representation(
  count = 20,
  options: { staleAt?: number; expiresAt?: number; synthetic?: boolean; codeText?: string } = {},
): ReadOnlyRepresentation {
  const entries: ReadOnlyRepresentation["entries"] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      id: `entry-${index}`,
      parentId: index === 0 ? null : `entry-${index - 1}`,
      childIds: index + 1 < count ? [`entry-${index + 1}`] : [],
      sequence: index,
      kind: index % 2 === 0 ? "assistant" : "user",
      label: `entry ${index}`,
      text: `message ${index} parser needle`,
      codeBlocks: index === Math.floor(count / 2)
        ? [{ language: "ts", text: options.codeText ?? `const value${index} = ${index};` }]
        : [],
      ...(index === count - 1
        ? { jumpBackReference: `https://synthetic.elatura.invalid/timeline#entry-${index}` }
        : {}),
    });
  }
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter: { id: "toy", version: "1" },
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/timeline",
      },
      capturedAt: 100,
      adapter: { id: "toy", version: "1" },
      transformation: { kind: "alternate-representation", id: "toy-read-only", version: "1" },
      cache: { kind: "none" },
      freshness: {
        capturedAt: 100,
        staleAt: options.staleAt ?? 200,
        expiresAt: options.expiresAt ?? 300,
      },
      synthetic: options.synthetic ?? true,
    },
    roots: count > 0 ? ["entry-0"] : [],
    activePath: entries.map((entry) => entry.id),
    entries,
  };
}

function source(
  conversationId: string,
  value = representation(),
  currentVersion = "1",
): SyntheticCompanionSource {
  return {
    conversationId,
    label: `Conversation ${conversationId}`,
    representation: value,
    adapterPolicy: { adapterId: "toy", currentVersion },
  };
}

let requestSequence = 0;
function request(
  operation: string,
  fields: Record<string, unknown> = {},
  sessionId = "session-a",
): Record<string, unknown> {
  requestSequence += 1;
  return {
    version: COMPANION_PROTOCOL_VERSION,
    requestId: `request-${requestSequence}`,
    sessionId,
    operation,
    ...fields,
  };
}

function success(delivered: DeliveredCompanionResponse): Extract<DeliveredCompanionResponse["response"], { ok: true }> {
  expect(delivered.response.ok).toBe(true);
  if (!delivered.response.ok) throw new Error(delivered.response.code);
  return delivered.response;
}

function failureCode(delivered: DeliveredCompanionResponse): string | null {
  return delivered.response.ok ? null : delivered.response.code;
}

describe("synthetic companion protocol", () => {
  it("strictly parses versioned requests and rejects unknown or unbounded fields", () => {
    expect(parseCompanionRequest(request("status")).ok).toBe(true);
    const unknown = parseCompanionRequest({ ...request("status"), secret: "value" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues.map((item) => item.code)).toContain("unknown-field");

    const query = parseCompanionRequest(request("search", {
      conversationId: "conversation-a",
      query: "x".repeat(9),
    }), { maxSearchQueryCodeUnits: 8 });
    expect(query.ok).toBe(false);
    if (!query.ok) expect(query.issues.map((item) => item.code)).toContain("search-query-limit");

    const hostile = new Proxy({}, { ownKeys() { throw new Error("private detail"); } });
    const hostileResult = parseCompanionRequest(hostile);
    expect(hostileResult.ok).toBe(false);
    expect(JSON.stringify(hostileResult)).not.toContain("private detail");
  });

  it("strictly validates response envelopes before client admission", () => {
    const companion = new SyntheticCompanion([source("conversation-a", representation(8))]);
    const delivered = companion.dispatch(request("list"), 150);
    expect(parseCompanionResponse(delivered.response).ok).toBe(true);
    const malformed = { ...delivered.response, hidden: "value" };
    const parsed = parseCompanionResponse(malformed);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.map((item) => item.code)).toContain("unknown-field");
    const client = new BoundedCompanionClientState();
    expect(client.apply({ ...delivered, response: malformed as typeof delivered.response })).toBe(false);
  });

  it("opens a huge source as one bounded page and omits code text", () => {
    const codeText = "const enormous = 'private synthetic sentinel';";
    const companion = new SyntheticCompanion([source("conversation-a", representation(500, { codeText }))], {
      policy: { maxEntriesPerPage: 5 },
    });
    const opened = success(companion.dispatch(request("open", {
      conversationId: "conversation-a",
      limit: 5,
    }), 150));
    const page = opened.data as { entries: Array<{ codeBlockCount: number }> };
    expect(page.entries).toHaveLength(5);
    expect(JSON.stringify(opened.data)).not.toContain(codeText);
    expect(companion.usage().residentPages).toBe(1);
  });

  it("keeps repeated conversation switching at deterministic resident plateaus", () => {
    const sources = Array.from({ length: 6 }, (_, index) => source(`conversation-${index}`, representation(40)));
    const companion = new SyntheticCompanion(sources, {
      policy: {
        maxSessions: 8,
        maxResidentConversations: 2,
        maxResidentPages: 3,
        maxEntriesPerPage: 4,
      },
    });
    for (let index = 0; index < sources.length; index += 1) {
      const opened = companion.dispatch(request("open", {
        conversationId: `conversation-${index}`,
        limit: 4,
      }, `session-${index}`), 150);
      expect(opened.response.ok).toBe(true);
      expect(companion.usage().activeConversations).toBeLessThanOrEqual(2);
      expect(companion.usage().residentPages).toBeLessThanOrEqual(3);
    }
  });

  it("returns retained companion and client usage to zero after repeated close cycles", () => {
    const companion = new SyntheticCompanion([source("conversation-a", representation(100))], {
      policy: { maxEntriesPerPage: 6 },
    });
    const client = new BoundedCompanionClientState({ maxEntries: 6 });
    for (let index = 0; index < 10; index += 1) {
      const opened = companion.dispatch(request("open", {
        conversationId: "conversation-a",
        limit: 6,
      }), 150);
      expect(client.apply(opened)).toBe(true);
      const closed = companion.dispatch(request("close"), 150);
      expect(client.apply(closed)).toBe(true);
      expect(companion.usage()).toMatchObject({
        residentPages: 0,
        residentPageBytes: 0,
        retainedSearchResults: 0,
        retainedCodeUnits: 0,
        pendingPageWork: 0,
      });
      expect(client.snapshot()).toMatchObject({ entries: [], searchResults: [], code: null });
    }
  });

  it("discards delayed page work after close and cannot resurrect resident state", () => {
    const companion = new SyntheticCompanion([source("conversation-a", representation(30))], {
      policy: { maxEntriesPerPage: 5 },
    });
    const opened = success(companion.dispatch(request("open", {
      conversationId: "conversation-a",
      limit: 5,
    }), 150));
    const cursor = (opened.data as { beforeCursor: string }).beforeCursor;
    const pending = companion.beginPageWork(request("page", {
      conversationId: "conversation-a",
      cursor,
      direction: "before",
      limit: 5,
    }));
    expect(pending.ok).toBe(true);
    companion.dispatch(request("close"), 150);
    if (!pending.ok) return;
    const completed = companion.completePageWork(pending.work, 150);
    expect(failureCode(completed)).toBe("late-reply-discarded");
    expect(companion.usage()).toMatchObject({ residentPages: 0, pendingPageWork: 0 });
  });

  it("surfaces stale state and fails safely for expired, corrupt, private, and drifted sources", () => {
    const corrupt = representation();
    corrupt.entries[1]!.parentId = "missing";
    const drifted = representation();
    drifted.adapter.version = "old";
    drifted.provenance.adapter.version = "old";
    const companion = new SyntheticCompanion([
      source("stale", representation()),
      source("expired", representation()),
      source("corrupt", corrupt),
      source("private", representation(4, { synthetic: false })),
      source("drifted", drifted),
    ]);

    expect(success(companion.dispatch(request("open", { conversationId: "stale", limit: 4 }), 250)).stale).toBe(true);
    expect(failureCode(companion.dispatch(request("open", { conversationId: "expired", limit: 4 }, "session-b"), 350))).toBe("source-expired");
    expect(failureCode(companion.dispatch(request("open", { conversationId: "corrupt", limit: 4 }, "session-c"), 150))).toBe("source-corrupt");
    expect(failureCode(companion.dispatch(request("open", { conversationId: "private", limit: 4 }, "session-d"), 150))).toBe("source-private-disabled");
    expect(failureCode(companion.dispatch(request("open", { conversationId: "drifted", limit: 4 }, "session-e"), 150))).toBe("adapter-version-incompatible");
  });

  it("uses fixed page, search, code, and response limit failures", () => {
    const companion = new SyntheticCompanion([
      source("conversation-a", representation(20, { codeText: "x".repeat(64) })),
    ], {
      policy: {
        maxEntriesPerPage: 4,
        maxResidentPageBytes: 256,
        maxCodeBlockTextCodeUnits: 32,
        maxSearchQueryCodeUnits: 8,
        maxResponseSerializedBytes: 512,
      },
    });
    expect(failureCode(companion.dispatch(request("open", {
      conversationId: "conversation-a",
      limit: 4,
    }), 150))).toBe("page-limit");

    const codeCompanion = new SyntheticCompanion([
      source("conversation-a", representation(20, { codeText: "x".repeat(64) })),
    ], { policy: { maxEntriesPerPage: 4, maxCodeBlockTextCodeUnits: 32 } });
    expect(codeCompanion.dispatch(request("open", {
      conversationId: "conversation-a",
      limit: 4,
    }), 150).response.ok).toBe(true);
    expect(failureCode(codeCompanion.dispatch(request("code", {
      conversationId: "conversation-a",
      entryId: "entry-10",
      blockIndex: 0,
    }), 150))).toBe("code-limit");
    expect(failureCode(codeCompanion.dispatch(request("search", {
      conversationId: "conversation-a",
      query: "x".repeat(9),
    }), 150))).toBe("search-query-limit");

    const responseCompanion = new SyntheticCompanion([source("conversation-a", representation(8))], {
      policy: { maxResponseSerializedBytes: 128 },
    });
    expect(failureCode(responseCompanion.dispatch(request("list"), 150))).toBe("response-limit");
  });

  it("provides bounded entry, code, search, navigation, and generation-aware client state", () => {
    const companion = new SyntheticCompanion([source("conversation-a", representation(12))], {
      policy: { maxEntriesPerPage: 4, maxSearchResults: 3 },
    });
    const client = new BoundedCompanionClientState({ maxEntries: 4, maxSearchResults: 3 });
    const opened = companion.dispatch(request("open", {
      conversationId: "conversation-a",
      limit: 4,
    }), 150);
    expect(client.apply(opened)).toBe(true);

    const entry = success(companion.dispatch(request("entry", {
      conversationId: "conversation-a",
      entryId: "entry-6",
    }), 150));
    expect(entry.data).toMatchObject({ id: "entry-6", codeBlockCount: 1 });

    const searched = companion.dispatch(request("search", {
      conversationId: "conversation-a",
      query: "needle",
      limit: 3,
    }), 150);
    expect(client.apply(searched)).toBe(true);
    expect(client.snapshot().searchResults).toHaveLength(3);

    const code = companion.dispatch(request("code", {
      conversationId: "conversation-a",
      entryId: "entry-6",
      blockIndex: 0,
    }), 150);
    expect(client.apply(code)).toBe(true);
    expect(client.snapshot().code?.text).toContain("const value6");

    const navigation = success(companion.dispatch(request("navigate", {
      conversationId: "conversation-a",
      entryId: "entry-6",
    }), 150));
    expect(navigation.data).toMatchObject({
      parent: { id: "entry-5" },
      children: [{ id: "entry-7" }],
    });

    const closed = companion.dispatch(request("close"), 150);
    expect(client.apply(closed)).toBe(true);
    expect(client.apply(opened)).toBe(false);
    expect(client.measure().ok).toBe(true);
  });
});
