// SPDX-License-Identifier: MPL-2.0

export const LANE_GOVERNOR_VERSION = 1 as const;
export const MAX_LANE_ID_LENGTH = 128;
export const MAX_LEASE_ID_LENGTH = 128;
export const DEFAULT_MIN_IDLE_MS = 5 * 60_000;
export const DEFAULT_MAX_ACTIVE_LEASES = 64;
export const DEFAULT_MAX_LEASE_TTL_MS = 15 * 60_000;

const MAX_POLICY_IDLE_MS = 30 * 24 * 60 * 60_000;
const MAX_LEASE_COUNT = 256;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type LaneDiscardSafety = "yes" | "no" | "unknown";

export interface LaneLifecycle {
  laneId: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  frozen: boolean | null;
  autoDiscardable: boolean;
  lastAccessedMs: number;
}

export interface LaneSignals {
  generating: boolean | null;
  unsaved: boolean | null;
  needsAttention: boolean;
  safeToDiscard: LaneDiscardSafety;
}

export interface LaneGovernorPolicy {
  minIdleMs: number;
}

export const DEFAULT_LANE_GOVERNOR_POLICY: Readonly<LaneGovernorPolicy> = Object.freeze({
  minIdleMs: DEFAULT_MIN_IDLE_MS,
});

export type LaneDecisionAction =
  | "keep-resident"
  | "protect-from-discard"
  | "discard-candidate"
  | "wake-candidate"
  | "observe-only";

export type LaneDecisionReason =
  | "active-lane"
  | "attention-required"
  | "discarded-needs-attention"
  | "discarded-protected-signal"
  | "already-discarded"
  | "pinned-lane"
  | "audible-lane"
  | "generation-active"
  | "unsaved-state"
  | "explicitly-unsafe"
  | "unknown-discard-safety"
  | "browser-discard-protected"
  | "future-last-access"
  | "recently-accessed"
  | "idle-and-safe";

export interface LaneDecision {
  action: LaneDecisionAction;
  reason: LaneDecisionReason;
  idleMs: number | null;
}

function expectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return input as Record<string, unknown>;
}

function expectExactOwnKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  const actualKeys = Reflect.ownKeys(record);
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key) => typeof key !== "string" || !expectedSet.has(key))
  ) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function ownData(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`Expected own data property: ${key}`);
  }
  return descriptor.value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be boolean`);
  }
  return value;
}

function expectNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  return expectBoolean(value, label);
}

function expectSafeInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a bounded safe integer`);
  }
  return value;
}

function expectToken(value: unknown, label: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    !TOKEN_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded token`);
  }
  return value;
}

function expectDiscardSafety(value: unknown): LaneDiscardSafety {
  if (value === "yes" || value === "no" || value === "unknown") return value;
  throw new TypeError("safeToDiscard must be yes, no, or unknown");
}

export function parseLaneLifecycle(input: unknown): LaneLifecycle {
  const record = expectRecord(input, "LaneLifecycle");
  expectExactOwnKeys(
    record,
    ["laneId", "active", "pinned", "audible", "discarded", "frozen", "autoDiscardable", "lastAccessedMs"],
    "LaneLifecycle",
  );

  return Object.freeze({
    laneId: expectToken(ownData(record, "laneId"), "laneId", MAX_LANE_ID_LENGTH),
    active: expectBoolean(ownData(record, "active"), "active"),
    pinned: expectBoolean(ownData(record, "pinned"), "pinned"),
    audible: expectBoolean(ownData(record, "audible"), "audible"),
    discarded: expectBoolean(ownData(record, "discarded"), "discarded"),
    frozen: expectNullableBoolean(ownData(record, "frozen"), "frozen"),
    autoDiscardable: expectBoolean(ownData(record, "autoDiscardable"), "autoDiscardable"),
    lastAccessedMs: expectSafeInteger(ownData(record, "lastAccessedMs"), "lastAccessedMs"),
  });
}

export function parseLaneSignals(input: unknown): LaneSignals {
  const record = expectRecord(input, "LaneSignals");
  expectExactOwnKeys(record, ["generating", "unsaved", "needsAttention", "safeToDiscard"], "LaneSignals");

  return Object.freeze({
    generating: expectNullableBoolean(ownData(record, "generating"), "generating"),
    unsaved: expectNullableBoolean(ownData(record, "unsaved"), "unsaved"),
    needsAttention: expectBoolean(ownData(record, "needsAttention"), "needsAttention"),
    safeToDiscard: expectDiscardSafety(ownData(record, "safeToDiscard")),
  });
}

export function parseLaneGovernorPolicy(input: unknown): LaneGovernorPolicy {
  const record = expectRecord(input, "LaneGovernorPolicy");
  expectExactOwnKeys(record, ["minIdleMs"], "LaneGovernorPolicy");
  return Object.freeze({
    minIdleMs: expectSafeInteger(ownData(record, "minIdleMs"), "minIdleMs", 0, MAX_POLICY_IDLE_MS),
  });
}

function decision(action: LaneDecisionAction, reason: LaneDecisionReason, idleMs: number | null): LaneDecision {
  return Object.freeze({ action, reason, idleMs });
}

export function evaluateLane(
  lifecycleInput: LaneLifecycle,
  signalsInput: LaneSignals,
  nowMsInput: number,
  policyInput: LaneGovernorPolicy = DEFAULT_LANE_GOVERNOR_POLICY,
): LaneDecision {
  const lifecycle = parseLaneLifecycle(lifecycleInput);
  const signals = parseLaneSignals(signalsInput);
  const nowMs = expectSafeInteger(nowMsInput, "nowMs");
  const policy = parseLaneGovernorPolicy(policyInput);
  const idleMs = lifecycle.lastAccessedMs <= nowMs ? nowMs - lifecycle.lastAccessedMs : null;

  if (lifecycle.discarded) {
    if (signals.needsAttention) {
      return decision("wake-candidate", "discarded-needs-attention", idleMs);
    }
    if (signals.generating === true || signals.unsaved === true || signals.safeToDiscard === "no") {
      return decision("wake-candidate", "discarded-protected-signal", idleMs);
    }
    return decision("observe-only", "already-discarded", idleMs);
  }

  if (lifecycle.active) return decision("keep-resident", "active-lane", idleMs);
  if (signals.needsAttention) return decision("keep-resident", "attention-required", idleMs);
  if (lifecycle.pinned) return decision("protect-from-discard", "pinned-lane", idleMs);
  if (lifecycle.audible) return decision("protect-from-discard", "audible-lane", idleMs);
  if (signals.generating === true) return decision("protect-from-discard", "generation-active", idleMs);
  if (signals.unsaved === true) return decision("protect-from-discard", "unsaved-state", idleMs);
  if (signals.safeToDiscard === "no") return decision("protect-from-discard", "explicitly-unsafe", idleMs);
  if (signals.safeToDiscard === "unknown") {
    return decision("protect-from-discard", "unknown-discard-safety", idleMs);
  }
  if (!lifecycle.autoDiscardable) {
    return decision("protect-from-discard", "browser-discard-protected", idleMs);
  }
  if (idleMs === null) return decision("protect-from-discard", "future-last-access", null);
  if (idleMs < policy.minIdleMs) return decision("keep-resident", "recently-accessed", idleMs);
  return decision("discard-candidate", "idle-and-safe", idleMs);
}

export type LaneLeaseOwner = "human" | "agent";

export interface LaneLease {
  laneId: string;
  leaseId: string;
  owner: LaneLeaseOwner;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface LaneLeaseRequest {
  laneId: string;
  leaseId: string;
  owner: LaneLeaseOwner;
  ttlMs: number;
}

export type LaneLeaseStatus = "acquired" | "preempted" | "denied" | "revoked" | "observed";

export type LaneLeaseReason =
  | "lease-acquired"
  | "lease-renewed"
  | "human-preempted-agent"
  | "human-holds-lease"
  | "lease-conflict"
  | "lease-capacity"
  | "human-activity-preempted-agent"
  | "human-lease-retained"
  | "no-lease"
  | "lease-id-mismatch"
  | "lease-revoked";

export interface LaneLeaseResult {
  status: LaneLeaseStatus;
  reason: LaneLeaseReason;
  lease: LaneLease | null;
}

export interface LaneLeaseLedgerOptions {
  maxActiveLeases?: number;
  maxLeaseTtlMs?: number;
}

function expectLeaseOwner(value: unknown): LaneLeaseOwner {
  if (value === "human" || value === "agent") return value;
  throw new TypeError("owner must be human or agent");
}

function parseLeaseRequest(input: LaneLeaseRequest, maxLeaseTtlMs: number): LaneLeaseRequest {
  const record = expectRecord(input, "LaneLeaseRequest");
  expectExactOwnKeys(record, ["laneId", "leaseId", "owner", "ttlMs"], "LaneLeaseRequest");
  return Object.freeze({
    laneId: expectToken(ownData(record, "laneId"), "laneId", MAX_LANE_ID_LENGTH),
    leaseId: expectToken(ownData(record, "leaseId"), "leaseId", MAX_LEASE_ID_LENGTH),
    owner: expectLeaseOwner(ownData(record, "owner")),
    ttlMs: expectSafeInteger(ownData(record, "ttlMs"), "ttlMs", 1, maxLeaseTtlMs),
  });
}

function leaseResult(status: LaneLeaseStatus, reason: LaneLeaseReason, lease: LaneLease | null): LaneLeaseResult {
  return Object.freeze({ status, reason, lease });
}

function createLease(request: LaneLeaseRequest, nowMs: number, issuedAtMs = nowMs): LaneLease {
  return Object.freeze({
    laneId: request.laneId,
    leaseId: request.leaseId,
    owner: request.owner,
    issuedAtMs,
    expiresAtMs: nowMs + request.ttlMs,
  });
}

export class LaneLeaseLedger {
  readonly maxActiveLeases: number;
  readonly maxLeaseTtlMs: number;
  #leases = new Map<string, LaneLease>();

  constructor(options: LaneLeaseLedgerOptions = {}) {
    this.maxActiveLeases = expectSafeInteger(
      options.maxActiveLeases ?? DEFAULT_MAX_ACTIVE_LEASES,
      "maxActiveLeases",
      1,
      MAX_LEASE_COUNT,
    );
    this.maxLeaseTtlMs = expectSafeInteger(
      options.maxLeaseTtlMs ?? DEFAULT_MAX_LEASE_TTL_MS,
      "maxLeaseTtlMs",
      1,
      MAX_POLICY_IDLE_MS,
    );
  }

  get size(): number {
    return this.#leases.size;
  }

  acquire(requestInput: LaneLeaseRequest, nowMsInput: number): LaneLeaseResult {
    const nowMs = expectSafeInteger(nowMsInput, "nowMs");
    this.#pruneExpired(nowMs);
    const request = parseLeaseRequest(requestInput, this.maxLeaseTtlMs);
    const current = this.#leases.get(request.laneId);

    if (current === undefined) {
      if (this.#leases.size >= this.maxActiveLeases) {
        return leaseResult("denied", "lease-capacity", null);
      }
      const lease = createLease(request, nowMs);
      this.#leases.set(request.laneId, lease);
      return leaseResult("acquired", "lease-acquired", lease);
    }

    if (request.owner === "human" && current.owner === "agent") {
      const lease = createLease(request, nowMs);
      this.#leases.set(request.laneId, lease);
      return leaseResult("preempted", "human-preempted-agent", lease);
    }

    if (request.owner === "agent" && current.owner === "human") {
      return leaseResult("denied", "human-holds-lease", current);
    }

    if (request.owner === current.owner && request.leaseId === current.leaseId) {
      const lease = createLease(request, nowMs, current.issuedAtMs);
      this.#leases.set(request.laneId, lease);
      return leaseResult("acquired", "lease-renewed", lease);
    }

    return leaseResult("denied", "lease-conflict", current);
  }

  humanActivity(laneIdInput: string, nowMsInput: number): LaneLeaseResult {
    const laneId = expectToken(laneIdInput, "laneId", MAX_LANE_ID_LENGTH);
    const nowMs = expectSafeInteger(nowMsInput, "nowMs");
    this.#pruneExpired(nowMs);
    const current = this.#leases.get(laneId);

    if (current === undefined) return leaseResult("observed", "no-lease", null);
    if (current.owner === "agent") {
      this.#leases.delete(laneId);
      return leaseResult("preempted", "human-activity-preempted-agent", null);
    }
    return leaseResult("observed", "human-lease-retained", current);
  }

  revoke(laneIdInput: string, leaseIdInput: string | null, nowMsInput: number): LaneLeaseResult {
    const laneId = expectToken(laneIdInput, "laneId", MAX_LANE_ID_LENGTH);
    const leaseId = leaseIdInput === null ? null : expectToken(leaseIdInput, "leaseId", MAX_LEASE_ID_LENGTH);
    const nowMs = expectSafeInteger(nowMsInput, "nowMs");
    this.#pruneExpired(nowMs);
    const current = this.#leases.get(laneId);

    if (current === undefined) return leaseResult("observed", "no-lease", null);
    if (leaseId !== null && current.leaseId !== leaseId) {
      return leaseResult("denied", "lease-id-mismatch", current);
    }
    this.#leases.delete(laneId);
    return leaseResult("revoked", "lease-revoked", null);
  }

  snapshot(laneIdInput: string, nowMsInput: number): LaneLease | null {
    const laneId = expectToken(laneIdInput, "laneId", MAX_LANE_ID_LENGTH);
    const nowMs = expectSafeInteger(nowMsInput, "nowMs");
    this.#pruneExpired(nowMs);
    return this.#leases.get(laneId) ?? null;
  }

  clear(): void {
    this.#leases.clear();
  }

  #pruneExpired(nowMs: number): void {
    for (const [laneId, lease] of this.#leases) {
      if (lease.expiresAtMs <= nowMs) this.#leases.delete(laneId);
    }
  }
}
