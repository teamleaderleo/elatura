// SPDX-License-Identifier: MPL-2.0

export const COMPLETION_HINT_PROTOCOL_VERSION = 1 as const;

export type CompletionHintConfidence = "exact" | "probable" | "unknown";
export type CompletionHintKind = "posted" | "removed" | "ranking-changed";

export type CompletionHint = Readonly<{
  protocolVersion: typeof COMPLETION_HINT_PROTOCOL_VERSION;
  sourcePackage: string;
  observedAt: number;
  postedAt: number;
  notificationKeyHash: string;
  titleToken: string | null;
  textToken: string | null;
  category: string | null;
  groupKeyHash: string | null;
  isOngoing: boolean;
  kind: CompletionHintKind;
  confidence: CompletionHintConfidence;
}>;

export type CompletionHintEnvelope = Readonly<{
  protocolVersion: typeof COMPLETION_HINT_PROTOCOL_VERSION;
  deviceId: string;
  sequence: number;
  issuedAt: number;
  expiresAt: number;
  hint: CompletionHint;
}>;

export type CompletionHintPolicy = Readonly<{
  allowedPackages: readonly string[];
  maxQueueEntries: number;
  maxSequenceGap: number;
  maxPastAgeMs: number;
  maxFutureSkewMs: number;
  maxEnvelopeLifetimeMs: number;
  maxTokenLength: number;
  maxCategoryLength: number;
}>;

export type CompletionHintCounters = Readonly<{
  accepted: number;
  duplicates: number;
  stale: number;
  expired: number;
  rejected: number;
  evicted: number;
  replayed: number;
  sequenceGapRejected: number;
}>;

export type CompletionHintAdmission =
  | Readonly<{ status: "accepted"; hint: CompletionHint; evicted: number }>
  | Readonly<{ status: "duplicate" | "stale" | "expired" | "replayed"; reason: string }>
  | Readonly<{ status: "rejected"; reason: string }>;

const DEFAULT_POLICY: CompletionHintPolicy = Object.freeze({
  allowedPackages: Object.freeze(["com.openai.chatgpt"]),
  maxQueueEntries: 128,
  maxSequenceGap: 1_024,
  maxPastAgeMs: 24 * 60 * 60 * 1_000,
  maxFutureSkewMs: 5 * 60 * 1_000,
  maxEnvelopeLifetimeMs: 10 * 60 * 1_000,
  maxTokenLength: 256,
  maxCategoryLength: 128,
});

const HASH_PATTERN = /^[a-z0-9][a-z0-9._:-]{15,255}$/;
const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const DEVICE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function ownData(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`Expected own data property: ${key}`);
  }
  return descriptor.value;
}

function finiteInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${name} is outside the admitted range.`);
  }
  return value as number;
}

function boundedString(value: unknown, maximum: number, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new RangeError(`${name} is outside the admitted range.`);
  }
  return value;
}

function nullableBoundedString(value: unknown, maximum: number, name: string): string | null {
  return value === null ? null : boundedString(value, maximum, name);
}

function parseHash(value: unknown, name: string): string {
  const token = boundedString(value, 256, name);
  if (!HASH_PATTERN.test(token)) {
    throw new TypeError(`${name} is not a valid opaque hash token.`);
  }
  return token;
}

function parsePolicy(input: Partial<CompletionHintPolicy> | undefined): CompletionHintPolicy {
  const source = input ?? {};
  const allowedPackages = source.allowedPackages ?? DEFAULT_POLICY.allowedPackages;
  if (!Array.isArray(allowedPackages) || allowedPackages.length === 0 || allowedPackages.length > 16) {
    throw new RangeError("allowedPackages is outside the admitted range.");
  }
  const uniquePackages = new Set<string>();
  for (const item of allowedPackages) {
    if (typeof item !== "string" || !PACKAGE_PATTERN.test(item) || item.length > 255) {
      throw new TypeError("allowedPackages contains an invalid package name.");
    }
    if (uniquePackages.has(item)) {
      throw new TypeError("allowedPackages contains a duplicate package name.");
    }
    uniquePackages.add(item);
  }

  return Object.freeze({
    allowedPackages: Object.freeze([...uniquePackages]),
    maxQueueEntries: finiteInteger(source.maxQueueEntries ?? DEFAULT_POLICY.maxQueueEntries, 1, 10_000, "maxQueueEntries"),
    maxSequenceGap: finiteInteger(source.maxSequenceGap ?? DEFAULT_POLICY.maxSequenceGap, 1, 1_000_000, "maxSequenceGap"),
    maxPastAgeMs: finiteInteger(source.maxPastAgeMs ?? DEFAULT_POLICY.maxPastAgeMs, 1_000, 30 * 24 * 60 * 60 * 1_000, "maxPastAgeMs"),
    maxFutureSkewMs: finiteInteger(source.maxFutureSkewMs ?? DEFAULT_POLICY.maxFutureSkewMs, 0, 60 * 60 * 1_000, "maxFutureSkewMs"),
    maxEnvelopeLifetimeMs: finiteInteger(
      source.maxEnvelopeLifetimeMs ?? DEFAULT_POLICY.maxEnvelopeLifetimeMs,
      1_000,
      24 * 60 * 60 * 1_000,
      "maxEnvelopeLifetimeMs",
    ),
    maxTokenLength: finiteInteger(source.maxTokenLength ?? DEFAULT_POLICY.maxTokenLength, 1, 4_096, "maxTokenLength"),
    maxCategoryLength: finiteInteger(source.maxCategoryLength ?? DEFAULT_POLICY.maxCategoryLength, 1, 1_024, "maxCategoryLength"),
  });
}

export function parseCompletionHint(input: unknown, policyInput?: Partial<CompletionHintPolicy>): CompletionHint {
  const policy = parsePolicy(policyInput);
  if (!isRecord(input)) {
    throw new TypeError("Completion hint must be an object.");
  }
  const keys = [
    "protocolVersion",
    "sourcePackage",
    "observedAt",
    "postedAt",
    "notificationKeyHash",
    "titleToken",
    "textToken",
    "category",
    "groupKeyHash",
    "isOngoing",
    "kind",
    "confidence",
  ] as const;
  if (!exactKeys(input, keys)) {
    throw new TypeError("Completion hint contains missing or unknown fields.");
  }

  const protocolVersion = ownData(input, "protocolVersion");
  if (protocolVersion !== COMPLETION_HINT_PROTOCOL_VERSION) {
    throw new TypeError("Unsupported completion hint protocol version.");
  }

  const sourcePackage = boundedString(ownData(input, "sourcePackage"), 255, "sourcePackage");
  if (!PACKAGE_PATTERN.test(sourcePackage) || !policy.allowedPackages.includes(sourcePackage)) {
    throw new TypeError("sourcePackage is not admitted by policy.");
  }

  const kind = ownData(input, "kind");
  if (kind !== "posted" && kind !== "removed" && kind !== "ranking-changed") {
    throw new TypeError("Unsupported completion hint kind.");
  }
  const confidence = ownData(input, "confidence");
  if (confidence !== "exact" && confidence !== "probable" && confidence !== "unknown") {
    throw new TypeError("Unsupported completion hint confidence.");
  }
  const isOngoing = ownData(input, "isOngoing");
  if (typeof isOngoing !== "boolean") {
    throw new TypeError("isOngoing must be boolean.");
  }

  return Object.freeze({
    protocolVersion: COMPLETION_HINT_PROTOCOL_VERSION,
    sourcePackage,
    observedAt: finiteInteger(ownData(input, "observedAt"), 0, Number.MAX_SAFE_INTEGER, "observedAt"),
    postedAt: finiteInteger(ownData(input, "postedAt"), 0, Number.MAX_SAFE_INTEGER, "postedAt"),
    notificationKeyHash: parseHash(ownData(input, "notificationKeyHash"), "notificationKeyHash"),
    titleToken: nullableBoundedString(ownData(input, "titleToken"), policy.maxTokenLength, "titleToken"),
    textToken: nullableBoundedString(ownData(input, "textToken"), policy.maxTokenLength, "textToken"),
    category: nullableBoundedString(ownData(input, "category"), policy.maxCategoryLength, "category"),
    groupKeyHash:
      ownData(input, "groupKeyHash") === null ? null : parseHash(ownData(input, "groupKeyHash"), "groupKeyHash"),
    isOngoing,
    kind,
    confidence,
  });
}

export function parseCompletionHintEnvelope(
  input: unknown,
  policyInput?: Partial<CompletionHintPolicy>,
): CompletionHintEnvelope {
  const policy = parsePolicy(policyInput);
  if (!isRecord(input)) {
    throw new TypeError("Completion hint envelope must be an object.");
  }
  const keys = ["protocolVersion", "deviceId", "sequence", "issuedAt", "expiresAt", "hint"] as const;
  if (!exactKeys(input, keys)) {
    throw new TypeError("Completion hint envelope contains missing or unknown fields.");
  }
  if (ownData(input, "protocolVersion") !== COMPLETION_HINT_PROTOCOL_VERSION) {
    throw new TypeError("Unsupported completion hint envelope protocol version.");
  }
  const deviceId = boundedString(ownData(input, "deviceId"), 128, "deviceId");
  if (!DEVICE_PATTERN.test(deviceId)) {
    throw new TypeError("deviceId is not a valid opaque identifier.");
  }
  const issuedAt = finiteInteger(ownData(input, "issuedAt"), 0, Number.MAX_SAFE_INTEGER, "issuedAt");
  const expiresAt = finiteInteger(ownData(input, "expiresAt"), 0, Number.MAX_SAFE_INTEGER, "expiresAt");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > policy.maxEnvelopeLifetimeMs) {
    throw new RangeError("Completion hint envelope lifetime is invalid.");
  }

  return Object.freeze({
    protocolVersion: COMPLETION_HINT_PROTOCOL_VERSION,
    deviceId,
    sequence: finiteInteger(ownData(input, "sequence"), 1, Number.MAX_SAFE_INTEGER, "sequence"),
    issuedAt,
    expiresAt,
    hint: parseCompletionHint(ownData(input, "hint"), policy),
  });
}

function cloneHint(hint: CompletionHint): CompletionHint {
  return Object.freeze({ ...hint });
}

function dedupeKey(hint: CompletionHint): string {
  return `${hint.sourcePackage}\u0000${hint.notificationKeyHash}\u0000${hint.postedAt}\u0000${hint.kind}`;
}

export class BoundedCompletionHintLedger {
  readonly #policy: CompletionHintPolicy;
  readonly #queue: CompletionHint[] = [];
  readonly #dedupe = new Set<string>();
  readonly #lastSequenceByDevice = new Map<string, number>();
  #counters: CompletionHintCounters = Object.freeze({
    accepted: 0,
    duplicates: 0,
    stale: 0,
    expired: 0,
    rejected: 0,
    evicted: 0,
    replayed: 0,
    sequenceGapRejected: 0,
  });

  constructor(policy?: Partial<CompletionHintPolicy>) {
    this.#policy = parsePolicy(policy);
  }

  get size(): number {
    return this.#queue.length;
  }

  get counters(): CompletionHintCounters {
    return this.#counters;
  }

  snapshot(): readonly CompletionHint[] {
    return Object.freeze(this.#queue.map(cloneHint));
  }

  drain(limit = this.#policy.maxQueueEntries): readonly CompletionHint[] {
    const admittedLimit = finiteInteger(limit, 1, this.#policy.maxQueueEntries, "drain limit");
    const drained = this.#queue.splice(0, admittedLimit);
    for (const hint of drained) {
      this.#dedupe.delete(dedupeKey(hint));
    }
    return Object.freeze(drained.map(cloneHint));
  }

  clear(): void {
    this.#queue.length = 0;
    this.#dedupe.clear();
    this.#lastSequenceByDevice.clear();
  }

  admit(input: unknown, now: number): CompletionHintAdmission {
    const admittedNow = finiteInteger(now, 0, Number.MAX_SAFE_INTEGER, "now");
    let envelope: CompletionHintEnvelope;
    try {
      envelope = parseCompletionHintEnvelope(input, this.#policy);
    } catch (error) {
      this.#bump("rejected");
      return { status: "rejected", reason: error instanceof Error ? error.message : "Invalid completion hint envelope." };
    }

    if (envelope.expiresAt <= admittedNow) {
      this.#bump("expired");
      return { status: "expired", reason: "Completion hint envelope expired." };
    }
    if (envelope.issuedAt > admittedNow + this.#policy.maxFutureSkewMs) {
      this.#bump("rejected");
      return { status: "rejected", reason: "Completion hint envelope is too far in the future." };
    }
    if (envelope.hint.observedAt < admittedNow - this.#policy.maxPastAgeMs) {
      this.#bump("stale");
      return { status: "stale", reason: "Completion hint is older than the admitted age." };
    }
    if (envelope.hint.observedAt > admittedNow + this.#policy.maxFutureSkewMs) {
      this.#bump("rejected");
      return { status: "rejected", reason: "Completion hint observation is too far in the future." };
    }

    const previousSequence = this.#lastSequenceByDevice.get(envelope.deviceId);
    if (previousSequence !== undefined) {
      if (envelope.sequence <= previousSequence) {
        this.#bump("replayed");
        return { status: "replayed", reason: "Completion hint sequence was already observed." };
      }
      if (envelope.sequence - previousSequence > this.#policy.maxSequenceGap) {
        this.#bump("sequenceGapRejected");
        return { status: "rejected", reason: "Completion hint sequence gap exceeds policy." };
      }
    }

    const key = dedupeKey(envelope.hint);
    if (this.#dedupe.has(key)) {
      this.#lastSequenceByDevice.set(envelope.deviceId, envelope.sequence);
      this.#bump("duplicates");
      return { status: "duplicate", reason: "Completion hint is already queued." };
    }

    this.#lastSequenceByDevice.set(envelope.deviceId, envelope.sequence);
    const hint = cloneHint(envelope.hint);
    this.#queue.push(hint);
    this.#dedupe.add(key);

    let evicted = 0;
    while (this.#queue.length > this.#policy.maxQueueEntries) {
      const removed = this.#queue.shift();
      if (removed !== undefined) {
        this.#dedupe.delete(dedupeKey(removed));
        evicted += 1;
      }
    }
    this.#bump("accepted");
    if (evicted > 0) {
      this.#bump("evicted", evicted);
    }
    return { status: "accepted", hint, evicted };
  }

  #bump(key: keyof CompletionHintCounters, amount = 1): void {
    this.#counters = Object.freeze({ ...this.#counters, [key]: this.#counters[key] + amount });
  }
}
