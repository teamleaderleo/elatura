// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionOperation,
  type CompanionRequestEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "response-isolation-session";
const ADAPTER = { id: "synthetic-adapter", version: "1.0.0" } as const;

function source(): ReadOnlyRepresentation {
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter: ADAPTER,
    provenance: {
      authority: { origin: "https://synthetic.elatura.invalid" },
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

describe("companion response isolation", () => {
  it("prevents caller mutations from changing resident source metadata", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "isolated", representation: source() }],
    });

    const listed = await companion.dispatch(
      request("list", { cursor: null, limit: 1 }, "isolation-list"),
    );
    expect(listed.ok).toBe(true);
    const listPayload = listed.payload as {
      items: Array<{ adapter: { id: string; version: string } | null }>;
    };
    listPayload.items[0]!.adapter!.id = "mutated-adapter";

    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "isolated",
          anchorEntryId: null,
          before: 0,
          after: 0,
        },
        "isolation-open",
      ),
    );
    expect(opened.ok).toBe(true);
    const page = opened.payload as {
      adapter: { id: string; version: string };
      provenance: {
        adapter: { id: string; version: string };
        freshness: { expiresAt: number };
      };
    };
    page.adapter.id = "mutated-page-adapter";
    page.provenance.adapter.version = "99.0.0";
    page.provenance.freshness.expiresAt = 0;

    const closed = await companion.dispatch(
      request("close", { conversationId: "isolated" }, "isolation-close"),
    );
    expect(closed.ok).toBe(true);

    const reopened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "isolated",
          anchorEntryId: null,
          before: 0,
          after: 0,
        },
        "isolation-reopen",
      ),
    );
    expect(reopened.ok).toBe(true);
    expect((reopened.payload as { adapter: unknown }).adapter).toEqual(ADAPTER);
  });
});
