// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  parseCompanionRequest,
} from "../src/companion.js";

describe("companion request admission", () => {
  it("rejects accessors without invoking them", () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, "version", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("private accessor detail");
      },
    });

    const result = parseCompanionRequest(input);
    expect(result.ok).toBe(false);
    expect(getterCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private accessor detail");
    if (!result.ok) expect(result.issues[0]?.code).toBe("json-accessor");
  });

  it("enforces an explicit serialized request limit", () => {
    const result = parseCompanionRequest({
      version: COMPANION_PROTOCOL_VERSION,
      requestId: "request-1",
      sessionId: "session-1",
      operation: "search",
      conversationId: "conversation-1",
      query: "x".repeat(256),
    }, {
      maxRequestSerializedBytes: 128,
      maxSearchQueryCodeUnits: 512,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("json-serialized-byte-limit");
  });
});
