// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  parseCompanionResponse,
  type CompanionResponseEnvelope,
} from "../src/companion.js";

const SESSION = "response-string-session";
const LARGE_CODE = "x".repeat(300_000);

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

function response(): CompanionResponseEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId: "large-code",
    operation: "code",
    ok: true,
    payload: {
      conversationId: "conversation",
      generation: 0,
      entryId: "entry-0",
      blockIndex: 0,
      block: { text: LARGE_CODE },
    },
    errorCode: null,
    usage,
  };
}

describe("companion response string policy", () => {
  it("uses the configured response string ceiling", () => {
    expect(parseCompanionResponse(response()).ok).toBe(false);
    expect(
      parseCompanionResponse(response(), 2_097_152, LARGE_CODE.length).ok,
    ).toBe(true);
  });

  it("round-trips configured large code through bounded client state", () => {
    const client = new BoundedCompanionClientState(SESSION, {
      maxCodeTextCodeUnits: LARGE_CODE.length,
    });
    expect(client.expect("large-code", "code").ok).toBe(true);
    expect(client.apply(response()).ok).toBe(true);
    expect(client.snapshot.code?.text.length).toBe(LARGE_CODE.length);
  });

  it("rejects client string ceilings below valid reference strings", () => {
    expect(
      () =>
        new BoundedCompanionClientState(SESSION, {
          maxCodeTextCodeUnits: 1,
        }),
    ).toThrow(/maxCodeTextCodeUnits/u);
  });
});
