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
import {
  accountedResidentBytes,
  serializeBoundedJson,
  utf8ByteLength,
} from "./resource-accounting.js";
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

export type CacheRetentionPolicy = {
  maxEntries: number;
  maxAgeMs: number;
  maxEntrySerializedBytes: number;
  maxEntryAccountedBytes: number;
  maxTotalSerializedBytes: number;
  maxTotalAccountedBytes: number;
  decodedCopyCount: number;
  maxJsonNodes: number;
  maxJsonStringCodeUnits: number;
};

export type SyntheticCacheUsage = Readonly<{
  entryCount: number;
  serializedBytes: number;
  accountedBytes: number;
}>;

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

export const DEFAULT_SYNTHETIC_CACHE_RETENTION_POLICY: CacheRetentionPolicy = Object.freeze({
  maxEntries: 128,
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxEntrySerializedBytes: 4_194_304,
  maxEntryAccountedBytes: 20_971_520,
  maxTotalSerializedBytes: 33_554_432,
  maxTotalAccountedBytes: 167_772_160,
  decodedCopyCount: 3,
  maxJsonNodes: 1_000_000,
  maxJsonStringCodeUnits: 1_048_576,
});

const MAX_CACHE_TOKEN = 512;

type StoredSyntheticEntry = {
  serialized: string;
  serializedBytes: number;
  accountedBytes: number;
  capturedAt: number;
  expiresAt: number;
};

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

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
      issues.push(issue(`${path}.${key}`, "unknown-field", "Unexpected field for this envelope version."));
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
    issues.push(issue(path, "invalid-adapter-identity", "Expected adapter id and version."));
    return null;
  }
  exactKeys(input, ["id", "version"], path, issues);
  if (!nonEmptyBounded(input.id) || !nonEmptyBounded(input.version)) {
    issues.push(issue(path, "invalid-adapter-identity", "Expected bounded adapter id and version."));
    return null;
  }
  return { id: input.id, version: input.version };
}

export function validateCacheIsolationKey(input: unknown, path = "$.key"): ValidationResult<CacheIsolationKey> {
  try {
    if (!isRecord(input)) {
      return { ok: false, issues: [issue(path, "cache-key-not-object", "Expected an object.")] };
    }
    const issues: ValidationIssue[] = [];
    exactKeys(input, ["origin", "profile", "adapter", "namespace", "resource"], path, issues);
    if (!nonEmptyBounded(input.origin) || !validOrigin(input.origin)) {
      issues.push(issue(`${path}.origin`, "invalid-cache-origin", "Expected an exact HTTP(S) origin without credentials."));
    }
    for (const field of ["profile", "adapter", "namespace", "resource"] as const) {
      if (!nonEmptyBounded(input[field])) {
        issues.push(issue(`${path}.${field}`, "invalid-cache-key-field", "Expected a bounded non-empty string."));
      }
    }
    if (
      issues.length > 0 ||
      typeof input.origin !== "string" ||
      typeof input.profile !== "string" ||
      typeof input.adapter !== "string" ||
      typeof input.namespace !== "string" ||
      typeof input.resource !== "string"
    ) return { ok: false, issues };
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
  } catch {
    return { ok: false, issues: [issue(path, "cache-key-inspection-failed", "Cache key inspection failed safely.")] };
  }
}

export function serializeCacheIsolationKey(key: CacheIsolationKey): string {
  return JSON.stringify([key.origin, key.profile, key.adapter, key.namespace, key.resource]);
}

function parseContentIdentity(input: unknown, path: string, issues: ValidationIssue[]): CacheContentIdentity | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-content-identity", "Expected an opaque content identity."));
    return null;
  }
  exactKeys(input, ["scheme", "value", "revision"], path, issues);
  if (!nonEmptyBounded(input.scheme) || !nonEmptyBounded(input.value)) {
    issues.push(issue(path, "invalid-content-identity", "Expected bounded scheme and value fields."));
    return null;
  }
  if (input.revision !== undefined && !nonEmptyBounded(input.revision)) {
    issues.push(issue(`${path}.revision`, "invalid-content-revision", "Expected a bounded non-empty string."));
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

function withPayloadPath(value: ValidationIssue): ValidationIssue {
  return { ...value, path: `$.payload${value.path === "$" ? "" : value.path.slice(1)}` };
}

function validateEnvelope<T>(
  input: unknown,
  validatePayload: (payload: unknown) => ValidationResult<T>,
): ValidationResult<SnapshotCacheEnvelope<T>> {
  if (!isRecord(input)) {
    return { ok: false, issues: [issue("$", "cache-envelope-not-object", "Expected an object.")] };
  }
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["envelopeVersion", "key", "adapter", "structural", "content", "freshness", "provenance", "payload"], "$", issues);
  if (input.envelopeVersion !== CACHE_ENVELOPE_VERSION) {
    issues.push(issue("$.envelopeVersion", "unsupported-envelope-version", "Unsupported cache envelope version."));
  }

  const keyResult = validateCacheIsolationKey(input.key);
  if (!keyResult.ok) issues.push(...keyResult.issues);
  const adapter = parseAdapterIdentity(input.adapter, "$.adapter", issues);

  let structural: CacheStructuralIdentity | null = null;
  if (!isRecord(input.structural)) {
    issues.push(issue("$.structural", "invalid-structural-identity", "Expected structural identity metadata."));
  } else {
    exactKeys(input.structural, ["fingerprintHash"], "$.structural", issues);
    if (!nonEmptyBounded(input.structural.fingerprintHash)) {
      issues.push(issue("$.structural.fingerprintHash", "invalid-structural-identity", "Expected a bounded fingerprint hash."));
    } else structural = { fingerprintHash: input.structural.fingerprintHash };
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
      issues: [issue("$", "payload-validator-threw", "Payload validation failed safely.")],
    };
  }
  if (!payloadResult.ok) issues.push(...payloadResult.issues.map(withPayloadPath));

  if (keyResult.ok && adapter && adapter.id !== keyResult.value.adapter) {
    issues.push(issue("$.adapter.id", "cache-key-adapter-mismatch", "Adapter id must match the isolation key."));
  }
  if (keyResult.ok && provenanceResult.ok) {
    if (provenanceResult.value.synthetic !== true) {
      issues.push(issue("$.provenance.synthetic", "private-content-disabled", "This cache accepts synthetic entries only."));
    }
    if (provenanceResult.value.authority.origin !== keyResult.value.origin) {
      issues.push(issue("$.provenance.authority.origin", "cache-key-origin-mismatch", "Authority origin must match the isolation key."));
    }
  }
  if (
    adapter && provenanceResult.ok &&
    (provenanceResult.value.adapter.id !== adapter.id || provenanceResult.value.adapter.version !== adapter.version)
  ) {
    issues.push(issue("$.provenance.adapter", "provenance-adapter-mismatch", "Provenance adapter must match the envelope adapter."));
  }
  if (freshnessResult.ok && provenanceResult.ok && !sameFreshnessWindow(freshnessResult.value, provenanceResult.value.freshness)) {
    issues.push(issue("$.provenance.freshness", "provenance-freshness-mismatch", "Provenance and envelope freshness windows must match."));
  }
  if (
    provenanceResult.ok &&
    (provenanceResult.value.cache.kind !== "memory" || provenanceResult.value.cache.envelopeVersion !== CACHE_ENVELOPE_VERSION)
  ) {
    issues.push(issue("$.provenance.cache", "invalid-cache-provenance", "Expected memory cache provenance for envelope version 1."));
  }

  if (
    issues.length > 0 || !keyResult.ok || adapter === null || structural === null || content === null ||
    !freshnessResult.ok || !provenanceResult.ok || !payloadResult.ok
  ) return { ok: false, issues };

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

function retentionPolicy(input: Partial<CacheRetentionPolicy> | undefined): CacheRetentionPolicy {
  const resolved = { ...DEFAULT_SYNTHETIC_CACHE_RETENTION_POLICY, ...input };
  for (const field of [
    "maxEntries",
    "maxEntrySerializedBytes",
    "maxEntryAccountedBytes",
    "maxTotalSerializedBytes",
    "maxTotalAccountedBytes",
    "decodedCopyCount",
    "maxJsonNodes",
    "maxJsonStringCodeUnits",
  ] as const) {
    if (!Number.isSafeInteger(resolved[field]) || resolved[field] < 1) {
      throw new RangeError(`${field} must be a positive safe integer.`);
    }
  }
  if (!Number.isFinite(resolved.maxAgeMs) || resolved.maxAgeMs < 0) {
    throw new RangeError("maxAgeMs must be a non-negative finite number.");
  }
  return Object.freeze(resolved);
}

function cacheSerializationIssue(code: string): ValidationIssue {
  if (code === "json-serialized-byte-limit") {
    return issue("$", "cache-entry-byte-limit", "Cache entry exceeds its serialized-byte limit.");
  }
  if (code === "json-string-limit" || code === "json-node-limit" || code === "json-depth-limit") {
    return issue("$", "cache-entry-unit-limit", "Cache entry exceeds its JSON unit limit.");
  }
  return issue("$", "cache-serialization-failed", "Envelope must be bounded JSON data.");
}

function seedMetadata(serialized: string): { capturedAt: number; expiresAt: number } {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.freshness)) return { capturedAt: 0, expiresAt: Number.POSITIVE_INFINITY };
    const capturedAt = parsed.freshness.capturedAt;
    const expiresAt = parsed.freshness.expiresAt;
    return {
      capturedAt: typeof capturedAt === "number" && Number.isFinite(capturedAt) ? capturedAt : 0,
      expiresAt: typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : Number.POSITIVE_INFINITY,
    };
  } catch {
    return { capturedAt: 0, expiresAt: Number.POSITIVE_INFINITY };
  }
}

export class SyntheticMemorySnapshotCache<T> {
  readonly #entries = new Map<string, StoredSyntheticEntry>();
  readonly #validatePayload: (payload: unknown) => ValidationResult<T>;
  readonly #retention: CacheRetentionPolicy;
  readonly #now: () => number;
  #serializedBytes = 0;
  #accountedBytes = 0;

  constructor(options: SyntheticMemorySnapshotCacheOptions<T>) {
    this.#validatePayload = options.validatePayload;
    this.#retention = retentionPolicy(options.retention);
    this.#now = options.now ?? Date.now;
    for (const [key, serialized] of options.seedEntries ?? []) this.#seed(key, serialized);
    this.#enforceAggregatePolicy();
  }

  get size(): number {
    return this.#entries.size;
  }

  get usage(): SyntheticCacheUsage {
    return Object.freeze({
      entryCount: this.#entries.size,
      serializedBytes: this.#serializedBytes,
      accountedBytes: this.#accountedBytes,
    });
  }

  get retentionPolicy(): CacheRetentionPolicy {
    return this.#retention;
  }

  #seed(key: string, serialized: string): void {
    if (typeof key !== "string" || typeof serialized !== "string") return;
    const serializedBytes = utf8ByteLength(serialized);
    let accountedBytes: number;
    try {
      accountedBytes = accountedResidentBytes(serialized, this.#retention.decodedCopyCount);
    } catch {
      return;
    }
    if (
      serializedBytes > this.#retention.maxEntrySerializedBytes ||
      accountedBytes > this.#retention.maxEntryAccountedBytes
    ) return;
    const metadata = seedMetadata(serialized);
    const previous = this.#entries.get(key);
    if (previous) this.#subtract(previous);
    const stored: StoredSyntheticEntry = { serialized, serializedBytes, accountedBytes, ...metadata };
    this.#entries.set(key, stored);
    this.#add(stored);
  }

  #add(entry: StoredSyntheticEntry): void {
    this.#serializedBytes += entry.serializedBytes;
    this.#accountedBytes += entry.accountedBytes;
  }

  #subtract(entry: StoredSyntheticEntry): void {
    this.#serializedBytes -= entry.serializedBytes;
    this.#accountedBytes -= entry.accountedBytes;
  }

  #deleteSerializedKey(key: string): boolean {
    const existing = this.#entries.get(key);
    if (!existing) return false;
    this.#entries.delete(key);
    this.#subtract(existing);
    return true;
  }

  #orderedEntries(excluding: string | null = null): Array<{ key: string; value: StoredSyntheticEntry }> {
    return [...this.#entries]
      .filter(([key]) => key !== excluding)
      .map(([key, value]) => ({ key, value }))
      .sort((left, right) => left.value.capturedAt - right.value.capturedAt || left.key.localeCompare(right.key));
  }

  #enforceAggregatePolicy(): number {
    let deleted = 0;
    for (const candidate of this.#orderedEntries()) {
      if (
        this.#entries.size <= this.#retention.maxEntries &&
        this.#serializedBytes <= this.#retention.maxTotalSerializedBytes &&
        this.#accountedBytes <= this.#retention.maxTotalAccountedBytes
      ) break;
      if (this.#deleteSerializedKey(candidate.key)) deleted += 1;
    }
    return deleted;
  }

  put(envelope: unknown): ValidationResult<SnapshotCacheEnvelope<T>> {
    let parsed: ValidationResult<SnapshotCacheEnvelope<T>>;
    try {
      parsed = validateEnvelope(envelope, this.#validatePayload);
    } catch {
      return {
        ok: false,
        issues: [issue("$", "cache-envelope-inspection-failed", "Envelope inspection failed safely.")],
      };
    }
    if (!parsed.ok) return parsed;

    const serializedResult = serializeBoundedJson(parsed.value, {
      maxDepth: 128,
      maxNodes: this.#retention.maxJsonNodes,
      maxStringCodeUnits: this.#retention.maxJsonStringCodeUnits,
      maxSerializedBytes: this.#retention.maxEntrySerializedBytes,
    });
    if (!serializedResult.ok) {
      return { ok: false, issues: [cacheSerializationIssue(serializedResult.issues[0]?.code ?? "unknown")] };
    }

    let accountedBytes: number;
    try {
      accountedBytes = accountedResidentBytes(
        serializedResult.value.serialized,
        this.#retention.decodedCopyCount,
      );
    } catch {
      return { ok: false, issues: [issue("$", "cache-entry-accounting-failed", "Cache entry accounting failed safely.")] };
    }
    if (accountedBytes > this.#retention.maxEntryAccountedBytes) {
      return {
        ok: false,
        issues: [issue("$", "cache-entry-accounted-byte-limit", "Cache entry exceeds its retained-memory limit.")],
      };
    }

    const now = this.#now();
    this.prune(now);
    const serializedKey = serializeCacheIsolationKey(parsed.value.key);
    const previous = this.#entries.get(serializedKey);
    let futureCount = this.#entries.size - (previous ? 1 : 0) + 1;
    let futureSerialized = this.#serializedBytes - (previous?.serializedBytes ?? 0) + serializedResult.value.usage.serializedBytes;
    let futureAccounted = this.#accountedBytes - (previous?.accountedBytes ?? 0) + accountedBytes;
    const evictionKeys: string[] = [];

    const requiredCountEvictions = Math.max(0, futureCount - this.#retention.maxEntries);
    for (const candidate of this.#orderedEntries(serializedKey).slice(0, requiredCountEvictions)) {
      evictionKeys.push(candidate.key);
      futureCount -= 1;
      futureSerialized -= candidate.value.serializedBytes;
      futureAccounted -= candidate.value.accountedBytes;
    }

    if (futureSerialized > this.#retention.maxTotalSerializedBytes) {
      return {
        ok: false,
        issues: [issue("$", "cache-aggregate-serialized-byte-limit", "Cache admission exceeds the aggregate serialized-byte policy.")],
      };
    }
    if (futureAccounted > this.#retention.maxTotalAccountedBytes) {
      return {
        ok: false,
        issues: [issue("$", "cache-aggregate-accounted-byte-limit", "Cache admission exceeds the aggregate retained-memory policy.")],
      };
    }
    if (futureCount > this.#retention.maxEntries) {
      return {
        ok: false,
        issues: [issue("$", "cache-entry-count-limit", "Cache admission exceeds the entry-count policy.")],
      };
    }

    for (const key of evictionKeys) this.#deleteSerializedKey(key);
    if (previous) this.#deleteSerializedKey(serializedKey);
    const stored: StoredSyntheticEntry = {
      serialized: serializedResult.value.serialized,
      serializedBytes: serializedResult.value.usage.serializedBytes,
      accountedBytes,
      capturedAt: parsed.value.freshness.capturedAt,
      expiresAt: parsed.value.freshness.expiresAt,
    };
    this.#entries.set(serializedKey, stored);
    this.#add(stored);

    let normalized: SnapshotCacheEnvelope<T>;
    try {
      normalized = JSON.parse(stored.serialized) as SnapshotCacheEnvelope<T>;
    } catch {
      this.#deleteSerializedKey(serializedKey);
      return { ok: false, issues: [issue("$", "cache-serialization-failed", "Envelope serialization failed safely.")] };
    }
    return { ok: true, value: normalized, warnings: parsed.warnings };
  }

  get(key: CacheIsolationKey, context: CacheLookupContext): CacheReadResult<T> {
    const keyResult = validateCacheIsolationKey(key);
    if (!keyResult.ok) return { status: "miss", reason: "corrupt" };
    const serializedKey = serializeCacheIsolationKey(keyResult.value);
    const stored = this.#entries.get(serializedKey);
    if (!stored) return { status: "miss", reason: "missing" };

    let decoded: unknown;
    try {
      decoded = JSON.parse(stored.serialized);
    } catch {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "corrupt" };
    }

    let parsed: ValidationResult<SnapshotCacheEnvelope<T>>;
    try {
      parsed = validateEnvelope(decoded, this.#validatePayload);
    } catch {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "corrupt" };
    }
    if (!parsed.ok) {
      const reason = parsed.issues.some((value) => value.code === "unsupported-envelope-version")
        ? "unsupported-envelope-version"
        : "corrupt";
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason };
    }

    const value = parsed.value;
    if (!sameIsolationKey(value.key, keyResult.value)) {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "corrupt" };
    }
    const compatibility = assessAdapterVersionCompatibility(value.adapter, context.adapter);
    if (!compatibility.compatible) {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: compatibility.reason };
    }
    if (value.structural.fingerprintHash !== context.structuralFingerprintHash) {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "schema-drift" };
    }
    if (context.expectedContent && !sameContentIdentity(value.content, context.expectedContent)) {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "content-identity-mismatch" };
    }
    const freshness = resolveFreshnessState(value.freshness, context.now ?? this.#now());
    if (freshness === "expired") {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "expired" };
    }
    try {
      return { status: "hit", freshness, envelope: structuredClone(value) };
    } catch {
      this.#deleteSerializedKey(serializedKey);
      return { status: "miss", reason: "corrupt" };
    }
  }

  delete(key: CacheIsolationKey): boolean {
    const keyResult = validateCacheIsolationKey(key);
    return keyResult.ok && this.#deleteSerializedKey(serializeCacheIsolationKey(keyResult.value));
  }

  invalidate(scope: CacheInvalidationScope): number {
    let deleted = 0;
    for (const [serializedKey, stored] of [...this.#entries]) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(stored.serialized);
      } catch {
        if (this.#deleteSerializedKey(serializedKey)) deleted += 1;
        continue;
      }
      if (!isRecord(decoded)) continue;
      const keyResult = validateCacheIsolationKey(decoded.key);
      if (!keyResult.ok) {
        if (this.#deleteSerializedKey(serializedKey)) deleted += 1;
        continue;
      }
      const matches = (Object.keys(scope) as Array<keyof CacheIsolationKey>).every(
        (field) => scope[field] === undefined || keyResult.value[field] === scope[field],
      );
      if (matches && this.#deleteSerializedKey(serializedKey)) deleted += 1;
    }
    return deleted;
  }

  clear(): number {
    const deleted = this.#entries.size;
    this.#entries.clear();
    this.#serializedBytes = 0;
    this.#accountedBytes = 0;
    return deleted;
  }

  prune(now = this.#now()): number {
    let deleted = 0;
    for (const [key, stored] of [...this.#entries]) {
      if (
        now - stored.capturedAt > this.#retention.maxAgeMs ||
        now >= stored.expiresAt
      ) {
        if (this.#deleteSerializedKey(key)) deleted += 1;
      }
    }
    return deleted + this.#enforceAggregatePolicy();
  }

  dumpSyntheticEntries(): Array<[string, string]> {
    return [...this.#entries.entries()].map(([key, value]) => [key, value.serialized]);
  }
}
