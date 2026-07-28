// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  CACHE_ENVELOPE_VERSION,
  SyntheticMemorySnapshotCache,
  serializeCacheIsolationKey,
  type CacheIsolationKey,
  type SnapshotCacheEnvelope,
} from "../src/cache.js";

const baseKey: CacheIsolationKey = {
  origin: "https://synthetic.elatura.invalid",
  profile: "profile-a",
  adapter: "toy",
  namespace: "snapshot",
  resource: "fixture-a",
};

function validatePayload(input: unknown) {
  if (
    typeof input === "object" &&
    input !== null &&
    "items" in input &&
    Array.isArray(input.items) &&
    input.items.every((item) => typeof item === "string")
  ) {
    return { ok: true as const, value: { items: [...input.items] }, warnings: [] };
  }
  return { ok: false as const, issues: [{ path: "$", code: "invalid-payload", message: "Expected string items." }] };
}

function envelope(
  key: CacheIsolationKey = baseKey,
  options: {
    capturedAt?: number;
    staleAt?: number;
    expiresAt?: number;
    adapterVersion?: string;
    fingerprintHash?: string;
    contentValue?: string;
    synthetic?: boolean;
  } = {},
): SnapshotCacheEnvelope<{ items: string[] }> {
  const capturedAt = options.capturedAt ?? 100;
  const staleAt = options.staleAt ?? 200;
  const expiresAt = options.expiresAt ?? 300;
  const adapterVersion = options.adapterVersion ?? "2.0.0";
  return {
    envelopeVersion: CACHE_ENVELOPE_VERSION,
    key,
    adapter: { id: key.adapter, version: adapterVersion },
    structural: { fingerprintHash: options.fingerprintHash ?? "shape-a" },
    content: { scheme: "synthetic-fixture", value: options.contentValue ?? "content-a", revision: "1" },
    freshness: { capturedAt, staleAt, expiresAt },
    provenance: {
      authority: { origin: key.origin, reference: `${key.origin}/fixture` },
      capturedAt,
      adapter: { id: key.adapter, version: adapterVersion },
      transformation: { kind: "windowed", id: "toy-window", version: "1" },
      cache: { kind: "memory", envelopeVersion: CACHE_ENVELOPE_VERSION },
      freshness: { capturedAt, staleAt, expiresAt },
      synthetic: options.synthetic ?? true,
    },
    payload: { items: ["one", "two"] },
  };
}

const lookup = {
  adapter: { adapterId: "toy", currentVersion: "2.0.0", readableVersions: ["1.0.0"] },
  structuralFingerprintHash: "shape-a",
  expectedContent: { scheme: "synthetic-fixture", value: "content-a", revision: "1" },
};

describe("synthetic memory snapshot cache", () => {
  it("keeps freshness independent from adapter and schema compatibility", () => {
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    expect(cache.put(envelope()).ok).toBe(true);
    expect(cache.get(baseKey, { ...lookup, now: 150 })).toMatchObject({ status: "hit", freshness: "fresh" });
    expect(cache.get(baseKey, { ...lookup, now: 250 })).toMatchObject({ status: "hit", freshness: "stale" });
    expect(cache.get(baseKey, { ...lookup, now: 300 })).toEqual({ status: "miss", reason: "expired" });
    expect(cache.size).toBe(0);
  });

  it("accepts only exact or explicitly readable adapter versions", () => {
    const compatible = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    expect(compatible.put(envelope(baseKey, { adapterVersion: "1.0.0" })).ok).toBe(true);
    expect(compatible.get(baseKey, { ...lookup, now: 150 }).status).toBe("hit");

    const incompatible = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    expect(incompatible.put(envelope(baseKey, { adapterVersion: "0.5.0" })).ok).toBe(true);
    expect(incompatible.get(baseKey, { ...lookup, now: 150 })).toEqual({
      status: "miss",
      reason: "adapter-version-incompatible",
    });
  });

  it("invalidates schema drift and content identity mismatches separately", () => {
    const schemaCache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    schemaCache.put(envelope());
    expect(schemaCache.get(baseKey, { ...lookup, structuralFingerprintHash: "shape-b", now: 150 })).toEqual({
      status: "miss",
      reason: "schema-drift",
    });

    const contentCache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    contentCache.put(envelope());
    expect(
      contentCache.get(baseKey, {
        ...lookup,
        expectedContent: { scheme: "synthetic-fixture", value: "content-b", revision: "1" },
        now: 150,
      }),
    ).toEqual({ status: "miss", reason: "content-identity-mismatch" });
  });

  it("isolates origins, profiles, and adapters and supports scoped deletion", () => {
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    const profileB = { ...baseKey, profile: "profile-b", resource: "fixture-b" };
    const adapterB = { ...baseKey, adapter: "other", resource: "fixture-c" };
    cache.put(envelope(baseKey));
    cache.put(envelope(profileB));
    cache.put(envelope(adapterB));
    expect(cache.invalidate({ origin: baseKey.origin, profile: "profile-a", adapter: "toy" })).toBe(1);
    expect(cache.size).toBe(2);
    expect(cache.delete(profileB)).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("deletes corrupt restored entries and returns a recoverable miss", () => {
    const cache = new SyntheticMemorySnapshotCache({
      validatePayload,
      seedEntries: [[serializeCacheIsolationKey(baseKey), "{broken-json"]],
    });
    expect(cache.get(baseKey, { ...lookup, now: 150 })).toEqual({ status: "miss", reason: "corrupt" });
    expect(cache.size).toBe(0);
  });

  it("rejects non-synthetic payloads and enforces retention", () => {
    const cache = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: { maxEntries: 2, maxAgeMs: 1_000 },
      now: () => 100,
    });
    expect(cache.put(envelope(baseKey, { synthetic: false })).ok).toBe(false);
    for (let index = 0; index < 3; index += 1) {
      const key = { ...baseKey, resource: `fixture-${index}` };
      expect(cache.put(envelope(key, { capturedAt: 80 + index, staleAt: 200, expiresAt: 300 })).ok).toBe(true);
    }
    expect(cache.size).toBe(2);
  });
});
