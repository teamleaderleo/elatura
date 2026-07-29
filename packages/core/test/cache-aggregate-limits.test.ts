// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  CACHE_ENVELOPE_VERSION,
  SyntheticMemorySnapshotCache,
  type CacheIsolationKey,
  type SnapshotCacheEnvelope,
} from "../src/cache.js";

const key: CacheIsolationKey = {
  origin: "https://synthetic.elatura.invalid",
  profile: "profile-a",
  adapter: "toy",
  namespace: "snapshot",
  resource: "aggregate-fixture",
};

function validatePayload(input: unknown) {
  if (typeof input === "object" && input !== null && "text" in input && typeof input.text === "string") {
    return { ok: true as const, value: { text: input.text }, warnings: [] };
  }
  return { ok: false as const, issues: [{ path: "$", code: "invalid-payload", message: "Expected text." }] };
}

function envelope(text: string): SnapshotCacheEnvelope<{ text: string }> {
  return {
    envelopeVersion: CACHE_ENVELOPE_VERSION,
    key,
    adapter: { id: "toy", version: "1" },
    structural: { fingerprintHash: "shape" },
    content: { scheme: "fixture", value: "aggregate" },
    freshness: { capturedAt: 100, staleAt: 200, expiresAt: 300 },
    provenance: {
      authority: { origin: key.origin },
      capturedAt: 100,
      adapter: { id: "toy", version: "1" },
      transformation: { kind: "windowed", id: "toy", version: "1" },
      cache: { kind: "memory", envelopeVersion: CACHE_ENVELOPE_VERSION },
      freshness: { capturedAt: 100, staleAt: 200, expiresAt: 300 },
      synthetic: true,
    },
    payload: { text },
  };
}

function codes(result: ReturnType<SyntheticMemorySnapshotCache<{ text: string }>["put"]>): string[] {
  return result.ok ? [] : result.issues.map((item) => item.code);
}

describe("synthetic cache aggregate limits", () => {
  it("reports aggregate serialized-byte rejection without retaining the candidate", () => {
    const cache = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: {
        maxEntrySerializedBytes: 4_096,
        maxTotalSerializedBytes: 512,
        maxEntryAccountedBytes: 20_000,
        maxTotalAccountedBytes: 100_000,
      },
      now: () => 100,
    });
    expect(codes(cache.put(envelope("x".repeat(600))))).toContain(
      "cache-aggregate-serialized-byte-limit",
    );
    expect(cache.usage).toEqual({ entryCount: 0, serializedBytes: 0, accountedBytes: 0 });
  });

  it("reports aggregate accounted-byte rejection separately", () => {
    const cache = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: {
        maxEntrySerializedBytes: 4_096,
        maxTotalSerializedBytes: 8_192,
        maxEntryAccountedBytes: 20_000,
        maxTotalAccountedBytes: 1_000,
      },
      now: () => 100,
    });
    expect(codes(cache.put(envelope("x".repeat(300))))).toContain(
      "cache-aggregate-accounted-byte-limit",
    );
    expect(cache.usage).toEqual({ entryCount: 0, serializedBytes: 0, accountedBytes: 0 });
  });
});
