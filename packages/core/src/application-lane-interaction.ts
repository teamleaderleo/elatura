// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "./application-lane.js";

export const APPLICATION_LANE_INTERACTION_VERSION = 1 as const;
export const DEFAULT_MAX_ACTIVE_INTERACTION_LEASES = 64;
export const DEFAULT_MAX_TRACKED_INTERACTION_LANES = 256;
export const DEFAULT_MAX_INTERACTION_LEASE_TTL_MS = 15 * 60_000;

const MAX_IDENTIFIER = 240;
const MAX_ACTIVE_LEASES_LIMIT = 1_024;
const MAX_TRACKED_LANES_LIMIT = 4_096;
const MAX_TTL_LIMIT_MS = 24 * 60 * 60_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/u;
const unsafeTextPattern = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;
const credentialPattern = /(?:github_pat_|gh[pousr]_|sk-(?:proj-)?|Bearer\s+)[A-Za-z0-9._~+\/-]+/iu;

export const applicationLaneInteractionOwners = ["human", "agent"] as const;
export type ApplicationLaneInteractionOwner = (typeof applicationLaneInteractionOwners)[number];

export type ApplicationLaneInteractionRequestV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_VERSION;
  laneRef: string;
  laneGeneration: number;
  leaseRef: string;
  owner: ApplicationLaneInteractionOwner;
  ttlMs: number;
}>;

export type ApplicationLaneInteractionLeaseV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_VERSION;
  laneRef: string;
  laneGeneration: number;
  leaseRef: string;
  owner: ApplicationLaneInteractionOwner;
  issuedAtMs: number;
  expiresAtMs: number;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export const applicationLaneInteractionStatuses = [
  "acquired",
  "preempted",
  "denied",
  "revoked",
  "observed",
] as const;
export type ApplicationLaneInteractionStatus = (typeof applicationLaneInteractionStatuses)[number];

export const applicationLaneInteractionReasons = [
  "lease_acquired",
  "lease_renewed",
  "human_preempted_agent",
  "human_holds_lease",
  "lease_conflict",
  "lease_capacity",
  "lane_capacity",
  "human_activity_preempted_agent",
  "human_lease_retained",
  "lease_current",
  "no_lease",
  "lease_ref_mismatch",
  "lease_revoked",
  "lane_mismatch",
  "stale_generation",
  "generation_mismatch",
] as const;
export type ApplicationLaneInteractionReason = (typeof applicationLaneInteractionReasons)[number];

export type ApplicationLaneInteractionResultV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_VERSION;
  status: ApplicationLaneInteractionStatus;
  reason: ApplicationLaneInteractionReason;
  laneRef: string;
  laneGeneration: number;
  lease: ApplicationLaneInteractionLeaseV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type ApplicationLaneInteractionLedgerOptions = Readonly<{
  maxActiveLeases?: number;
  maxTrackedLanes?: number;
  maxLeaseTtlMs?: number;
}>;

type LaneIdentity = Readonly<{ laneRef: string; generation: number }>;

type ParsedOptions = Readonly<{
  maxActiveLeases: number;
  maxTrackedLanes: number;
  maxLeaseTtlMs: number;
}>;

export function parseApplicationLaneInteractionRequestV1(value: unknown): ApplicationLaneInteractionRequestV1 {
  const input = inspectExactRecord(value, "Application lane interaction request", [
    "version",
    "laneRef",
    "laneGeneration",
    "leaseRef",
    "owner",
    "ttlMs",
  ]);
  version(input.version);
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_VERSION,
    laneRef: identifier(input.laneRef, "Lane reference"),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    leaseRef: identifier(input.leaseRef, "Lease reference"),
    owner: exactOwner(input.owner),
    ttlMs: positiveInteger(input.ttlMs, "Lease TTL"),
  });
}

export function parseApplicationLaneInteractionLeaseV1(value: unknown): ApplicationLaneInteractionLeaseV1 {
  const input = inspectExactRecord(value, "Application lane interaction lease", [
    "version",
    "laneRef",
    "laneGeneration",
    "leaseRef",
    "owner",
    "issuedAtMs",
    "expiresAtMs",
    "grantsWorkAuthority",
    "authorizesWorkDispatch",
  ]);
  version(input.version);
  if (input.grantsWorkAuthority !== false) {
    throw new TypeError("Application lane interaction lease must grant zero work authority");
  }
  if (input.authorizesWorkDispatch !== false) {
    throw new TypeError("Application lane interaction lease must authorize zero work dispatch");
  }
  const issuedAtMs = nonNegativeInteger(input.issuedAtMs, "Lease issue time");
  const expiresAtMs = nonNegativeInteger(input.expiresAtMs, "Lease expiry time");
  if (expiresAtMs <= issuedAtMs) throw new TypeError("Lease expiry must follow lease issue time");
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_VERSION,
    laneRef: identifier(input.laneRef, "Lane reference"),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    leaseRef: identifier(input.leaseRef, "Lease reference"),
    owner: exactOwner(input.owner),
    issuedAtMs,
    expiresAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

export class ApplicationLaneInteractionLedger {
  readonly maxActiveLeases: number;
  readonly maxTrackedLanes: number;
  readonly maxLeaseTtlMs: number;

  #leases = new Map<string, ApplicationLaneInteractionLeaseV1>();
  #generations = new Map<string, number>();

  constructor(options: unknown = {}) {
    const parsed = parseOptions(options);
    this.maxActiveLeases = parsed.maxActiveLeases;
    this.maxTrackedLanes = parsed.maxTrackedLanes;
    this.maxLeaseTtlMs = parsed.maxLeaseTtlMs;
  }

  get activeLeaseCount(): number {
    return this.#leases.size;
  }

  get trackedLaneCount(): number {
    return this.#generations.size;
  }

  acquire(
    descriptorInput: ApplicationLaneDescriptorV1,
    requestInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionResultV1 {
    // Parse every caller-controlled value before touching ledger state. A malformed
    // request must not even trigger expiry cleanup.
    const identity = descriptorIdentity(descriptorInput);
    const request = parseApplicationLaneInteractionRequestV1(requestInput);
    const nowMs = nonNegativeInteger(nowMsInput, "Current time");

    const requestIdentityError = requestIdentityReason(identity, request);
    if (requestIdentityError !== null) {
      return result(identity, "denied", requestIdentityError, null);
    }
    if (request.ttlMs > this.maxLeaseTtlMs || nowMs > Number.MAX_SAFE_INTEGER - request.ttlMs) {
      throw new RangeError("Lease TTL exceeds the configured interaction limit");
    }

    const knownGeneration = this.#generations.get(identity.laneRef);
    if (knownGeneration === undefined) {
      if (this.#generations.size >= this.maxTrackedLanes) {
        return result(identity, "denied", "lane_capacity", null);
      }
      // The request is valid and current. Expiry cleanup may free lease capacity,
      // but a capacity denial must not consume anti-replay generation capacity.
      this.#pruneExpired(nowMs);
      if (this.#leases.size >= this.maxActiveLeases) {
        return result(identity, "denied", "lease_capacity", null);
      }
      this.#generations.set(identity.laneRef, identity.generation);
    } else {
      const generationResult = this.#acceptGeneration(identity);
      if (generationResult !== null) return generationResult;
      this.#pruneExpired(nowMs);
    }

    const current = this.#leases.get(identity.laneRef);
    if (current === undefined) {
      if (this.#leases.size >= this.maxActiveLeases) {
        return result(identity, "denied", "lease_capacity", null);
      }
      const lease = createLease(identity, request, nowMs);
      this.#leases.set(identity.laneRef, lease);
      return result(identity, "acquired", "lease_acquired", lease);
    }

    if (request.owner === "human" && current.owner === "agent") {
      const lease = createLease(identity, request, nowMs);
      this.#leases.set(identity.laneRef, lease);
      return result(identity, "preempted", "human_preempted_agent", lease);
    }

    if (request.owner === "agent" && current.owner === "human") {
      return result(identity, "denied", "human_holds_lease", current);
    }

    // V1 intentionally makes acquire idempotent-renewal for the exact same
    // owner + lease reference. A different reference is a conflict, so a future
    // actuator never silently changes mutation ownership while extending TTL.
    if (request.owner === current.owner && request.leaseRef === current.leaseRef) {
      const lease = createLease(identity, request, nowMs, current.issuedAtMs);
      this.#leases.set(identity.laneRef, lease);
      return result(identity, "acquired", "lease_renewed", lease);
    }

    return result(identity, "denied", "lease_conflict", current);
  }

  humanActivity(
    descriptorInput: ApplicationLaneDescriptorV1,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionResultV1 {
    const identity = descriptorIdentity(descriptorInput);
    const nowMs = nonNegativeInteger(nowMsInput, "Current time");
    const generationResult = this.#acceptGeneration(identity);
    if (generationResult !== null) return generationResult;
    this.#pruneExpired(nowMs);

    const current = this.#leases.get(identity.laneRef);
    if (current === undefined) return result(identity, "observed", "no_lease", null);
    if (current.owner === "agent") {
      this.#leases.delete(identity.laneRef);
      return result(identity, "preempted", "human_activity_preempted_agent", null);
    }
    return result(identity, "observed", "human_lease_retained", current);
  }

  inspect(
    descriptorInput: ApplicationLaneDescriptorV1,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionResultV1 {
    const identity = descriptorIdentity(descriptorInput);
    const nowMs = nonNegativeInteger(nowMsInput, "Current time");
    const generationResult = this.#acceptGeneration(identity);
    if (generationResult !== null) return generationResult;
    this.#pruneExpired(nowMs);
    const current = this.#leases.get(identity.laneRef) ?? null;
    return result(identity, "observed", current === null ? "no_lease" : "lease_current", current);
  }

  revoke(
    descriptorInput: ApplicationLaneDescriptorV1,
    leaseRefInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionResultV1 {
    const identity = descriptorIdentity(descriptorInput);
    const leaseRef = identifier(leaseRefInput, "Lease reference");
    const nowMs = nonNegativeInteger(nowMsInput, "Current time");
    const generationResult = this.#acceptGeneration(identity);
    if (generationResult !== null) return generationResult;
    this.#pruneExpired(nowMs);

    const current = this.#leases.get(identity.laneRef);
    if (current === undefined) return result(identity, "observed", "no_lease", null);
    if (current.leaseRef !== leaseRef) {
      return result(identity, "denied", "lease_ref_mismatch", current);
    }
    this.#leases.delete(identity.laneRef);
    return result(identity, "revoked", "lease_revoked", null);
  }

  /**
   * Clear all volatile interaction state at a canonical session/runtime reset.
   * This also erases stale-generation replay memory and is therefore not an
   * ordinary per-lane cleanup primitive.
   */
  resetSession(): void {
    this.#leases.clear();
    this.#generations.clear();
  }

  clear(): void {
    this.resetSession();
  }

  #acceptGeneration(identity: LaneIdentity): ApplicationLaneInteractionResultV1 | null {
    const known = this.#generations.get(identity.laneRef);
    if (known === undefined) {
      if (this.#generations.size >= this.maxTrackedLanes) {
        return result(identity, "denied", "lane_capacity", null);
      }
      this.#generations.set(identity.laneRef, identity.generation);
      return null;
    }
    if (identity.generation < known) {
      return result(identity, "denied", "stale_generation", null);
    }
    if (identity.generation > known) {
      this.#generations.set(identity.laneRef, identity.generation);
      this.#leases.delete(identity.laneRef);
    }
    return null;
  }

  #pruneExpired(nowMs: number): void {
    for (const [laneRef, lease] of this.#leases) {
      if (lease.expiresAtMs <= nowMs) this.#leases.delete(laneRef);
    }
  }
}

function createLease(
  identity: LaneIdentity,
  request: ApplicationLaneInteractionRequestV1,
  nowMs: number,
  issuedAtMs = nowMs,
): ApplicationLaneInteractionLeaseV1 {
  if (issuedAtMs > nowMs) {
    throw new RangeError("Lease renewal time precedes the original lease issue time");
  }
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_VERSION,
    laneRef: identity.laneRef,
    laneGeneration: identity.generation,
    leaseRef: request.leaseRef,
    owner: request.owner,
    issuedAtMs,
    expiresAtMs: nowMs + request.ttlMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function result(
  identity: LaneIdentity,
  status: ApplicationLaneInteractionStatus,
  reason: ApplicationLaneInteractionReason,
  lease: ApplicationLaneInteractionLeaseV1 | null,
): ApplicationLaneInteractionResultV1 {
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_VERSION,
    status,
    reason,
    laneRef: identity.laneRef,
    laneGeneration: identity.generation,
    lease,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function requestIdentityReason(
  identity: LaneIdentity,
  request: ApplicationLaneInteractionRequestV1,
): "lane_mismatch" | "stale_generation" | "generation_mismatch" | null {
  if (request.laneRef !== identity.laneRef) return "lane_mismatch";
  if (request.laneGeneration < identity.generation) return "stale_generation";
  if (request.laneGeneration > identity.generation) return "generation_mismatch";
  return null;
}

function descriptorIdentity(value: unknown): LaneIdentity {
  const record = inspectRecord(value, "Application lane descriptor");
  return Object.freeze({
    laneRef: identifier(ownData(record, "laneRef", "Application lane descriptor"), "Lane reference"),
    generation: positiveInteger(ownData(record, "generation", "Application lane descriptor"), "Lane generation"),
  });
}

function parseOptions(value: unknown): ParsedOptions {
  const input = inspectExactRecord(value, "Application lane interaction ledger options", [
    "maxActiveLeases",
    "maxTrackedLanes",
    "maxLeaseTtlMs",
  ], true);
  const maxActiveLeases = optionalPositiveInteger(
    input.maxActiveLeases,
    "Maximum active interaction leases",
    DEFAULT_MAX_ACTIVE_INTERACTION_LEASES,
    MAX_ACTIVE_LEASES_LIMIT,
  );
  const maxTrackedLanes = optionalPositiveInteger(
    input.maxTrackedLanes,
    "Maximum tracked interaction lanes",
    DEFAULT_MAX_TRACKED_INTERACTION_LANES,
    MAX_TRACKED_LANES_LIMIT,
  );
  const maxLeaseTtlMs = optionalPositiveInteger(
    input.maxLeaseTtlMs,
    "Maximum interaction lease TTL",
    DEFAULT_MAX_INTERACTION_LEASE_TTL_MS,
    MAX_TTL_LIMIT_MS,
  );
  if (maxTrackedLanes < maxActiveLeases) {
    throw new RangeError("Tracked interaction lane capacity must cover active lease capacity");
  }
  return Object.freeze({ maxActiveLeases, maxTrackedLanes, maxLeaseTtlMs });
}

function inspectExactRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
  optionalKeys = false,
): Record<string, unknown> {
  const record = inspectRecord(value, label);
  const actualKeys = safeOwnKeys(record, label);
  const allowed = new Set(keys);
  if (actualKeys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
  if (!optionalKeys && keys.some((key) => !actualKeys.includes(key))) {
    throw new TypeError(`${label} is missing required fields`);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (!actualKeys.includes(key)) continue;
    output[key] = ownData(record, key, label);
  }
  return output;
}

function inspectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  let isArray: boolean;
  let prototype: object | null;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new TypeError(`${label} inspection failed`);
  }
  if (isArray) throw new TypeError(`${label} must be an object`);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function safeOwnKeys(record: Record<string, unknown>, label: string): string[] {
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(record);
  } catch {
    throw new TypeError(`${label} inspection failed`);
  }
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} contains symbol decoration`);
  }
  return keys as string[];
}

function ownData(record: Record<string, unknown>, key: string, label: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new TypeError(`${label} inspection failed`);
  }
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label} must contain enumerable data properties`);
  }
  return descriptor.value;
}

function version(value: unknown): void {
  if (value !== APPLICATION_LANE_INTERACTION_VERSION) {
    throw new TypeError(`Application lane interaction version must be ${APPLICATION_LANE_INTERACTION_VERSION}`);
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  const text = value.trim();
  if (text.length < 1 || text.length > MAX_IDENTIFIER || !IDENTIFIER.test(text)) {
    throw new TypeError(`${label} is invalid`);
  }
  if (unsafeTextPattern.test(text) || credentialPattern.test(text)) {
    throw new TypeError(`${label} contains unsafe text`);
  }
  return text;
}

function exactOwner(value: unknown): ApplicationLaneInteractionOwner {
  if (value !== "human" && value !== "agent") throw new TypeError("Interaction lease owner is invalid");
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  label: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = positiveInteger(value, label);
  if (parsed > maximum) throw new RangeError(`${label} exceeds ${maximum}`);
  return parsed;
}
