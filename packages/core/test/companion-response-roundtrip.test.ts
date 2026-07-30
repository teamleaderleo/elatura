// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  parseCompanionResponse,
  type CompanionOperation,
  type CompanionPagePayload,
  type CompanionRequestEnvelope,
  type CompanionResponseEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "response-roundtrip-session";
const ADAPTER = { id: "synthetic-adapter", version: "1.0.0" } as const;

function source(): ReadOnlyRepresentation {
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter: ADAPTER,
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/timeline",
      },
      capturedAt: 100,
      adapter: ADAPTER,
      transformation: {
        kind: "alternate-representation",
        id: "synthetic-read-only",
        version: "1.0.0",
      },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 1_000, expiresAt: 10_000 },
      synthetic: true,
    },
    roots: ["entry-0"],
    activePath: ["entry-0", "entry-1", "entry-2"],
    entries: [
      {
        id: "entry-0",
        parentId: null,
        childIds: ["entry-1"],
        sequence: 0,
        kind: "message",
        text: "first searchable",
        codeBlocks: [],
      },
      {
        id: "entry-1",
        parentId: "entry-0",
        childIds: ["entry-2"],
        sequence: 1,
        kind: "message",
        text: "second searchable",
        codeBlocks: [{ text: "const value = 1;" }],
      },
      {
        id: "entry-2",
        parentId: "entry-1",
        childIds: [],
        sequence: 2,
        kind: "message",
        text: "third searchable",
        codeBlocks: [],
      },
    ],
  };
}

function request(
  operation: CompanionOperation,
  payload: Record<string, unknown>,
  requestId: string,
): CompanionRequestEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId,
    operation,
    payload,
  };
}

function expectParses(response: CompanionResponseEnvelope): void {
  expect(response.ok).toBe(true);
  expect(parseCompanionResponse(response).ok).toBe(true);
}

describe("companion response round-trip", () => {
  it("parses every successful runtime operation", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "roundtrip", representation: source() }],
    });

    const listed = await companion.dispatch(
      request("list", { cursor: null, limit: 10 }, "roundtrip-list"),
    );
    expectParses(listed);

    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "roundtrip",
          anchorEntryId: "entry-1",
          before: 0,
          after: 0,
        },
        "roundtrip-open",
      ),
    );
    expectParses(opened);
    const cursor = (opened.payload as CompanionPagePayload).cursor;

    expectParses(
      await companion.dispatch(
        request(
          "page",
          {
            conversationId: "roundtrip",
            cursor,
            direction: "before",
            limit: 1,
          },
          "roundtrip-page",
        ),
      ),
    );
    expectParses(
      await companion.dispatch(
        request(
          "entry",
          { conversationId: "roundtrip", entryId: "entry-1" },
          "roundtrip-entry",
        ),
      ),
    );
    expectParses(
      await companion.dispatch(
        request(
          "code",
          {
            conversationId: "roundtrip",
            entryId: "entry-1",
            blockIndex: 0,
          },
          "roundtrip-code",
        ),
      ),
    );
    expectParses(
      await companion.dispatch(
        request(
          "search",
          { conversationId: "roundtrip", query: "searchable", limit: 2 },
          "roundtrip-search",
        ),
      ),
    );
    expectParses(
      await companion.dispatch(
        request(
          "navigate",
          { conversationId: "roundtrip", entryId: "entry-1" },
          "roundtrip-navigate",
        ),
      ),
    );
    expectParses(
      await companion.dispatch(
        request(
          "status",
          { conversationId: "roundtrip" },
          "roundtrip-status",
        ),
      ),
    );
    expectParses(
      await companion.dispatch(
        request("close", { conversationId: "roundtrip" }, "roundtrip-close"),
      ),
    );
    expectParses(
      await companion.dispatch(
        request("revoke", {}, "roundtrip-revoke"),
      ),
    );
  });
});
