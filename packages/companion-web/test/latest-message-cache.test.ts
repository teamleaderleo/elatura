// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedLatestMessageCache,
  toLatestSnapshotFromChatGptExport,
  type LatestConversationSnapshot,
} from "../src/latest-message-cache.js";

function snapshot(
  conversationId: string,
  revision: number,
  overrides: Partial<LatestConversationSnapshot> = {},
): LatestConversationSnapshot {
  return {
    conversationId,
    title: `Conversation ${conversationId}`,
    latestMessageId: `message-${revision}`,
    latestMessageCreatedAt: revision,
    sourceUpdatedAt: revision,
    importedAt: revision + 1_000,
    completion: "complete",
    text: `answer-${revision}`,
    textTruncated: false,
    sourceFingerprint: `fingerprint-${conversationId}-${revision}`,
    ...overrides,
  };
}

function assistantNode(
  id: string,
  text: string,
  createTime: number,
  parent: string | null,
  status = "finished_successfully",
): Record<string, unknown> {
  return {
    id: `node-${id}`,
    parent,
    children: [],
    message: {
      id,
      author: { role: "assistant" },
      create_time: createTime,
      status,
      content: { content_type: "text", parts: [text] },
    },
  };
}

function userNode(id: string, parent: string | null): Record<string, unknown> {
  return {
    id: `node-${id}`,
    parent,
    children: [],
    message: {
      id,
      author: { role: "user" },
      create_time: 50,
      status: "finished_successfully",
      content: { content_type: "text", parts: ["question"] },
    },
  };
}

describe("ChatGPT export latest-message import", () => {
  it("walks backward from the active node and retains one assistant message", () => {
    const imported = toLatestSnapshotFromChatGptExport(
      {
        id: "conversation-1",
        title: "Large chat",
        update_time: 70,
        current_node: "user-current",
        mapping: {
          "assistant-old": assistantNode("assistant-old", "old answer", 10, null),
          "assistant-latest": assistantNode(
            "assistant-latest",
            "latest answer",
            40,
            "assistant-old",
          ),
          "user-current": userNode("user-current", "assistant-latest"),
        },
      },
      { now: 100 },
    );

    expect(imported).toMatchObject({
      ok: true,
      value: {
        conversationId: "conversation-1",
        title: "Large chat",
        latestMessageId: "assistant-latest",
        latestMessageCreatedAt: 40,
        sourceUpdatedAt: 70,
        importedAt: 100,
        completion: "complete",
        text: "latest answer",
        textTruncated: false,
      },
    });
    if (imported.ok) {
      expect(imported.value.sourceFingerprint).toMatch(/^chatgpt-export-v1:/u);
    }
  });

  it("falls back deterministically and preserves incomplete and truncation state", () => {
    const imported = toLatestSnapshotFromChatGptExport(
      {
        id: "conversation-2",
        title: "A title longer than the cap",
        update_time: 80,
        current_node: "missing",
        mapping: {
          first: assistantNode("first", "old", 1, null),
          second: assistantNode("second", "abcdefgh", 2, null, "in_progress"),
        },
      },
      { now: 200, maxTitleCodeUnits: 7, maxMessageCodeUnits: 4 },
    );

    expect(imported).toMatchObject({
      ok: true,
      value: {
        title: "A title",
        latestMessageId: "second",
        completion: "incomplete",
        text: "abcd",
        textTruncated: true,
      },
    });
  });

  it("rejects accessor-backed identifiers without invoking them", () => {
    let invoked = false;
    const input = Object.defineProperty(
      {
        mapping: {},
        current_node: null,
      },
      "id",
      {
        enumerable: true,
        get() {
          invoked = true;
          return "hostile";
        },
      },
    );

    expect(toLatestSnapshotFromChatGptExport(input)).toEqual({
      ok: false,
      reason: "conversation-id-invalid",
    });
    expect(invoked).toBe(false);
  });
});

describe("bounded latest-message cache", () => {
  it("suppresses duplicate repaint and rejects older source revisions", () => {
    const cache = new BoundedLatestMessageCache();
    expect(cache.publish(snapshot("a", 2))).toMatchObject({
      outcome: "inserted",
      changed: true,
    });
    expect(cache.publish(snapshot("a", 2))).toMatchObject({
      outcome: "duplicate",
      changed: false,
    });
    expect(cache.publish(snapshot("a", 1))).toMatchObject({
      outcome: "stale",
      changed: false,
      reason: "older-source-revision",
    });
    expect(cache.snapshot.entries[0]?.text).toBe("answer-2");
    expect(cache.snapshot.counters).toMatchObject({
      inserted: 1,
      duplicates: 1,
      stale: 1,
      replaced: 0,
    });
  });

  it("uses deterministic LRU eviction and moves cache hits to the resident end", () => {
    const cache = new BoundedLatestMessageCache({ maxEntries: 2 });
    cache.publish(snapshot("a", 1));
    cache.publish(snapshot("b", 1));
    expect(cache.get("a")?.conversationId).toBe("a");
    const published = cache.publish(snapshot("c", 1));

    expect(published.evictedConversationIds).toEqual(["b"]);
    expect(cache.get("b")).toBeNull();
    expect(cache.snapshot.entries.map((entry) => entry.conversationId)).toEqual([
      "c",
      "a",
    ]);
    expect(cache.snapshot.counters).toMatchObject({ hits: 1, misses: 1, evicted: 1 });
  });

  it("clips admitted text, replaces newer snapshots, and clears all retained state", () => {
    const cache = new BoundedLatestMessageCache({
      maxEntries: 2,
      maxMessageCodeUnits: 8,
      maxTotalTextCodeUnits: 64,
    });
    const inserted = cache.publish(
      snapshot("a", 1, { text: "abcdefghijkl", textTruncated: false }),
    );
    expect(inserted.snapshot.entries[0]).toMatchObject({
      text: "abcdefgh",
      textTruncated: true,
    });

    expect(cache.publish(snapshot("a", 2, { text: "new" }))).toMatchObject({
      outcome: "replaced",
      changed: true,
    });
    expect(cache.get("a")?.text).toBe("new");

    for (let index = 0; index < 1_000; index += 1) {
      expect(cache.get("a")?.latestMessageId).toBe("message-2");
    }
    expect(cache.snapshot.entryCount).toBe(1);

    const cleared = cache.clear();
    expect(cleared).toMatchObject({
      entryCount: 0,
      totalTextCodeUnits: 0,
      serializedBytes: 0,
      counters: { clears: 1 },
    });
  });

  it("rejects accessor-backed snapshots without invoking them", () => {
    const cache = new BoundedLatestMessageCache();
    let invoked = false;
    const hostile = Object.defineProperty(
      { ...snapshot("a", 1) },
      "text",
      {
        enumerable: true,
        get() {
          invoked = true;
          return "secret";
        },
      },
    );

    expect(cache.publish(hostile)).toMatchObject({
      outcome: "rejected",
      changed: false,
    });
    expect(invoked).toBe(false);
    expect(cache.snapshot.entryCount).toBe(0);
  });
});
