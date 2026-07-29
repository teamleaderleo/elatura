// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionOperation,
  type CompanionRequestEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "optional-fields-session";

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
        text: "needle",
        codeBlocks: [{ text: "const value = 1;" }],
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

describe("companion client optional fields", () => {
  it("accepts omitted page labels, jump references, search labels, and code languages", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "optional", representation: source() }],
    });
    const client = new BoundedCompanionClientState(SESSION);

    client.expect("open-optional", "open");
    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "optional",
          anchorEntryId: null,
          before: 0,
          after: 0,
        },
        "open-optional",
      ),
    );
    expect(client.apply(opened).ok).toBe(true);
    expect(client.snapshot.page?.entries[0]).toMatchObject({
      id: "entry-0",
      text: "needle",
    });
    expect(client.snapshot.page?.entries[0]).not.toHaveProperty("label");
    expect(client.snapshot.page?.entries[0]).not.toHaveProperty("jumpBackReference");

    client.expect("search-optional", "search");
    const searched = await companion.dispatch(
      request(
        "search",
        { conversationId: "optional", query: "needle", limit: 1 },
        "search-optional",
      ),
    );
    expect(client.apply(searched).ok).toBe(true);
    expect(client.snapshot.searchResults[0]).toMatchObject({
      entryId: "entry-0",
      snippet: "needle",
    });
    expect(client.snapshot.searchResults[0]).not.toHaveProperty("label");

    client.expect("code-optional", "code");
    const coded = await companion.dispatch(
      request(
        "code",
        { conversationId: "optional", entryId: "entry-0", blockIndex: 0 },
        "code-optional",
      ),
    );
    expect(client.apply(coded).ok).toBe(true);
    expect(client.snapshot.code).toMatchObject({
      conversationId: "optional",
      entryId: "entry-0",
      blockIndex: 0,
      text: "const value = 1;",
    });
    expect(client.snapshot.code).not.toHaveProperty("language");
  });
});
