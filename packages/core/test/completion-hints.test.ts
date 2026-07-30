// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompletionHintLedger,
  COMPLETION_HINT_PROTOCOL_VERSION,
  parseCompletionHint,
  type CompletionHintEnvelope,
} from "../src/completion-hints.js";

const NOW = 1_000_000;

function envelope(
  sequence: number,
  options: {
    deviceId?: string;
    sourcePackage?: string;
    notificationKeyHash?: string;
    postedAt?: number;
    observedAt?: number;
    issuedAt?: number;
    expiresAt?: number;
    titleToken?: string | null;
    textToken?: string | null;
    kind?: "posted" | "removed" | "ranking-changed";
  } = {},
): CompletionHintEnvelope {
  const issuedAt = options.issuedAt ?? NOW;
  return {
    protocolVersion: COMPLETION_HINT_PROTOCOL_VERSION,
    deviceId: options.deviceId ?? "android.sensor-1",
    sequence,
    issuedAt,
    expiresAt: options.expiresAt ?? issuedAt + 60_000,
    hint: {
      protocolVersion: COMPLETION_HINT_PROTOCOL_VERSION,
      sourcePackage: options.sourcePackage ?? "com.openai.chatgpt",
      observedAt: options.observedAt ?? NOW,
      postedAt: options.postedAt ?? NOW - 100,
      notificationKeyHash: options.notificationKeyHash ?? `sha256:${String(sequence).padStart(16, "0")}`,
      titleToken: options.titleToken ?? "title:length=14:hash=abc123",
      textToken: options.textToken ?? "text:length=28:hash=def456",
      category: "message",
      groupKeyHash: "sha256:group0000000001",
      isOngoing: false,
      kind: options.kind ?? "posted",
      confidence: "probable",
    },
  };
}

describe("completion hint admission", () => {
  it("accepts only the admitted source package", () => {
    expect(parseCompletionHint(envelope(1).hint).sourcePackage).toBe("com.openai.chatgpt");
    expect(() => parseCompletionHint(envelope(1, { sourcePackage: "com.example.other" }).hint)).toThrow(
      "sourcePackage is not admitted by policy",
    );
  });

  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const input = { ...envelope(1).hint } as Record<string, unknown>;
    Object.defineProperty(input, "textToken", {
      enumerable: true,
      get() {
        invoked = true;
        return "secret";
      },
    });

    expect(() => parseCompletionHint(input)).toThrow("Expected own data property: textToken");
    expect(invoked).toBe(false);
  });

  it("accepts ordered envelopes and exposes immutable snapshots", () => {
    const ledger = new BoundedCompletionHintLedger();
    expect(ledger.admit(envelope(1), NOW)).toMatchObject({ status: "accepted", evicted: 0 });
    expect(ledger.admit(envelope(2), NOW)).toMatchObject({ status: "accepted", evicted: 0 });

    const snapshot = ledger.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(ledger.counters).toMatchObject({ accepted: 2, rejected: 0, replayed: 0 });
  });

  it("deduplicates a notification while still advancing its device sequence", () => {
    const ledger = new BoundedCompletionHintLedger();
    const first = envelope(1, { notificationKeyHash: "sha256:same000000000001" });
    const duplicate = envelope(2, { notificationKeyHash: "sha256:same000000000001" });

    expect(ledger.admit(first, NOW).status).toBe("accepted");
    expect(ledger.admit(duplicate, NOW).status).toBe("duplicate");
    expect(ledger.admit(envelope(3), NOW).status).toBe("accepted");
    expect(ledger.counters.duplicates).toBe(1);
    expect(ledger.size).toBe(2);
  });

  it("rejects replayed and implausibly gapped sequences", () => {
    const ledger = new BoundedCompletionHintLedger({ maxSequenceGap: 3 });
    expect(ledger.admit(envelope(10), NOW).status).toBe("accepted");
    expect(ledger.admit(envelope(10), NOW).status).toBe("replayed");
    expect(ledger.admit(envelope(20), NOW).status).toBe("rejected");
    expect(ledger.counters).toMatchObject({ replayed: 1, sequenceGapRejected: 1 });
  });

  it("rejects expired, stale, and future-dated events separately", () => {
    const ledger = new BoundedCompletionHintLedger({ maxPastAgeMs: 5_000, maxFutureSkewMs: 1_000 });

    expect(ledger.admit(envelope(1, { expiresAt: NOW }), NOW).status).toBe("expired");
    expect(ledger.admit(envelope(2, { observedAt: NOW - 5_001 }), NOW).status).toBe("stale");
    expect(ledger.admit(envelope(3, { observedAt: NOW + 1_001 }), NOW).status).toBe("rejected");
    expect(ledger.counters).toMatchObject({ expired: 1, stale: 1, rejected: 1 });
  });

  it("evicts deterministically at the queue bound", () => {
    const ledger = new BoundedCompletionHintLedger({ maxQueueEntries: 2 });
    expect(ledger.admit(envelope(1), NOW)).toMatchObject({ status: "accepted", evicted: 0 });
    expect(ledger.admit(envelope(2), NOW)).toMatchObject({ status: "accepted", evicted: 0 });
    expect(ledger.admit(envelope(3), NOW)).toMatchObject({ status: "accepted", evicted: 1 });

    expect(ledger.snapshot().map((hint) => hint.notificationKeyHash)).toEqual([
      "sha256:0000000000000002",
      "sha256:0000000000000003",
    ]);
    expect(ledger.counters.evicted).toBe(1);
  });

  it("drains bounded batches and permits a later duplicate after removal", () => {
    const ledger = new BoundedCompletionHintLedger({ maxQueueEntries: 3 });
    const first = envelope(1, { notificationKeyHash: "sha256:drain00000000001" });
    expect(ledger.admit(first, NOW).status).toBe("accepted");
    expect(ledger.admit(envelope(2), NOW).status).toBe("accepted");

    expect(ledger.drain(1)).toHaveLength(1);
    expect(ledger.size).toBe(1);
    expect(
      ledger.admit(envelope(3, { notificationKeyHash: "sha256:drain00000000001" }), NOW).status,
    ).toBe("accepted");
  });

  it("clears queued hints and replay state", () => {
    const ledger = new BoundedCompletionHintLedger();
    expect(ledger.admit(envelope(9), NOW).status).toBe("accepted");
    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(ledger.admit(envelope(1), NOW).status).toBe("accepted");
  });

  it("stays bounded under synthetic notification traffic", () => {
    const ledger = new BoundedCompletionHintLedger({ maxQueueEntries: 32, maxSequenceGap: 2 });
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      expect(ledger.admit(envelope(sequence), NOW).status).toBe("accepted");
    }
    expect(ledger.size).toBe(32);
    expect(ledger.counters).toMatchObject({ accepted: 100, evicted: 68 });
  });
});
