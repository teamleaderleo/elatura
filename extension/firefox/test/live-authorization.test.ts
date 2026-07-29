// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import {
  evaluateLiveAuthorization,
  type LiveAuthorizationApproval,
  type LiveBuildIdentity,
  type VolatileLiveAuthorizationGrant,
} from "../src/live-authorization.js";

const BUILD_MANIFEST_SHA = "a".repeat(64);
const EVIDENCE_SHA = "b".repeat(64);
const FINGERPRINT_HASH = "c".repeat(64);

const build: LiveBuildIdentity = {
  revision: "d".repeat(40),
  extensionVersion: "0.1.0",
  channel: "development",
  buildManifestSha256: BUILD_MANIFEST_SHA,
};

const adapter = { id: "chatgpt-live-conversation", version: "1.0.0" };

const approval: LiveAuthorizationApproval = {
  schemaVersion: 1,
  approvalId: "approval-m1-transform",
  status: "approved",
  build,
  origin: "https://chatgpt.com",
  responseClassId: "candidate-conversation-v1",
  adapter,
  capabilities: ["transform"],
  evidencePacketSha256: EVIDENCE_SHA,
  expectedFingerprintHash: FINGERPRINT_HASH,
  validFromEpochMs: 1_000,
  validUntilEpochMs: 10_000,
};

const grant: VolatileLiveAuthorizationGrant = {
  schemaVersion: 1,
  grantId: "grant-current-session",
  approvalId: approval.approvalId,
  sessionId: "session-current",
  capability: "transform",
  buildManifestSha256: BUILD_MANIFEST_SHA,
  origin: approval.origin,
  responseClassId: approval.responseClassId,
  adapter,
  approvedCapabilities: ["transform"],
  issuedAtEpochMs: 1_500,
  expiresAtEpochMs: 5_000,
  safetyGeneration: 4,
  optInGeneration: 7,
};

function input(): Record<string, unknown> {
  return {
    capability: "transform",
    nowEpochMs: 2_000,
    sessionId: "session-current",
    build: structuredClone(build),
    origin: approval.origin,
    responseClassId: approval.responseClassId,
    adapter: structuredClone(adapter),
    declaredCapabilities: ["transform"],
    safety: {
      schemaVersion: 1,
      emergencyDisabled: false,
      reason: "reviewed-local-session",
      generation: 4,
      volatileClearCount: 0,
      volatileClearFailureCount: 0,
      denylistEntryCount: 0,
    },
    optIn: {
      schemaVersion: 1,
      recorded: true,
      reason: "user-recorded",
      generation: 7,
      acknowledgementCount: 3,
      authorizesTransform: false,
    },
    denylist: [],
    approval: structuredClone(approval),
    grant: structuredClone(grant),
    revokedApprovalIds: [],
  };
}

function nested(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return record[key] as Record<string, unknown>;
}

describe("deny-by-default live authorization", () => {
  it("returns eligible only when every reviewed and volatile binding matches", () => {
    expect(evaluateLiveAuthorization(input())).toEqual({
      eligible: true,
      reason: "authorized",
      capability: "transform",
    });
  });

  it("keeps the emergency lock authoritative over positive or malformed grants", () => {
    const candidate = input();
    nested(candidate, "safety").emergencyDisabled = true;
    candidate.approval = { private: "content" };
    candidate.grant = { forged: true };
    expect(evaluateLiveAuthorization(candidate)).toEqual({
      eligible: false,
      reason: "emergency-disabled",
    });
  });

  it("requires an enabled exact capability and recorded non-authorizing intent", () => {
    const disabled = input();
    disabled.declaredCapabilities = [];
    expect(evaluateLiveAuthorization(disabled)).toEqual({
      eligible: false,
      reason: "capability-disabled",
    });

    const revoked = input();
    nested(revoked, "optIn").recorded = false;
    expect(evaluateLiveAuthorization(revoked)).toEqual({
      eligible: false,
      reason: "local-opt-in-required",
    });

    const contradictory = input();
    nested(contradictory, "optIn").authorizesTransform = true;
    expect(evaluateLiveAuthorization(contradictory)).toEqual({
      eligible: false,
      reason: "authorization-input-invalid",
    });
  });

  it("rejects a denylisted exact adapter identity", () => {
    const candidate = input();
    candidate.denylist = [structuredClone(adapter)];
    expect(evaluateLiveAuthorization(candidate)).toEqual({
      eligible: false,
      reason: "adapter-denylisted",
    });
  });

  it("distinguishes missing, malformed, revoked, future, and expired approvals", () => {
    const missing = input();
    missing.approval = null;
    expect(evaluateLiveAuthorization(missing)).toEqual({ eligible: false, reason: "approval-missing" });

    const malformed = input();
    malformed.approval = { ...structuredClone(approval), extra: "ambiguous" };
    expect(evaluateLiveAuthorization(malformed)).toEqual({ eligible: false, reason: "approval-invalid" });

    const revoked = input();
    revoked.revokedApprovalIds = [approval.approvalId];
    expect(evaluateLiveAuthorization(revoked)).toEqual({ eligible: false, reason: "approval-revoked" });

    const future = input();
    future.nowEpochMs = 500;
    expect(evaluateLiveAuthorization(future)).toEqual({
      eligible: false,
      reason: "approval-not-yet-valid",
    });

    const expired = input();
    expired.nowEpochMs = 10_000;
    expect(evaluateLiveAuthorization(expired)).toEqual({ eligible: false, reason: "approval-expired" });
  });

  it("binds approval to exact build, origin, response class, adapter, and capability set", () => {
    const buildMismatch = input();
    nested(buildMismatch, "build").revision = "e".repeat(40);
    expect(evaluateLiveAuthorization(buildMismatch)).toEqual({ eligible: false, reason: "build-mismatch" });

    const originMismatch = input();
    originMismatch.origin = "https://example.com";
    expect(evaluateLiveAuthorization(originMismatch)).toEqual({ eligible: false, reason: "origin-mismatch" });

    const responseMismatch = input();
    responseMismatch.responseClassId = "other-response-class";
    expect(evaluateLiveAuthorization(responseMismatch)).toEqual({
      eligible: false,
      reason: "response-class-mismatch",
    });

    const adapterMismatch = input();
    nested(adapterMismatch, "adapter").version = "1.0.1";
    expect(evaluateLiveAuthorization(adapterMismatch)).toEqual({ eligible: false, reason: "adapter-mismatch" });

    const capabilityMismatch = input();
    capabilityMismatch.declaredCapabilities = ["transform", "cache"];
    expect(evaluateLiveAuthorization(capabilityMismatch)).toEqual({
      eligible: false,
      reason: "capability-set-mismatch",
    });
  });

  it("requires a current volatile grant and clears it logically on expiry or restart", () => {
    const missing = input();
    missing.grant = null;
    expect(evaluateLiveAuthorization(missing)).toEqual({ eligible: false, reason: "grant-missing" });

    const expired = input();
    expired.nowEpochMs = 5_000;
    expect(evaluateLiveAuthorization(expired)).toEqual({ eligible: false, reason: "grant-expired" });

    const restarted = input();
    restarted.sessionId = "session-after-restart";
    expect(evaluateLiveAuthorization(restarted)).toEqual({
      eligible: false,
      reason: "grant-session-mismatch",
    });
  });

  it("invalidates a grant after emergency or opt-in generation changes", () => {
    const emergencyGenerationChanged = input();
    nested(emergencyGenerationChanged, "safety").generation = 5;
    expect(evaluateLiveAuthorization(emergencyGenerationChanged)).toEqual({
      eligible: false,
      reason: "grant-generation-mismatch",
    });

    const optInGenerationChanged = input();
    nested(optInGenerationChanged, "optIn").generation = 8;
    expect(evaluateLiveAuthorization(optInGenerationChanged)).toEqual({
      eligible: false,
      reason: "grant-generation-mismatch",
    });
  });

  it("rejects grants rebound to another approval, capability, build, or adapter", () => {
    for (const mutate of [
      (candidate: Record<string, unknown>) => {
        nested(candidate, "grant").approvalId = "other-approval";
      },
      (candidate: Record<string, unknown>) => {
        nested(candidate, "grant").capability = "cache";
      },
      (candidate: Record<string, unknown>) => {
        nested(candidate, "grant").buildManifestSha256 = "f".repeat(64);
      },
      (candidate: Record<string, unknown>) => {
        nested(nested(candidate, "grant"), "adapter").version = "9.9.9";
      },
    ]) {
      const candidate = input();
      mutate(candidate);
      expect(evaluateLiveAuthorization(candidate)).toEqual({
        eligible: false,
        reason: "grant-binding-mismatch",
      });
    }
  });

  it("keeps synthetic or unrelated live capabilities isolated", () => {
    const cacheRequest = input();
    cacheRequest.capability = "cache";
    expect(evaluateLiveAuthorization(cacheRequest)).toEqual({
      eligible: false,
      reason: "capability-disabled",
    });

    const widenedPolicy = input();
    widenedPolicy.declaredCapabilities = ["transform", "cache"];
    expect(evaluateLiveAuthorization(widenedPolicy)).toEqual({
      eligible: false,
      reason: "capability-set-mismatch",
    });
  });

  it("fails closed on malformed top-level, build, arrays, and accessor-backed records", () => {
    expect(evaluateLiveAuthorization({})).toEqual({
      eligible: false,
      reason: "authorization-input-invalid",
    });

    const badBuild = input();
    nested(badBuild, "build").buildManifestSha256 = "short";
    expect(evaluateLiveAuthorization(badBuild)).toEqual({
      eligible: false,
      reason: "authorization-input-invalid",
    });

    const duplicatedCapabilities = input();
    duplicatedCapabilities.declaredCapabilities = ["transform", "transform"];
    expect(evaluateLiveAuthorization(duplicatedCapabilities)).toEqual({
      eligible: false,
      reason: "authorization-input-invalid",
    });

    const accessorApproval = input();
    const hostile = structuredClone(approval) as Record<string, unknown>;
    Object.defineProperty(hostile, "approvalId", {
      enumerable: true,
      get() {
        throw new Error("private value");
      },
    });
    accessorApproval.approval = hostile;
    expect(evaluateLiveAuthorization(accessorApproval)).toEqual({
      eligible: false,
      reason: "approval-invalid",
    });
  });
});
