// SPDX-License-Identifier: MPL-2.0

import {
  isAdapterDenied,
  type AdapterIdentity,
} from "./transform-safety.js";

export const LIVE_AUTHORIZATION_SCHEMA_VERSION = 1 as const;

export const LIVE_CAPABILITIES = [
  "transform",
  "cache",
  "alternate-surface",
  "native-companion",
] as const;

export const LIVE_BUILD_CHANNELS = [
  "development",
  "reviewCandidate",
  "unlistedAlpha",
  "listedProduction",
] as const;

export type LiveCapability = (typeof LIVE_CAPABILITIES)[number];
export type LiveBuildChannel = (typeof LIVE_BUILD_CHANNELS)[number];

export type LiveBuildIdentity = {
  revision: string;
  extensionVersion: string;
  channel: LiveBuildChannel;
  buildManifestSha256: string;
};

export type LiveAuthorizationApproval = {
  schemaVersion: typeof LIVE_AUTHORIZATION_SCHEMA_VERSION;
  approvalId: string;
  status: "approved";
  build: LiveBuildIdentity;
  origin: string;
  responseClassId: string;
  adapter: AdapterIdentity;
  capabilities: readonly LiveCapability[];
  evidencePacketSha256: string;
  expectedFingerprintHash: string;
  validFromEpochMs: number;
  validUntilEpochMs: number;
};

export type VolatileLiveAuthorizationGrant = {
  schemaVersion: typeof LIVE_AUTHORIZATION_SCHEMA_VERSION;
  grantId: string;
  approvalId: string;
  sessionId: string;
  capability: LiveCapability;
  buildManifestSha256: string;
  origin: string;
  responseClassId: string;
  adapter: AdapterIdentity;
  approvedCapabilities: readonly LiveCapability[];
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
  safetyGeneration: number;
  optInGeneration: number;
};

export type LiveAuthorizationDenialReason =
  | "authorization-input-invalid"
  | "emergency-disabled"
  | "capability-disabled"
  | "local-opt-in-required"
  | "adapter-denylisted"
  | "approval-missing"
  | "approval-invalid"
  | "approval-revoked"
  | "approval-not-yet-valid"
  | "approval-expired"
  | "build-mismatch"
  | "origin-mismatch"
  | "response-class-mismatch"
  | "adapter-mismatch"
  | "capability-set-mismatch"
  | "grant-missing"
  | "grant-invalid"
  | "grant-expired"
  | "grant-session-mismatch"
  | "grant-generation-mismatch"
  | "grant-binding-mismatch";

export type LiveAuthorizationDecision =
  | Readonly<{ eligible: true; reason: "authorized"; capability: LiveCapability }>
  | Readonly<{ eligible: false; reason: LiveAuthorizationDenialReason }>;

type DataRecord = Record<string, unknown>;

const TOKEN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FINGERPRINT_HASH = /^[0-9a-f]{8,128}$/u;
const MAX_DENYLIST_ENTRIES = 256;
const MAX_REVOCATIONS = 256;

const CAPABILITY_ORDER: Readonly<Record<LiveCapability, number>> = Object.freeze({
  transform: 0,
  cache: 1,
  "alternate-surface": 2,
  "native-companion": 3,
});

function deny(reason: LiveAuthorizationDenialReason): LiveAuthorizationDecision {
  return Object.freeze({ eligible: false, reason });
}

function exactRecord(value: unknown, expected: readonly string[]): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const record = value as DataRecord;
  const expectedSet = new Set(expected);
  let count = 0;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key) || !expectedSet.has(key)) return null;
    count += 1;
    if (count > expected.length) return null;
  }
  if (count !== expected.length) return null;
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
  }
  return record;
}

function looseRecord(value: unknown): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as DataRecord) : null;
}

function dataValue(record: DataRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedToken(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

function boundedVersion(value: unknown): string | null {
  return typeof value === "string" && VERSION.test(value) ? value : null;
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && SHA256.test(value) ? value : null;
}

function structuralHash(value: unknown): string | null {
  return typeof value === "string" && FINGERPRINT_HASH.test(value) ? value : null;
}

function exactOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const parsed = new URL(value);
  return parsed.protocol === "https:" && parsed.origin === value ? value : null;
}

function liveCapability(value: unknown): LiveCapability | null {
  return typeof value === "string" && (LIVE_CAPABILITIES as readonly string[]).includes(value)
    ? (value as LiveCapability)
    : null;
}

function buildChannel(value: unknown): LiveBuildChannel | null {
  return typeof value === "string" && (LIVE_BUILD_CHANNELS as readonly string[]).includes(value)
    ? (value as LiveBuildChannel)
    : null;
}

function arrayValues(value: unknown, maximumLength: number): unknown[] | null {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    values.push(descriptor.value);
  }
  return values;
}

function capabilitySet(value: unknown): readonly LiveCapability[] | null {
  const values = arrayValues(value, LIVE_CAPABILITIES.length);
  if (!values) return null;
  const result: LiveCapability[] = [];
  let previous = -1;
  for (const item of values) {
    const parsed = liveCapability(item);
    if (!parsed || CAPABILITY_ORDER[parsed] <= previous) return null;
    previous = CAPABILITY_ORDER[parsed];
    result.push(parsed);
  }
  return Object.freeze(result);
}

function sameCapabilities(left: readonly LiveCapability[], right: readonly LiveCapability[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function adapterIdentity(value: unknown): AdapterIdentity | null {
  const record = exactRecord(value, ["id", "version"]);
  if (!record) return null;
  const id = boundedToken(dataValue(record, "id"));
  const version = boundedVersion(dataValue(record, "version"));
  return id && version ? Object.freeze({ id, version }) : null;
}

function sameAdapter(left: AdapterIdentity, right: AdapterIdentity): boolean {
  return left.id === right.id && left.version === right.version;
}

function buildIdentity(value: unknown): LiveBuildIdentity | null {
  const record = exactRecord(value, ["revision", "extensionVersion", "channel", "buildManifestSha256"]);
  if (!record) return null;
  const revision = dataValue(record, "revision");
  const extensionVersion = boundedVersion(dataValue(record, "extensionVersion"));
  const channel = buildChannel(dataValue(record, "channel"));
  const buildManifestSha256 = sha256(dataValue(record, "buildManifestSha256"));
  if (
    typeof revision !== "string" ||
    !REVISION.test(revision) ||
    !extensionVersion ||
    !channel ||
    !buildManifestSha256
  ) {
    return null;
  }
  return Object.freeze({ revision, extensionVersion, channel, buildManifestSha256 });
}

function sameBuild(left: LiveBuildIdentity, right: LiveBuildIdentity): boolean {
  return (
    left.revision === right.revision &&
    left.extensionVersion === right.extensionVersion &&
    left.channel === right.channel &&
    left.buildManifestSha256 === right.buildManifestSha256
  );
}

function safetySnapshot(value: unknown): Readonly<{ emergencyDisabled: boolean; generation: number }> | null {
  const record = looseRecord(value);
  if (!record) return null;
  const emergencyDisabled = dataValue(record, "emergencyDisabled");
  const generation = safeInteger(dataValue(record, "generation"));
  return typeof emergencyDisabled === "boolean" && generation !== null
    ? Object.freeze({ emergencyDisabled, generation })
    : null;
}

function optInSnapshot(value: unknown): Readonly<{ recorded: boolean; generation: number }> | null {
  const record = looseRecord(value);
  if (!record) return null;
  const recorded = dataValue(record, "recorded");
  const generation = safeInteger(dataValue(record, "generation"));
  return typeof recorded === "boolean" && generation !== null && dataValue(record, "authorizesTransform") === false
    ? Object.freeze({ recorded, generation })
    : null;
}

function adapterDenylist(value: unknown): readonly AdapterIdentity[] | null {
  const values = arrayValues(value, MAX_DENYLIST_ENTRIES);
  if (!values) return null;
  const result: AdapterIdentity[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const identity = adapterIdentity(item);
    if (!identity) return null;
    const key = `${identity.id}\u0000${identity.version}`;
    if (seen.has(key)) return null;
    seen.add(key);
    result.push(identity);
  }
  return Object.freeze(result);
}

function revokedApprovals(value: unknown): ReadonlySet<string> | null {
  const values = arrayValues(value, MAX_REVOCATIONS);
  if (!values) return null;
  const result = new Set<string>();
  for (const item of values) {
    const approvalId = boundedToken(item);
    if (!approvalId || result.has(approvalId)) return null;
    result.add(approvalId);
  }
  return result;
}

function authorizationApproval(value: unknown): LiveAuthorizationApproval | null {
  const record = exactRecord(value, [
    "schemaVersion",
    "approvalId",
    "status",
    "build",
    "origin",
    "responseClassId",
    "adapter",
    "capabilities",
    "evidencePacketSha256",
    "expectedFingerprintHash",
    "validFromEpochMs",
    "validUntilEpochMs",
  ]);
  if (!record) return null;
  const approvalId = boundedToken(dataValue(record, "approvalId"));
  const build = buildIdentity(dataValue(record, "build"));
  const origin = exactOrigin(dataValue(record, "origin"));
  const responseClassId = boundedToken(dataValue(record, "responseClassId"));
  const adapter = adapterIdentity(dataValue(record, "adapter"));
  const capabilities = capabilitySet(dataValue(record, "capabilities"));
  const evidencePacketSha256 = sha256(dataValue(record, "evidencePacketSha256"));
  const expectedFingerprintHash = structuralHash(dataValue(record, "expectedFingerprintHash"));
  const validFromEpochMs = safeInteger(dataValue(record, "validFromEpochMs"));
  const validUntilEpochMs = safeInteger(dataValue(record, "validUntilEpochMs"));
  if (
    dataValue(record, "schemaVersion") !== LIVE_AUTHORIZATION_SCHEMA_VERSION ||
    dataValue(record, "status") !== "approved" ||
    !approvalId ||
    !build ||
    !origin ||
    !responseClassId ||
    !adapter ||
    !capabilities ||
    capabilities.length === 0 ||
    !evidencePacketSha256 ||
    !expectedFingerprintHash ||
    validFromEpochMs === null ||
    validUntilEpochMs === null ||
    validUntilEpochMs <= validFromEpochMs
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: LIVE_AUTHORIZATION_SCHEMA_VERSION,
    approvalId,
    status: "approved",
    build,
    origin,
    responseClassId,
    adapter,
    capabilities,
    evidencePacketSha256,
    expectedFingerprintHash,
    validFromEpochMs,
    validUntilEpochMs,
  });
}

function volatileGrant(value: unknown): VolatileLiveAuthorizationGrant | null {
  const record = exactRecord(value, [
    "schemaVersion",
    "grantId",
    "approvalId",
    "sessionId",
    "capability",
    "buildManifestSha256",
    "origin",
    "responseClassId",
    "adapter",
    "approvedCapabilities",
    "issuedAtEpochMs",
    "expiresAtEpochMs",
    "safetyGeneration",
    "optInGeneration",
  ]);
  if (!record) return null;
  const grantId = boundedToken(dataValue(record, "grantId"));
  const approvalId = boundedToken(dataValue(record, "approvalId"));
  const sessionId = boundedToken(dataValue(record, "sessionId"));
  const capability = liveCapability(dataValue(record, "capability"));
  const buildManifestSha256 = sha256(dataValue(record, "buildManifestSha256"));
  const origin = exactOrigin(dataValue(record, "origin"));
  const responseClassId = boundedToken(dataValue(record, "responseClassId"));
  const adapter = adapterIdentity(dataValue(record, "adapter"));
  const approvedCapabilities = capabilitySet(dataValue(record, "approvedCapabilities"));
  const issuedAtEpochMs = safeInteger(dataValue(record, "issuedAtEpochMs"));
  const expiresAtEpochMs = safeInteger(dataValue(record, "expiresAtEpochMs"));
  const safetyGeneration = safeInteger(dataValue(record, "safetyGeneration"));
  const optInGeneration = safeInteger(dataValue(record, "optInGeneration"));
  if (
    dataValue(record, "schemaVersion") !== LIVE_AUTHORIZATION_SCHEMA_VERSION ||
    !grantId ||
    !approvalId ||
    !sessionId ||
    !capability ||
    !buildManifestSha256 ||
    !origin ||
    !responseClassId ||
    !adapter ||
    !approvedCapabilities ||
    approvedCapabilities.length === 0 ||
    issuedAtEpochMs === null ||
    expiresAtEpochMs === null ||
    expiresAtEpochMs <= issuedAtEpochMs ||
    safetyGeneration === null ||
    optInGeneration === null
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: LIVE_AUTHORIZATION_SCHEMA_VERSION,
    grantId,
    approvalId,
    sessionId,
    capability,
    buildManifestSha256,
    origin,
    responseClassId,
    adapter,
    approvedCapabilities,
    issuedAtEpochMs,
    expiresAtEpochMs,
    safetyGeneration,
    optInGeneration,
  });
}

function evaluate(input: unknown): LiveAuthorizationDecision {
  const record = exactRecord(input, [
    "capability",
    "nowEpochMs",
    "sessionId",
    "build",
    "origin",
    "responseClassId",
    "adapter",
    "declaredCapabilities",
    "safety",
    "optIn",
    "denylist",
    "approval",
    "grant",
    "revokedApprovalIds",
  ]);
  if (!record) return deny("authorization-input-invalid");

  const safety = safetySnapshot(dataValue(record, "safety"));
  if (!safety) return deny("authorization-input-invalid");
  if (safety.emergencyDisabled) return deny("emergency-disabled");

  const capability = liveCapability(dataValue(record, "capability"));
  const nowEpochMs = safeInteger(dataValue(record, "nowEpochMs"));
  const sessionId = boundedToken(dataValue(record, "sessionId"));
  const build = buildIdentity(dataValue(record, "build"));
  const origin = exactOrigin(dataValue(record, "origin"));
  const responseClassId = boundedToken(dataValue(record, "responseClassId"));
  const adapter = adapterIdentity(dataValue(record, "adapter"));
  const declaredCapabilities = capabilitySet(dataValue(record, "declaredCapabilities"));
  const optIn = optInSnapshot(dataValue(record, "optIn"));
  const denylist = adapterDenylist(dataValue(record, "denylist"));
  const revocations = revokedApprovals(dataValue(record, "revokedApprovalIds"));
  if (
    !capability ||
    nowEpochMs === null ||
    !sessionId ||
    !build ||
    !origin ||
    !responseClassId ||
    !adapter ||
    !declaredCapabilities ||
    !optIn ||
    !denylist ||
    !revocations
  ) {
    return deny("authorization-input-invalid");
  }

  if (!declaredCapabilities.includes(capability)) return deny("capability-disabled");
  if (!optIn.recorded) return deny("local-opt-in-required");
  if (isAdapterDenied(adapter, denylist)) return deny("adapter-denylisted");

  const rawApproval = dataValue(record, "approval");
  if (rawApproval === null) return deny("approval-missing");
  const approval = authorizationApproval(rawApproval);
  if (!approval) return deny("approval-invalid");
  if (revocations.has(approval.approvalId)) return deny("approval-revoked");
  if (nowEpochMs < approval.validFromEpochMs) return deny("approval-not-yet-valid");
  if (nowEpochMs >= approval.validUntilEpochMs) return deny("approval-expired");
  if (!sameBuild(build, approval.build)) return deny("build-mismatch");
  if (origin !== approval.origin) return deny("origin-mismatch");
  if (responseClassId !== approval.responseClassId) return deny("response-class-mismatch");
  if (!sameAdapter(adapter, approval.adapter)) return deny("adapter-mismatch");
  if (!sameCapabilities(declaredCapabilities, approval.capabilities)) return deny("capability-set-mismatch");

  const rawGrant = dataValue(record, "grant");
  if (rawGrant === null) return deny("grant-missing");
  const grant = volatileGrant(rawGrant);
  if (!grant || nowEpochMs < grant.issuedAtEpochMs) return deny("grant-invalid");
  if (nowEpochMs >= grant.expiresAtEpochMs) return deny("grant-expired");
  if (grant.sessionId !== sessionId) return deny("grant-session-mismatch");
  if (grant.safetyGeneration !== safety.generation || grant.optInGeneration !== optIn.generation) {
    return deny("grant-generation-mismatch");
  }
  if (
    grant.issuedAtEpochMs < approval.validFromEpochMs ||
    grant.expiresAtEpochMs > approval.validUntilEpochMs ||
    grant.approvalId !== approval.approvalId ||
    grant.capability !== capability ||
    grant.buildManifestSha256 !== build.buildManifestSha256 ||
    grant.origin !== origin ||
    grant.responseClassId !== responseClassId ||
    !sameAdapter(grant.adapter, adapter) ||
    !sameCapabilities(grant.approvedCapabilities, approval.capabilities)
  ) {
    return deny("grant-binding-mismatch");
  }

  return Object.freeze({ eligible: true, reason: "authorized", capability });
}

export function evaluateLiveAuthorization(input: unknown): LiveAuthorizationDecision {
  try {
    return evaluate(input);
  } catch {
    return deny("authorization-input-invalid");
  }
}
