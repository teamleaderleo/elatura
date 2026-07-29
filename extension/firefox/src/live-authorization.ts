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

const CAPABILITY_ORDER = new Map<LiveCapability, number>(
  LIVE_CAPABILITIES.map((capability, index) => [capability, index]),
);

function deny(reason: LiveAuthorizationDenialReason): LiveAuthorizationDecision {
  return Object.freeze({ eligible: false, reason });
}

function isPlainRecord(value: unknown): value is DataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableKeys(record: DataRecord, expected: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  let count = 0;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key) || !expectedSet.has(key)) return false;
    count += 1;
    if (count > expected.length) return false;
  }
  if (count !== expected.length) return false;
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}

function dataValue(record: DataRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function generation(value: unknown): number | null {
  return finiteEpoch(value);
}

function token(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

function version(value: unknown): string | null {
  return typeof value === "string" && VERSION.test(value) ? value : null;
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && SHA256.test(value) ? value : null;
}

function fingerprintHash(value: unknown): string | null {
  return typeof value === "string" && FINGERPRINT_HASH.test(value) ? value : null;
}

function origin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value ? value : null;
  } catch {
    return null;
  }
}

function capability(value: unknown): LiveCapability | null {
  return typeof value === "string" && (LIVE_CAPABILITIES as readonly string[]).includes(value)
    ? (value as LiveCapability)
    : null;
}

function buildChannel(value: unknown): LiveBuildChannel | null {
  return typeof value === "string" && (LIVE_BUILD_CHANNELS as readonly string[]).includes(value)
    ? (value as LiveBuildChannel)
    : null;
}

function readArrayValues(value: unknown, maximumLength: number): unknown[] | null {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    values.push(descriptor.value);
  }
  return values;
}

function readCapabilitySet(value: unknown): readonly LiveCapability[] | null {
  const values = readArrayValues(value, LIVE_CAPABILITIES.length);
  if (!values) return null;
  const parsed: LiveCapability[] = [];
  let previousIndex = -1;
  for (const item of values) {
    const parsedCapability = capability(item);
    if (!parsedCapability) return null;
    const index = CAPABILITY_ORDER.get(parsedCapability);
    if (index === undefined || index <= previousIndex) return null;
    previousIndex = index;
    parsed.push(parsedCapability);
  }
  return Object.freeze(parsed);
}

function sameCapabilities(left: readonly LiveCapability[], right: readonly LiveCapability[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readAdapter(value: unknown): AdapterIdentity | null {
  if (!isPlainRecord(value) || !hasExactEnumerableKeys(value, ["id", "version"])) return null;
  const id = token(dataValue(value, "id"));
  const adapterVersion = version(dataValue(value, "version"));
  return id && adapterVersion ? Object.freeze({ id, version: adapterVersion }) : null;
}

function sameAdapter(left: AdapterIdentity, right: AdapterIdentity): boolean {
  return left.id === right.id && left.version === right.version;
}

function readBuild(value: unknown): LiveBuildIdentity | null {
  if (
    !isPlainRecord(value) ||
    !hasExactEnumerableKeys(value, [
      "revision",
      "extensionVersion",
      "channel",
      "buildManifestSha256",
    ])
  ) {
    return null;
  }
  const revision = dataValue(value, "revision");
  const extensionVersion = version(dataValue(value, "extensionVersion"));
  const channel = buildChannel(dataValue(value, "channel"));
  const buildManifestSha256 = sha256(dataValue(value, "buildManifestSha256"));
  if (typeof revision !== "string" || !REVISION.test(revision) || !extensionVersion || !channel || !buildManifestSha256) {
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

function readSafety(value: unknown): Readonly<{ emergencyDisabled: boolean; generation: number }> | null {
  if (!isPlainRecord(value)) return null;
  const emergencyDisabled = dataValue(value, "emergencyDisabled");
  const safetyGeneration = generation(dataValue(value, "generation"));
  return typeof emergencyDisabled === "boolean" && safetyGeneration !== null
    ? Object.freeze({ emergencyDisabled, generation: safetyGeneration })
    : null;
}

function readOptIn(value: unknown): Readonly<{ recorded: boolean; generation: number }> | null {
  if (!isPlainRecord(value)) return null;
  const recorded = dataValue(value, "recorded");
  const optInGeneration = generation(dataValue(value, "generation"));
  const authorizesTransform = dataValue(value, "authorizesTransform");
  return typeof recorded === "boolean" && optInGeneration !== null && authorizesTransform === false
    ? Object.freeze({ recorded, generation: optInGeneration })
    : null;
}

function readDenylist(value: unknown): readonly AdapterIdentity[] | null {
  const values = readArrayValues(value, MAX_DENYLIST_ENTRIES);
  if (!values) return null;
  const parsed: AdapterIdentity[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const identity = readAdapter(item);
    if (!identity) return null;
    const key = `${identity.id}\u0000${identity.version}`;
    if (seen.has(key)) return null;
    seen.add(key);
    parsed.push(identity);
  }
  return Object.freeze(parsed);
}

function readRevocations(value: unknown): ReadonlySet<string> | null {
  const values = readArrayValues(value, MAX_REVOCATIONS);
  if (!values) return null;
  const parsed = new Set<string>();
  for (const item of values) {
    const approvalId = token(item);
    if (!approvalId || parsed.has(approvalId)) return null;
    parsed.add(approvalId);
  }
  return parsed;
}

function readApproval(value: unknown): LiveAuthorizationApproval | null {
  if (
    !isPlainRecord(value) ||
    !hasExactEnumerableKeys(value, [
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
    ])
  ) {
    return null;
  }
  const approvalId = token(dataValue(value, "approvalId"));
  const build = readBuild(dataValue(value, "build"));
  const authorityOrigin = origin(dataValue(value, "origin"));
  const responseClassId = token(dataValue(value, "responseClassId"));
  const adapter = readAdapter(dataValue(value, "adapter"));
  const capabilities = readCapabilitySet(dataValue(value, "capabilities"));
  const evidencePacketSha256 = sha256(dataValue(value, "evidencePacketSha256"));
  const expectedFingerprintHash = fingerprintHash(dataValue(value, "expectedFingerprintHash"));
  const validFromEpochMs = finiteEpoch(dataValue(value, "validFromEpochMs"));
  const validUntilEpochMs = finiteEpoch(dataValue(value, "validUntilEpochMs"));
  if (
    dataValue(value, "schemaVersion") !== LIVE_AUTHORIZATION_SCHEMA_VERSION ||
    dataValue(value, "status") !== "approved" ||
    !approvalId ||
    !build ||
    !authorityOrigin ||
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
    origin: authorityOrigin,
    responseClassId,
    adapter,
    capabilities,
    evidencePacketSha256,
    expectedFingerprintHash,
    validFromEpochMs,
    validUntilEpochMs,
  });
}

function readGrant(value: unknown): VolatileLiveAuthorizationGrant | null {
  if (
    !isPlainRecord(value) ||
    !hasExactEnumerableKeys(value, [
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
    ])
  ) {
    return null;
  }
  const grantId = token(dataValue(value, "grantId"));
  const approvalId = token(dataValue(value, "approvalId"));
  const sessionId = token(dataValue(value, "sessionId"));
  const requestedCapability = capability(dataValue(value, "capability"));
  const buildManifestSha256 = sha256(dataValue(value, "buildManifestSha256"));
  const authorityOrigin = origin(dataValue(value, "origin"));
  const responseClassId = token(dataValue(value, "responseClassId"));
  const adapter = readAdapter(dataValue(value, "adapter"));
  const approvedCapabilities = readCapabilitySet(dataValue(value, "approvedCapabilities"));
  const issuedAtEpochMs = finiteEpoch(dataValue(value, "issuedAtEpochMs"));
  const expiresAtEpochMs = finiteEpoch(dataValue(value, "expiresAtEpochMs"));
  const safetyGeneration = generation(dataValue(value, "safetyGeneration"));
  const optInGeneration = generation(dataValue(value, "optInGeneration"));
  if (
    dataValue(value, "schemaVersion") !== LIVE_AUTHORIZATION_SCHEMA_VERSION ||
    !grantId ||
    !approvalId ||
    !sessionId ||
    !requestedCapability ||
    !buildManifestSha256 ||
    !authorityOrigin ||
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
    capability: requestedCapability,
    buildManifestSha256,
    origin: authorityOrigin,
    responseClassId,
    adapter,
    approvedCapabilities,
    issuedAtEpochMs,
    expiresAtEpochMs,
    safetyGeneration,
    optInGeneration,
  });
}

export function evaluateLiveAuthorization(input: unknown): LiveAuthorizationDecision {
  if (
    !isPlainRecord(input) ||
    !hasExactEnumerableKeys(input, [
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
    ])
  ) {
    return deny("authorization-input-invalid");
  }

  const safety = readSafety(dataValue(input, "safety"));
  if (!safety) return deny("authorization-input-invalid");
  if (safety.emergencyDisabled) return deny("emergency-disabled");

  const requestedCapability = capability(dataValue(input, "capability"));
  const nowEpochMs = finiteEpoch(dataValue(input, "nowEpochMs"));
  const sessionId = token(dataValue(input, "sessionId"));
  const currentBuild = readBuild(dataValue(input, "build"));
  const currentOrigin = origin(dataValue(input, "origin"));
  const responseClassId = token(dataValue(input, "responseClassId"));
  const adapter = readAdapter(dataValue(input, "adapter"));
  const declaredCapabilities = readCapabilitySet(dataValue(input, "declaredCapabilities"));
  const optIn = readOptIn(dataValue(input, "optIn"));
  const denylist = readDenylist(dataValue(input, "denylist"));
  const revocations = readRevocations(dataValue(input, "revokedApprovalIds"));
  if (
    !requestedCapability ||
    nowEpochMs === null ||
    !sessionId ||
    !currentBuild ||
    !currentOrigin ||
    !responseClassId ||
    !adapter ||
    !declaredCapabilities ||
    !optIn ||
    !denylist ||
    !revocations
  ) {
    return deny("authorization-input-invalid");
  }

  if (!declaredCapabilities.includes(requestedCapability)) return deny("capability-disabled");
  if (!optIn.recorded) return deny("local-opt-in-required");

  try {
    if (isAdapterDenied(adapter, denylist)) return deny("adapter-denylisted");
  } catch {
    return deny("authorization-input-invalid");
  }

  const rawApproval = dataValue(input, "approval");
  if (rawApproval === null) return deny("approval-missing");
  const approval = readApproval(rawApproval);
  if (!approval) return deny("approval-invalid");
  if (revocations.has(approval.approvalId)) return deny("approval-revoked");
  if (nowEpochMs < approval.validFromEpochMs) return deny("approval-not-yet-valid");
  if (nowEpochMs >= approval.validUntilEpochMs) return deny("approval-expired");
  if (!sameBuild(currentBuild, approval.build)) return deny("build-mismatch");
  if (currentOrigin !== approval.origin) return deny("origin-mismatch");
  if (responseClassId !== approval.responseClassId) return deny("response-class-mismatch");
  if (!sameAdapter(adapter, approval.adapter)) return deny("adapter-mismatch");
  if (!sameCapabilities(declaredCapabilities, approval.capabilities)) {
    return deny("capability-set-mismatch");
  }

  const rawGrant = dataValue(input, "grant");
  if (rawGrant === null) return deny("grant-missing");
  const grant = readGrant(rawGrant);
  if (!grant) return deny("grant-invalid");
  if (nowEpochMs >= grant.expiresAtEpochMs) return deny("grant-expired");
  if (grant.sessionId !== sessionId) return deny("grant-session-mismatch");
  if (grant.safetyGeneration !== safety.generation || grant.optInGeneration !== optIn.generation) {
    return deny("grant-generation-mismatch");
  }
  if (
    grant.issuedAtEpochMs < approval.validFromEpochMs ||
    grant.expiresAtEpochMs > approval.validUntilEpochMs ||
    grant.approvalId !== approval.approvalId ||
    grant.capability !== requestedCapability ||
    grant.buildManifestSha256 !== currentBuild.buildManifestSha256 ||
    grant.origin !== currentOrigin ||
    grant.responseClassId !== responseClassId ||
    !sameAdapter(grant.adapter, adapter) ||
    !sameCapabilities(grant.approvedCapabilities, approval.capabilities)
  ) {
    return deny("grant-binding-mismatch");
  }

  return Object.freeze({ eligible: true, reason: "authorized", capability: requestedCapability });
}
