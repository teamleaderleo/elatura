// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  parseCompanionResponse,
  type CompanionOperation,
  type CompanionResponseEnvelope,
} from "../src/companion.js";

const SESSION = "success-payload-session";

const usage = Object.freeze({
  residentConversationCount: 0,
  residentRecordCount: 0,
  residentEntryCount: 0,
  residentTextCodeUnits: 0,
  residentSerializedBytes: 0,
  residentAccountedBytes: 0,
  inFlightRequests: 0,
  queuedPageRequests: 0,
});

function success(
  operation: CompanionOperation,
  payload: unknown,
  requestId = `${operation}-success`,
): CompanionResponseEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId,
    operation,
    ok: true,
    payload,
    errorCode: null,
    usage,
  };
}

describe("companion success payload contracts", () => {
  it("requires exact operation payload fields", () => {
    expect(parseCompanionResponse(success("revoke", { revoked: false })).ok).toBe(false);
    expect(
      parseCompanionResponse(success("revoke", { revoked: true, hidden: "field" })).ok,
    ).toBe(false);
    expect(
      parseCompanionResponse(
        success("status", {
          active: true,
          sessionExpiresAt: 1_000,
          conversation: null,
          usage,
          hidden: "field",
        }),
      ).ok,
    ).toBe(false);
    expect(parseCompanionResponse(success("revoke", { revoked: true })).ok).toBe(true);
  });

  it("does not clear client ownership for a rejected revoke payload", () => {
    const client = new BoundedCompanionClientState(SESSION);
    expect(client.expect("revoke-client", "revoke").ok).toBe(true);

    const rejected = client.apply(
      success("revoke", { revoked: false }, "revoke-client"),
    );
    expect(rejected.ok).toBe(false);
    expect(client.snapshot.pendingRequestCount).toBe(1);

    const accepted = client.apply(
      success("revoke", { revoked: true }, "revoke-client"),
    );
    expect(accepted.ok).toBe(true);
    expect(client.snapshot.pendingRequestCount).toBe(0);
  });
});
