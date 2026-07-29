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
    items?: string[];
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
    payload: { items: options.items ?? ["one", "two"] },
  };
}

const lookup = {
  adapter: { adapterId: "toy", currentVersion: "2.0.0", readableVersions: ["1.0.0"] },
  structuralFingerprintHash: "shape-a",
  expectedContent: { scheme: "synthetic-fixture", value: "content-a", revision: "1" },
};

function resultCodes(result: ReturnType<SyntheticMemorySnapshotCache<{ items: string[] }>["put"]>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("synthetic memory snapshot cache", () => {
  it("keeps freshness independent from adapter and schema compatibility", () => {
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    expect(cache.put(envelope()).ok).toBe(true);
    expect(cache.get(baseKey, { ...lookup, now: 150 })).toMatchObject({ status: "hit", freshness: "fresh" });
    expect(cache.get(baseKey, { ...lookup, now: 250 })).toMatchObject({ status: "hit", freshness: "stale" });
    expect(cache.get(baseKey, { ...lookup, now: 300 })).toEqual({ status: "miss", reason: "expired" });
    expect(cache.size).toBe(0);
    expect(cache.usage).toEqual({ entryCount: 0, serializedBytes: 0, accountedBytes: 0 });
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
    expect(cache.usage.entryCount).toBe(1);
  });

  it("deletes corrupt restored entries and returns a recoverable miss", () => {
    const cache = new SyntheticMemorySnapshotCache({
      validatePayload,
      seedEntries: [[serializeCacheIsolationKey(baseKey), "{broken-json"]],
    });
    expect(cache.size).toBe(1);
    expect(cache.get(baseKey, { ...lookup, now: 150 })).toEqual({ status: "miss", reason: "corrupt" });
    expect(cache.usage).toEqual({ entryCount: 0, serializedBytes: 0, accountedBytes: 0 });
  });

  it("rejects non-synthetic payloads and enforces deterministic count retention", () => {
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
    expect(cache.get({ ...baseKey, resource: "fixture-0" }, { ...lookup, expectedContent: undefined, now: 150 })).toEqual({
      status: "miss",
      reason: "missing",
    });
  });

  it("stores the payload validator's normalized value instead of raw extra fields", () => {
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    const input = envelope() as SnapshotCacheEnvelope<{ items: string[] }> & {
      payload: { items: string[]; hidden?: string };
    };
    input.payload.hidden = "must not survive validation";
    const stored = cache.put(input);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.payload).toEqual({ items: ["one", "two"] });
    expect("hidden" in stored.value.payload).toBe(false);
    const hit = cache.get(baseKey, { ...lookup, now: 150 });
    expect(hit.status).toBe("hit");
    if (hit.status === "hit") expect(hit.envelope.payload).toEqual({ items: ["one", "two"] });
  });

  it("rejects provenance and freshness inconsistencies", () => {
    const adapterMismatch = envelope();
    adapterMismatch.provenance.adapter.version = "other";
    const freshnessMismatch = envelope();
    freshnessMismatch.provenance.freshness.staleAt = 201;
    const cacheMismatch = envelope();
    cacheMismatch.provenance.cache = { kind: "none" };
    const unsafeReference = envelope();
    unsafeReference.provenance.authority.reference = "javascript:alert(1)";

    for (const candidate of [adapterMismatch, freshnessMismatch, cacheMismatch, unsafeReference]) {
      const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
      expect(cache.put(candidate).ok).toBe(false);
      expect(cache.size).toBe(0);
    }
  });

  it("rejects unknown fields, validators that throw, accessors, and proxies safely", () => {
    const extra = envelope() as SnapshotCacheEnvelope<{ items: string[] }> & { hidden?: string };
    extra.hidden = "not part of envelope v1";
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    expect(cache.put(extra).ok).toBe(false);

    const throwing = new SyntheticMemorySnapshotCache<{ items: string[] }>({
      validatePayload: () => {
        throw new Error("private payload detail");
      },
      now: () => 100,
    });
    const thrownResult = throwing.put(envelope());
    expect(resultCodes(thrownResult)).toContain("payload-validator-threw");
    expect(JSON.stringify(thrownResult)).not.toContain("private payload detail");

    const accessor = envelope() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "payload", {
      enumerable: true,
      get() {
        throw new Error("private accessor detail");
      },
    });
    const accessorResult = cache.put(accessor);
    expect(resultCodes(accessorResult)).toContain("cache-envelope-inspection-failed");
    expect(JSON.stringify(accessorResult)).not.toContain("private accessor detail");

    const proxy = new Proxy(envelope(), {
      ownKeys() {
        throw new Error("private proxy detail");
      },
    });
    const proxyResult = cache.put(proxy);
    expect(resultCodes(proxyResult)).toContain("cache-envelope-inspection-failed");
    expect(JSON.stringify(proxyResult)).not.toContain("private proxy detail");
    expect(cache.size).toBe(0);
  });

  it("distinguishes per-entry serialized, accounted, and JSON unit limits", () => {
    const serialized = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: {
        maxEntrySerializedBytes: 512,
        maxTotalSerializedBytes: 8_192,
      },
      now: () => 100,
    });
    expect(resultCodes(serialized.put(envelope(baseKey, { items: ["x".repeat(2_000)] })))).toContain(
      "cache-entry-byte-limit",
    );
    expect(serialized.size).toBe(0);

    const accounted = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: {
        maxEntryAccountedBytes: 1_000,
        maxTotalAccountedBytes: 20_000,
      },
      now: () => 100,
    });
    expect(resultCodes(accounted.put(envelope(baseKey, { items: ["x".repeat(500)] })))).toContain(
      "cache-entry-accounted-byte-limit",
    );

    const units = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: { maxJsonStringCodeUnits: 16 },
      now: () => 100,
    });
    expect(resultCodes(units.put(envelope()))).toContain("cache-entry-unit-limit");
  });

  it("admits replacements atomically and never exposes partial aggregate usage", () => {
    const cache = new SyntheticMemorySnapshotCache({
      validatePayload,
      retention: {
        maxEntries: 2,
        maxEntrySerializedBytes: 4_096,
        maxEntryAccountedBytes: 20_000,
        maxTotalSerializedBytes: 5_000,
        maxTotalAccountedBytes: 25_000,
      },
      now: () => 100,
    });
    expect(cache.put(envelope()).ok).toBe(true);
    const before = cache.usage;
    const rejected = cache.put(envelope(baseKey, { items: ["x".repeat(10_000)] }));
    expect(rejected.ok).toBe(false);
    expect(cache.usage).toEqual(before);
    expect(cache.get(baseKey, { ...lookup, now: 150 }).status).toBe("hit");
  });

  it("returns to a stable accounting plateau across repeated put/get/delete cycles", () => {
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    let plateau: typeof cache.usage | null = null;
    for (let index = 0; index < 25; index += 1) {
      expect(cache.put(envelope()).ok).toBe(true);
      const current = cache.usage;
      expect(current.entryCount).toBe(1);
      expect(current.serializedBytes).toBeGreaterThan(0);
      expect(current.accountedBytes).toBeGreaterThan(current.serializedBytes);
      plateau ??= current;
      expect(current).toEqual(plateau);
      expect(cache.get(baseKey, { ...lookup, now: 150 }).status).toBe("hit");
      expect(cache.usage).toEqual(plateau);
      expect(cache.delete(baseKey)).toBe(true);
      expect(cache.usage).toEqual({ entryCount: 0, serializedBytes: 0, accountedBytes: 0 });
    }
  });

  it("returns caller-owned clones without retaining callbacks or payload references", () => {
    const cache = new SyntheticMemorySnapshotCache({ validatePayload, now: () => 100 });
    expect(cache.put(envelope()).ok).toBe(true);
    const hit = cache.get(baseKey, { ...lookup, now: 150 });
    expect(hit.status).toBe("hit");
    if (hit.status !== "hit") return;
    expect(cache.delete(baseKey)).toBe(true);
    expect(cache.usage.entryCount).toBe(0);
    hit.envelope.payload.items.push("caller-owned");
    expect(cache.get(baseKey, { ...lookup, now: 150 })).toEqual({ status: "miss", reason: "missing" });
  });
});
