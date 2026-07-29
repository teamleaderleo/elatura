// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionRequestEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "cancellation-usage-session";

function source(): ReadOnlyRepresentation {
  const adapter = { id: "synthetic-adapter", version: "1" };
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter,
    provenance: {
      authority: { origin: "https://synthetic.elatura.invalid" },
      capturedAt: 100,
      adapter,
      transformation: {
        kind: "alternate-representation",
        id: "synthetic-read-only",
        version: "1",
      },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 1_000, expiresAt: 10_000 },
      synthetic: true,
    },
    roots: ["entry-0"],
    activePath: ["entry-0"],
    entries: [
      {
        id: "entry-0",
        parentId: null,
        childIds: [],
        sequence: 0,
        kind: "message",
        text: "timeline",
        codeBlocks: [],
      },
    ],
  };
}

describe("companion cancellation usage", () => {
  it("reports counters after a rejected pre-commit hook has unwound", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "cancelled", representation: source() }],
    });
    const request: CompanionRequestEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: SESSION,
      requestId: "cancelled-open",
      operation: "open",
      payload: {
        conversationId: "cancelled",
        anchorEntryId: null,
        before: 0,
        after: 0,
      },
    };

    const response = await companion.dispatch(request, {
      beforeCommit: () => Promise.reject(new Error("synthetic cancellation")),
    });

    expect(response).toMatchObject({
      ok: false,
      errorCode: "request-cancelled",
      usage: {
        inFlightRequests: 0,
        queuedPageRequests: 0,
        residentConversationCount: 0,
        residentRecordCount: 0,
      },
    });
    expect(response.usage).toEqual(companion.usage);
  });
});
