// SPDX-License-Identifier: MPL-2.0
import {
  assessAdapterVersionCompatibility,
  type AdapterIdentity,
  type AdapterVersionPolicy,
} from "./adapter-contract.js";
import {
  resolveFreshnessState,
  sameFreshnessWindow,
  validateContentProvenance,
  validateFreshnessWindow,
  type ContentProvenance,
  type FreshnessState,
  type FreshnessWindow,
} from "./representation.js";
import type { ValidationIssue, ValidationResult } from "./index.js";

export const CACHE_ENVELOPE_VERSION = 1 as const;

export type CacheIsolationKey = {
  origin: string;
  profile: string;
  adapter: string;
  namespace: string;
  resource: string;
};

export type CacheStructuralIdentity = { fingerprintHash: string };
export type CacheContentIdentity = { scheme: string; value: string; revision?: string };

export type SnapshotCacheEnvelope<T> = {
  envelopeVersion: typeof CACHE_ENVELOPE_VERSION;
  key: CacheIsolationKey;
  adapter: AdapterIdentity;
  structural: CacheStructuralIdentity;
  content: CacheContentIdentity;
  freshness: FreshnessWindow;
  provenance: ContentProvenance;
  payload: T;
};

export type CacheRetentionPolicy = { maxEntries: number; maxAgeMs: number };
export type CacheLookupContext = {
  adapter: AdapterVersionPolicy;
  structuralFingerprintHash: string;
  expectedContent?: CacheContentIdentity;
  now?: number;
};
export type CacheMissReason =
  | "missing"
  | "corrupt"
  | "unsupported-envelope-version"
  | "adapter-id-mismatch"
  | "adapter-version-incompatible"
  | "schema-drift"
  | "content-identity-mismatch"
  | "expired";
export type CacheReadResult<T> =
  | { status: "hit"; freshness: Exclude<FreshnessState, "expired">; envelope: SnapshotCacheEnvelope<T> }
  | { status: "miss"; reason: CacheMissReason };
export type CacheInvalidationScope = Partial<CacheIsolationKey>;
export type CacheProtectionContext = { key: CacheIsolationKey; envelopeVersion: number };

export interface PersistentCacheProtectionHooks {
  readonly id: string;
  seal(plaintext: Uint8Array, context: CacheProtectionContext): Promise<Uint8Array>;
  open(ciphertext: Uint8Array, context: CacheProtectionContext): Promise<Uint8Array>;
  deleteKeyMaterial?(scope: CacheInvalidationScope): Promise<void>;
}

export type SyntheticMemorySnapshotCacheOptions<T> = {
  validatePayload: (payload: unknown) => ValidationResult<T>;
  retention?: Partial<CacheRetentionPolicy>;
  now?: () => number;
  seedEntries?: readonly (readonly [string, string])[];
};

const MAX_CACHE_TOKEN = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push({ path: `${path}.${key}`, code: "unknown-field", message: "Unexpected field for this envelope version." });
    }
  }
}

function validOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === origin
    );
  } catch {
    return false;
  }
}

function nonEmptyBounded(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CACHE_TOKEN &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseAdapterIdentity(input: unknown, path: string, issues: ValidationIssue[]): AdapterIdentity | null {
  if (!isRecord(input)) {
    issues.push({ path, code: "invalid-adapter-identity", message: "Expected adapter id and version." });
    return null;
  }
  exactKeys(input, ["id", "version"], path, issues);
  if (!nonEmptyBounded(input.id) || !nonEmptyBounded(input.version)) {
    issues.push({ path, code: "invalid-adapter-identity", message: "Expected bounded adapter id and version." });
    return null;
  }
  return { id: input.id, version: input.version };
}

export function validateCacheIsolationKey(input: unknown, path = "$.key"): ValidationResult<CacheIsolationKey> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path, code: "cache-key-not-object", message: "Expected an object." }] };
  }
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["origin", "profile", "adapter", "namespace", "resource"], path, issues);
  if (!nonEmptyBounded(input.origin) || !validOrigin(input.origin)) {
    issues.push({ path: `${path}.origin`, code: "invalid-cache-origin", message: "Expected an exact HTTP(S) origin without credentials." });
  }
  for (const field of ["profile", "adapter", "namespace", "resource"] as const) {
    if (!nonEmptyBounded(input[field])) {
      issues.push({ path: `${path}.${field}`, code: "invalid-cache-key-field", message: "Expected a bounded non-empty string." });
    }
  }
  if (
    issues.length > 0 ||
    typeof input.origin !== "string" ||
    typeof input.profile !== "string" ||
    typeof input.adapter !== "string" ||
    typeof input.namespace !== "string" ||
    typeof input.resource !== "string"
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      origin: input.origin,
      profile: input.profile,
      adapter: input.adapter,
      namespace: input.namespace,
      resource: input.resource,
    },
    warnings: [],
  };
}

export function serializeCacheIsolationKey(key: CacheIsolationKey): string {
  return JSON.stringify([key.origin, key.profile, key.adapter, key.namespace, key.resource]);
}

function parseContentIdentity(input: unknown, path: string, issues: ValidationIssue[]): CacheContentIdentity | null {
  if (!isRecord(input)) {
    issues.push({ path, code: "invalid-content-identity", message: "Expected an opaque content identity." });
    return null;
  }
  exactKeys(input, ["scheme", "value", "revision"], path, issues);
  if (!nonEmptyBounded(input.scheme) || !nonEmptyBounded(input.value)) {
    issues.push({ path, code: "invalid-content-identity", message: "Expected bounded scheme and value fields." });
    return null;
  }
  if (input.revision !== undefined && !nonEmptyBounded(input.revision)) {
    issues.push({ path: `${path}.revision`, code: "invalid-content-revision", message: "Expected a bounded non-empty string." });
    return null;
  }
  return {
    scheme: input.scheme,
    value: input.value,
    ...(typeof input.revision === "string" ? { revision: input.revision } : {}),
  };
}

function sameContentIdentity(left: CacheContentIdentity, right: CacheContentIdentity): boolean {
  return left.scheme === right.scheme && left.value === right.value && left.revision === right.revision;
}

function sameIsolationKey(left: CacheIsolationKey, right: CacheIsolationKey): boolean {
  return serializeCacheIsolationKey(left) === serializeCacheIsolationKey(right);
}

function withPayloadPath(issue: ValidationIssue): ValidationIssue {
  return { ...issue, path: `$.payload${issue.path === "$" ? "" : issue.path.slice(1)}` };
}

function validateEnvelope<T>(
  input: unknown,
  validatePayload: (payload: unknown) => ValidationResult<T>,
): ValidationResult<SnapshotCacheEnvelope<T>> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", code: "cache-envelope-not-object", message: "Expected an object." }] };
  }
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["envelopeVersion", "key", "adapter", "structural", "content", "freshness", "provenance", "payload"], "$", issues);
  if (input.envelopeVersion !== CACHE_ENVELOPE_VERSION) {
    issues.push({ path: "$.envelopeVersion", code: "unsupported-envelope-version", message: "Unsupported cache envelope version." });
  }

  const keyResult = validateCacheIsolationKey(input.key);
  if (!keyResult.ok) issues.push(...keyResult.issues);
  const adapter = parseAdapterIdentity(input.adapter, "$.adapter", issues);

  let structural: CacheStructuralIdentity | null = null;
  if (!isRecord(input.structural)) {
    issues.push({ path: "$.structural", code: "invalid-structural-identity", message: "Expected structural identity metadata." });
  } else {
    exactKeys(input.structural, ["fingerprintHash"], "$.structural", issues);
    if (!nonEmptyBounded(input.structural.fingerprintHash)) {
      issues.push({ path: "$.structural.fingerprintHash", code: "invalid-structural-identity", message: "Expected a bounded fingerprint hash." });
    } else {
      structural = { fingerprintHash: input.structural.fingerprintHash };
    }
  }

  const content = parseContentIdentity(input.content, "$.content", issues);
  const freshnessResult = validateFreshnessWindow(input.freshness);
  if (!freshnessResult.ok) issues.push(...freshnessResult.issues);
  const provenanceResult = validateContentProvenance(input.provenance);
  if (!provenanceResult.ok) issues.push(...provenanceResult.issues);

  let payloadResult: ValidationResult<T>;
  try {
    payloadResult = validatePayload(input.payload);
  } catch {
    payloadResult = {
      ok: false,
      issues: [{ path: "$", code: "payload-validator-threw", message: "Payload validation failed safely." }],
    };
  }
  if (!payloadResult.ok) issues.push(...payloadResult.issues.map(withPayloadPath));

  if (keyResult.ok && adapter) {
    if (adapter.id !== keyResult.value.adapter) {
      issues.push({ path: "$.adapter.id", code: "cache-key-adapter-mismatch", message: "Adapter id must match the isolation key." });
    }
  }
  if (keyResult.ok && provenanceResult.ok) {
    if (provenanceResult.value.synthetic !== true) {
      issues.push({ path: "$.provenance.synthetic", code: "private-content-disabled", message: "This cache accepts synthetic entries only." });
    }
    if (provenanceResult.value.authority.origin !== keyResult.value.origin) {
      issues.push({ path: "$.provenance.authority.origin", code: "cache-key-origin-mismatch", message: "Authority origin must match the isolation key." });
    }
  }
  if (adapter && provenanceResult.ok) {
    if (
      provenanceResult.value.adapter.id !== adapter.id ||
      provenanceResult.value.adapter.version !== adapter.version
    ) {
      issues.push({ path: "$.provenance.adapter", code: "provenance-adapter-mismatch", message: "Provenance adapter must match the envelope adapter." });
    }
  }
  if (freshnessResult.ok && provenanceResult.ok && !sameFreshnessWindow(freshnessResult.value, provenanceResult.value.freshness)) {
    issues.push({ path: "$.provenance.freshness", code: "provenance-freshness-mismatch", message: "Provenance and envelope freshness windows must match." });
  }
  if (provenanceResult.ok) {
    if (
      provenanceResult.value.cache.kind !== "memory" ||
      provenanceResult.value.cache.envelopeVersion !== CACHE_ENVELOPE_VERSION
    ) {
      issues.push({ path: "$.provenance.cache", code: "invalid-cache-provenance", message: "Expected memory cache provenance for envelope version 1." });
    }
  }

  if (
    issues.length > 0 ||
    !keyResult.ok ||
    adapter === null ||
    structural === null ||
    content === null ||
    !freshnessResult.ok ||
    !provenanceResult.ok ||
    !payloadResult.ok
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      envelopeVersion: CACHE_ENVELOPE_VERSION,
      key: keyResult.value,
      adapter,
      structural,
      content,
      freshness: freshnessResult.value,
      provenance: provenanceResult.value,
      payload: payloadResult.value,
    },
    warnings: [...freshnessResult.warnings, ...provenanceResult.warnings, ...payloadResult.warnings],
  };
}

export class SyntheticMemorySnapshotCache<T> {
  readonly #entries = new Map<string, string>();
  readonly #validatePayload: (payload: unknown) => ValidationResult<T>;
  readonly #retention: CacheRetentionPolicy;
  readonly #now: () => number;

  constructor(options: SyntheticMemorySnapshotCacheOptions<T>) {
    this.#validatePayload = options.validatePayload;
    this.#retention = {
      maxEntries: options.retention?.maxEntries ?? 128,
      maxAgeMs: options.retention?.maxAgeMs ?? 24 * 60 * 60 * 1000,
    };
    if (!Number.isInteger(this.#retention.maxEntries) || this.#retention.maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer.");
    }
    if (!Number.isFinite(this.#retention.maxAgeMs) || this.#retention.maxAgeMs < 0) {
      throw new RangeError("maxAgeMs must be a non-negative finite number.");
    }
    this.#now = options.now ?? Date.now;
    for (const [key, value] of options.seedEntries ?? []) this.#entries.set(key, value);
  }

  get size(): number {
    return this.#entries.size;
  }

  put(envelope: SnapshotCacheEnvelope<T>): ValidationResult<SnapshotCacheEnvelope<T>> {
    const parsed = validateEnvelope(envelope, this.#validatePayload);
    if (!parsed.ok) return parsed;
    let serialized: string;
    let normalized: SnapshotCacheEnvelope<T>;
    try {
      serialized = JSON.stringify(parsed.value);
      normalized = JSON.parse(serialized) as SnapshotCacheEnvelope<T>;
    } catch {
      return { ok: false, issues: [{ path: "$", code: "cache-serialization-failed", message: "Envelope must be JSON serializable." }] };
    }
    this.#entries.set(serializeCacheIsolationKey(normalized.key), serialized);
    this.prune(this.#now());
    return { ok: true, value: normalized, warnings: parsed.warnings };
  }

  get(key: CacheIsolationKey, context: CacheLookupContext): CacheReadResult<T> {
    const keyResult = validateCacheIsolationKey(key);
    if (!keyResult.ok) return { status: "miss", reason: "corrupt" };
    const serializedKey = serializeCacheIsolationKey(keyResult.value);
    const serialized = this.#entries.get(serializedKey);
    if (serialized === undefined) return { status: "miss", reason: "missing" };

    let decoded: unknown;
    try {
      decoded = JSON.parse(serialized);
    } catch {
      this.#entries.delete(serializedKey);
      return { status: "miss", reason: "corrupt" };
    }
    const parsed = validateEnvelope(decoded, this.#validatePayload);
    if (!parsed.ok) {
      const reason = parsed.issues.some((issue) => issue.code === "unsupported-envelope-version")
        ? "unsupported-envelope-version"
        : "corrupt";
      this.#entries.delete(serializedKey);
      return { status: "miss", reason };
    }
    const envelope = parsed.value;
    if (!sameIsolationKey(envelope.key, keyResult.value)) {
      this.#entries.delete(serializedKey);
      return { status: "miss", reason: "corrupt" };
    }
    const compatibility = assessAdapterVersionCompatibility(envelope.adapter, context.adapter);
    if (!compatibility.compatible) {
      this.#entries.delete(serializedKey);
      return { status: "miss", reason: compatibility.reason };
    }
    if (envelope.structural.fingerprintHash !== context.structuralFingerprintHash) {
      this.#entries.delete(serializedKey);
      return { status: "miss", reason: "schema-drift" };
    }
    if (context.expectedContent && !sameContentIdentity(envelope.content, context.expectedContent)) {
      this.#entries.delete(serializedKey);
      return { status: "miss", reason: "content-identity-mismatch" };
    }
    const freshness = resolveFreshnessState(envelope.freshness, context.now ?? this.#now());
    if (freshness === "expired") {
      this.#entries.delete(serializedKey);
      return { status: "miss", reason: "expired" };
    }
    return { status: "hit", freshness, envelope: structuredClone(envelope) };
  }

  delete(key: CacheIsolationKey): boolean {
    const keyResult = validateCacheIsolationKey(key);
    return keyResult.ok && this.#entries.delete(serializeCacheIsolationKey(keyResult.value));
  }

  invalidate(scope: CacheInvalidationScope): number {
    let deleted = 0;
    for (const [serializedKey, serializedEnvelope] of this.#entries) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(serializedEnvelope);
      } catch {
        this.#entries.delete(serializedKey);
        deleted += 1;
        continue;
      }
      if (!isRecord(decoded)) continue;
      const keyResult = validateCacheIsolationKey(decoded.key);
      if (!keyResult.ok) {
        this.#entries.delete(serializedKey);
        deleted += 1;
        continue;
      }
      const matches = (Object.keys(scope) as Array<keyof CacheIsolationKey>).every(
        (field) => scope[field] === undefined || keyResult.value[field] === scope[field],
      );
      if (matches) {
        this.#entries.delete(serializedKey);
        deleted += 1;
      }
    }
    return deleted;
  }

  clear(): number {
    const deleted = this.#entries.size;
    this.#entries.clear();
    return deleted;
  }

  prune(now = this.#now()): number {
    let deleted = 0;
    const retained: Array<{ key: string; capturedAt: number }> = [];
    for (const [key, serialized] of this.#entries) {
      try {
        const parsed = validateEnvelope(JSON.parse(serialized) as unknown, this.#validatePayload);
        if (!parsed.ok || now - parsed.value.freshness.capturedAt > this.#retention.maxAgeMs || now >= parsed.value.freshness.expiresAt) {
          this.#entries.delete(key);
          deleted += 1;
        } else {
          retained.push({ key, capturedAt: parsed.value.freshness.capturedAt });
        }
      } catch {
        this.#entries.delete(key);
        deleted += 1;
      }
    }
    retained.sort((left, right) => left.capturedAt - right.capturedAt || left.key.localeCompare(right.key));
    while (retained.length > this.#retention.maxEntries) {
      const oldest = retained.shift();
      if (oldest && this.#entries.delete(oldest.key)) deleted += 1;
    }
    return deleted;
  }

  dumpSyntheticEntries(): Array<[string, string]> {
    return [...this.#entries.entries()].map(([key, value]) => [key, value]);
  }
}
