// SPDX-License-Identifier: MPL-2.0
import type { ApplicationLaneDescriptorV1 } from "./application-lane.js";

export const APPLICATION_LANE_INTERACTION_LEASE_VERSION = 1 as const;
export const DEFAULT_MAX_APPLICATION_LANE_INTERACTION_LEASES = 64;
export const DEFAULT_MAX_APPLICATION_LANE_INTERACTION_LEASE_TTL_MS = 15 * 60_000;

const MAX_APPLICATION_LANE_INTERACTION_LEASES = 256;
const MAX_APPLICATION_LANE_INTERACTION_LEASE_TTL_MS = 24 * 60 * 60_000;
const MAX_LANE_REF_LENGTH = 240;
const MAX_LEASE_REF_LENGTH = 240;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/u;
const unsafeTextPattern = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;
const credentialPattern = /(?:github_pat_|gh[pousr]_|sk-(?:proj-)?|Bearer\s+)[A-Za-z0-9._~+\/-]+/iu;

export const applicationLaneInteractionLeaseOwners = ["human", "agent"] as const;
export type ApplicationLaneInteractionLeaseOwner =
  (typeof applicationLaneInteractionLeaseOwners)[number];

/** Exact canonical application-lane generation supplied by the current-lane owner. */
export type ApplicationLaneInteractionTargetV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_LEASE_VERSION;
  laneRef: string;
  laneGeneration: number;
}>;

export type ApplicationLaneInteractionLeaseRequestV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_LEASE_VERSION;
  laneRef: string;
  laneGeneration: number;
  leaseRef: string;
  owner: ApplicationLaneInteractionLeaseOwner;
  ttlMs: number;
}>;

export type ApplicationLaneInteractionLeaseRevokeV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_LEASE_VERSION;
  laneRef: string;
  laneGeneration: number;
  leaseRef: string;
}>;

export type ApplicationLaneInteractionLeaseV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_LEASE_VERSION;
  laneRef: string;
  laneGeneration: number;
  leaseRef: string;
  owner: ApplicationLaneInteractionLeaseOwner;
  issuedAtMs: number;
  expiresAtMs: number;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export const applicationLaneInteractionLeaseStatuses = [
  "acquired",
  "renewed",
  "preempted",
  "denied",
  "revoked",
  "observed",
] as const;
export type ApplicationLaneInteractionLeaseStatus =
  (typeof applicationLaneInteractionLeaseStatuses)[number];

export const applicationLaneInteractionLeaseReasons = [
  "lease-acquired",
  "lease-renewed",
  "renew-required",
  "human-preempted-agent",
  "human-holds-lease",
  "lease-conflict",
  "lease-capacity",
  "lane-mismatch",
  "stale-generation",
  "future-generation",
  "generation-advanced",
  "lease-active",
  "lease-expired",
  "no-lease",
  "lease-id-mismatch",
  "owner-mismatch",
  "lease-revoked",
  "human-activity-preempted-agent",
  "human-lease-retained",
] as const;
export type ApplicationLaneInteractionLeaseReason =
  (typeof applicationLaneInteractionLeaseReasons)[number];

export type ApplicationLaneInteractionLeaseResultV1 = Readonly<{
  version: typeof APPLICATION_LANE_INTERACTION_LEASE_VERSION;
  status: ApplicationLaneInteractionLeaseStatus;
  reason: ApplicationLaneInteractionLeaseReason;
  lease: ApplicationLaneInteractionLeaseV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type ApplicationLaneInteractionLeaseLedgerOptions = Readonly<{
  maxActiveLeases?: number;
  maxLeaseTtlMs?: number;
}>;

/**
 * Derive the lease target from an already canonical application-lane descriptor.
 * Descriptor inspection is data-descriptor-only so accidental Proxy/accessor input
 * cannot execute while the interaction layer extracts identity.
 */
export function createApplicationLaneInteractionTargetV1(
  descriptorInput: ApplicationLaneDescriptorV1,
): ApplicationLaneInteractionTargetV1 {
  try {
    if (
      typeof descriptorInput !== "object" ||
      descriptorInput === null ||
      Array.isArray(descriptorInput)
    ) {
      throw new TypeError();
    }
    const prototype = Object.getPrototypeOf(descriptorInput);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(descriptorInput);
    const laneRef = descriptors.laneRef;
    const generation = descriptors.generation;
    if (
      laneRef === undefined ||
      !("value" in laneRef) ||
      !laneRef.enumerable ||
      generation === undefined ||
      !("value" in generation) ||
      !generation.enumerable
    ) {
      throw new TypeError();
    }
    return parseApplicationLaneInteractionTargetV1({
      version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
      laneRef: laneRef.value,
      laneGeneration: generation.value,
    });
  } catch {
    throw new TypeError("Application lane interaction descriptor identity is invalid");
  }
}

export function parseApplicationLaneInteractionTargetV1(
  value: unknown,
): ApplicationLaneInteractionTargetV1 {
  const input = ownDataRecord(value, "Application lane interaction target", [
    "version",
    "laneRef",
    "laneGeneration",
  ]);
  interactionVersion(input.version);
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef: identifier(input.laneRef, "Lane reference", MAX_LANE_REF_LENGTH),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
  });
}

export function parseApplicationLaneInteractionLeaseRequestV1(
  value: unknown,
  maxLeaseTtlMs = DEFAULT_MAX_APPLICATION_LANE_INTERACTION_LEASE_TTL_MS,
): ApplicationLaneInteractionLeaseRequestV1 {
  const maximum = boundedPositiveInteger(
    maxLeaseTtlMs,
    "Maximum interaction lease TTL",
    MAX_APPLICATION_LANE_INTERACTION_LEASE_TTL_MS,
  );
  const input = ownDataRecord(value, "Application lane interaction lease request", [
    "version",
    "laneRef",
    "laneGeneration",
    "leaseRef",
    "owner",
    "ttlMs",
  ]);
  interactionVersion(input.version);
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef: identifier(input.laneRef, "Lane reference", MAX_LANE_REF_LENGTH),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    leaseRef: identifier(input.leaseRef, "Lease reference", MAX_LEASE_REF_LENGTH),
    owner: exactEnum(
      input.owner,
      applicationLaneInteractionLeaseOwners,
      "Interaction lease owner",
    ),
    ttlMs: boundedPositiveInteger(input.ttlMs, "Interaction lease TTL", maximum),
  });
}

export function parseApplicationLaneInteractionLeaseRevokeV1(
  value: unknown,
): ApplicationLaneInteractionLeaseRevokeV1 {
  const input = ownDataRecord(value, "Application lane interaction lease revoke", [
    "version",
    "laneRef",
    "laneGeneration",
    "leaseRef",
  ]);
  interactionVersion(input.version);
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef: identifier(input.laneRef, "Lane reference", MAX_LANE_REF_LENGTH),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    leaseRef: identifier(input.leaseRef, "Lease reference", MAX_LEASE_REF_LENGTH),
  });
}

export function parseApplicationLaneInteractionLeaseV1(
  value: unknown,
): ApplicationLaneInteractionLeaseV1 {
  const input = ownDataRecord(value, "Application lane interaction lease", [
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
  interactionVersion(input.version);
  if (input.grantsWorkAuthority !== false) {
    throw new TypeError("Application lane interaction leases must grant zero work authority");
  }
  if (input.authorizesWorkDispatch !== false) {
    throw new TypeError("Application lane interaction leases must authorize zero work dispatch");
  }
  const issuedAtMs = nonNegativeInteger(input.issuedAtMs, "Interaction lease issue time");
  const expiresAtMs = nonNegativeInteger(input.expiresAtMs, "Interaction lease expiry time");
  if (expiresAtMs <= issuedAtMs) {
    throw new TypeError("Application lane interaction lease expiry must follow issue time");
  }
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef: identifier(input.laneRef, "Lane reference", MAX_LANE_REF_LENGTH),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    leaseRef: identifier(input.leaseRef, "Lease reference", MAX_LEASE_REF_LENGTH),
    owner: exactEnum(
      input.owner,
      applicationLaneInteractionLeaseOwners,
      "Interaction lease owner",
    ),
    issuedAtMs,
    expiresAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

/**
 * In-memory mutation/input exclusion for canonical application lanes.
 *
 * The caller supplies the current target on every operation. That keeps current
 * lane-generation truth in the canonical lane runtime rather than creating a
 * second generation registry here. A stored lease from an older generation is
 * cleared only after the current target and operation record have both parsed.
 */
export class ApplicationLaneInteractionLeaseLedger {
  readonly maxActiveLeases: number;
  readonly maxLeaseTtlMs: number;
  #leases = new Map<string, ApplicationLaneInteractionLeaseV1>();

  constructor(optionsInput: ApplicationLaneInteractionLeaseLedgerOptions = {}) {
    const options = optionalOwnDataRecord(
      optionsInput,
      "Application lane interaction lease ledger options",
      ["maxActiveLeases", "maxLeaseTtlMs"],
    );
    this.maxActiveLeases = boundedPositiveInteger(
      options.maxActiveLeases ?? DEFAULT_MAX_APPLICATION_LANE_INTERACTION_LEASES,
      "Maximum active interaction leases",
      MAX_APPLICATION_LANE_INTERACTION_LEASES,
    );
    this.maxLeaseTtlMs = boundedPositiveInteger(
      options.maxLeaseTtlMs ?? DEFAULT_MAX_APPLICATION_LANE_INTERACTION_LEASE_TTL_MS,
      "Maximum interaction lease TTL",
      MAX_APPLICATION_LANE_INTERACTION_LEASE_TTL_MS,
    );
  }

  get size(): number {
    return this.#leases.size;
  }

  acquire(
    currentTargetInput: unknown,
    requestInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionLeaseResultV1 {
    const currentTarget = parseApplicationLaneInteractionTargetV1(currentTargetInput);
    const request = parseApplicationLaneInteractionLeaseRequestV1(
      requestInput,
      this.maxLeaseTtlMs,
    );
    const nowMs = nonNegativeInteger(nowMsInput, "Interaction lease current time");
    const mismatch = requestMismatch(currentTarget, request);
    if (mismatch !== null) return result("denied", mismatch, null);

    const prepared = this.#prepareCurrentTarget(currentTarget, nowMs);
    if (prepared.stale) return result("denied", "stale-generation", null);
    this.#pruneAllExpired(nowMs);
    const current = this.#leases.get(currentTarget.laneRef);

    if (current === undefined) {
      if (this.#leases.size >= this.maxActiveLeases) {
        return result("denied", "lease-capacity", null);
      }
      const lease = createLease(request, nowMs);
      this.#leases.set(currentTarget.laneRef, lease);
      return result("acquired", "lease-acquired", lease);
    }

    if (request.owner === "human" && current.owner === "agent") {
      const lease = createLease(request, nowMs);
      this.#leases.set(currentTarget.laneRef, lease);
      return result("preempted", "human-preempted-agent", lease);
    }
    if (request.owner === "agent" && current.owner === "human") {
      return result("denied", "human-holds-lease", current);
    }
    if (request.owner === current.owner && request.leaseRef === current.leaseRef) {
      return result("denied", "renew-required", current);
    }
    return result("denied", "lease-conflict", current);
  }

  renew(
    currentTargetInput: unknown,
    requestInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionLeaseResultV1 {
    const currentTarget = parseApplicationLaneInteractionTargetV1(currentTargetInput);
    const request = parseApplicationLaneInteractionLeaseRequestV1(
      requestInput,
      this.maxLeaseTtlMs,
    );
    const nowMs = nonNegativeInteger(nowMsInput, "Interaction lease current time");
    const mismatch = requestMismatch(currentTarget, request);
    if (mismatch !== null) return result("denied", mismatch, null);

    const prepared = this.#prepareCurrentTarget(currentTarget, nowMs);
    if (prepared.stale) return result("denied", "stale-generation", null);
    if (prepared.advanced) return result("denied", "generation-advanced", null);
    if (prepared.expired) return result("denied", "lease-expired", null);
    const current = prepared.lease;
    if (current === null) return result("denied", "no-lease", null);
    if (current.leaseRef !== request.leaseRef) {
      return result("denied", "lease-id-mismatch", current);
    }
    if (current.owner !== request.owner) {
      return result("denied", "owner-mismatch", current);
    }

    const lease = createLease(request, nowMs, current.issuedAtMs);
    this.#leases.set(currentTarget.laneRef, lease);
    return result("renewed", "lease-renewed", lease);
  }

  revoke(
    currentTargetInput: unknown,
    revokeInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionLeaseResultV1 {
    const currentTarget = parseApplicationLaneInteractionTargetV1(currentTargetInput);
    const revoke = parseApplicationLaneInteractionLeaseRevokeV1(revokeInput);
    const nowMs = nonNegativeInteger(nowMsInput, "Interaction lease current time");
    const mismatch = targetMismatch(currentTarget, revoke.laneRef, revoke.laneGeneration);
    if (mismatch !== null) return result("denied", mismatch, null);

    const prepared = this.#prepareCurrentTarget(currentTarget, nowMs);
    if (prepared.stale) return result("denied", "stale-generation", null);
    if (prepared.advanced) return result("observed", "generation-advanced", null);
    if (prepared.expired) return result("observed", "lease-expired", null);
    const current = prepared.lease;
    if (current === null) return result("observed", "no-lease", null);
    if (current.leaseRef !== revoke.leaseRef) {
      return result("denied", "lease-id-mismatch", current);
    }
    this.#leases.delete(currentTarget.laneRef);
    return result("revoked", "lease-revoked", null);
  }

  read(
    currentTargetInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionLeaseResultV1 {
    const currentTarget = parseApplicationLaneInteractionTargetV1(currentTargetInput);
    const nowMs = nonNegativeInteger(nowMsInput, "Interaction lease current time");
    const prepared = this.#prepareCurrentTarget(currentTarget, nowMs);
    if (prepared.stale) return result("denied", "stale-generation", null);
    if (prepared.advanced) return result("observed", "generation-advanced", null);
    if (prepared.expired) return result("observed", "lease-expired", null);
    if (prepared.lease === null) return result("observed", "no-lease", null);
    return result("observed", "lease-active", prepared.lease);
  }

  humanActivity(
    currentTargetInput: unknown,
    nowMsInput: unknown,
  ): ApplicationLaneInteractionLeaseResultV1 {
    const currentTarget = parseApplicationLaneInteractionTargetV1(currentTargetInput);
    const nowMs = nonNegativeInteger(nowMsInput, "Interaction lease current time");
    const prepared = this.#prepareCurrentTarget(currentTarget, nowMs);
    if (prepared.stale) return result("denied", "stale-generation", null);
    if (prepared.advanced) return result("observed", "generation-advanced", null);
    if (prepared.expired) return result("observed", "lease-expired", null);
    const current = prepared.lease;
    if (current === null) return result("observed", "no-lease", null);
    if (current.owner === "agent") {
      this.#leases.delete(currentTarget.laneRef);
      return result("preempted", "human-activity-preempted-agent", null);
    }
    return result("observed", "human-lease-retained", current);
  }

  clear(): void {
    this.#leases.clear();
  }

  #prepareCurrentTarget(
    target: ApplicationLaneInteractionTargetV1,
    nowMs: number,
  ): Readonly<{
    lease: ApplicationLaneInteractionLeaseV1 | null;
    stale: boolean;
    advanced: boolean;
    expired: boolean;
  }> {
    const current = this.#leases.get(target.laneRef);
    if (current === undefined) {
      return { lease: null, stale: false, advanced: false, expired: false };
    }
    if (current.laneGeneration > target.laneGeneration) {
      return { lease: null, stale: true, advanced: false, expired: false };
    }
    if (current.laneGeneration < target.laneGeneration) {
      this.#leases.delete(target.laneRef);
      return { lease: null, stale: false, advanced: true, expired: false };
    }
    if (current.expiresAtMs <= nowMs) {
      this.#leases.delete(target.laneRef);
      return { lease: null, stale: false, advanced: false, expired: true };
    }
    return { lease: current, stale: false, advanced: false, expired: false };
  }

  #pruneAllExpired(nowMs: number): void {
    for (const [laneRef, lease] of this.#leases) {
      if (lease.expiresAtMs <= nowMs) this.#leases.delete(laneRef);
    }
  }
}

function requestMismatch(
  currentTarget: ApplicationLaneInteractionTargetV1,
  request: ApplicationLaneInteractionLeaseRequestV1,
): "lane-mismatch" | "stale-generation" | "future-generation" | null {
  return targetMismatch(currentTarget, request.laneRef, request.laneGeneration);
}

function targetMismatch(
  currentTarget: ApplicationLaneInteractionTargetV1,
  laneRef: string,
  laneGeneration: number,
): "lane-mismatch" | "stale-generation" | "future-generation" | null {
  if (laneRef !== currentTarget.laneRef) return "lane-mismatch";
  if (laneGeneration < currentTarget.laneGeneration) return "stale-generation";
  if (laneGeneration > currentTarget.laneGeneration) return "future-generation";
  return null;
}

function createLease(
  request: ApplicationLaneInteractionLeaseRequestV1,
  nowMs: number,
  issuedAtMs = nowMs,
): ApplicationLaneInteractionLeaseV1 {
  const expiresAtMs = addBoundedTime(nowMs, request.ttlMs);
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    laneRef: request.laneRef,
    laneGeneration: request.laneGeneration,
    leaseRef: request.leaseRef,
    owner: request.owner,
    issuedAtMs,
    expiresAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function result(
  status: ApplicationLaneInteractionLeaseStatus,
  reason: ApplicationLaneInteractionLeaseReason,
  lease: ApplicationLaneInteractionLeaseV1 | null,
): ApplicationLaneInteractionLeaseResultV1 {
  return Object.freeze({
    version: APPLICATION_LANE_INTERACTION_LEASE_VERSION,
    status,
    reason,
    lease,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function ownDataRecord(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      throw new TypeError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw new TypeError();
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    throw new TypeError(`${label} must be an exact plain own-data record`);
  }
}

function optionalOwnDataRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
      throw new TypeError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key as string];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw new TypeError();
      }
      output[key as string] = descriptor.value;
    }
    return output;
  } catch {
    throw new TypeError(`${label} must be a plain own-data record`);
  }
}

function interactionVersion(value: unknown): void {
  if (value !== APPLICATION_LANE_INTERACTION_LEASE_VERSION) {
    throw new TypeError(
      `Application lane interaction lease version must be ${APPLICATION_LANE_INTERACTION_LEASE_VERSION}`,
    );
  }
}

function identifier(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} is required`);
  if (text.length > maximum) throw new RangeError(`${label} exceeds ${maximum} characters`);
  if (unsafeTextPattern.test(text) || credentialPattern.test(text) || !IDENTIFIER.test(text)) {
    throw new TypeError(`${label} is invalid`);
  }
  return text;
}

function positiveInteger(value: unknown, label: string): number {
  return boundedPositiveInteger(value, label, Number.MAX_SAFE_INTEGER);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function boundedPositiveInteger(value: unknown, label: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a positive safe integer at most ${maximum}`);
  }
  return value;
}

function addBoundedTime(nowMs: number, ttlMs: number): number {
  if (nowMs > Number.MAX_SAFE_INTEGER - ttlMs) {
    throw new RangeError("Application lane interaction lease expiry exceeds safe time range");
  }
  return nowMs + ttlMs;
}

function exactEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Values[number];
}
