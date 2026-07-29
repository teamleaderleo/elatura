// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionRequestEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "adapter-identity-session";
const ADAPTER = { id: "chatgpt-conversation", version: "0.3.0" } as const;

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

describe("companion adapter identities", () => {
  it("round-trips dotted adapter versions through runtime and client", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      acceptedAdapters: [ADAPTER],
      conversations: [{ id: "adapter-source", representation: source() }],
    });
    const client = new BoundedCompanionClientState(SESSION);
    expect(client.expect("adapter-open", "open").ok).toBe(true);

    const request: CompanionRequestEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: SESSION,
      requestId: "adapter-open",
      operation: "open",
      payload: {
        conversationId: "adapter-source",
        anchorEntryId: null,
        before: 0,
        after: 0,
      },
    };
    const response = await companion.dispatch(request);

    expect(response.ok).toBe(true);
    expect(client.apply(response).ok).toBe(true);
    expect(client.snapshot.page?.adapter).toEqual(ADAPTER);
  });

  it("rejects malformed configured adapter identities", () => {
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          conversations: [],
          acceptedAdapters: [{ id: "bad adapter", version: "0.3.0" }],
        }),
    ).toThrow(/acceptedAdapters/u);
  });
});
