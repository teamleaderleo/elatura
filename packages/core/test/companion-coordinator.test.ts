// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionOperation,
  type CompanionRequestEnvelope,
  type CompanionResponseEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "coordinator-session";

function representation(ids: readonly string[]): ReadOnlyRepresentation {
  const adapter = { id: "synthetic-adapter", version: "1" };
  const entries = ids.map((id, index) => ({
    id,
    parentId: index === 0 ? null : ids[index - 1]!,
    childIds: index + 1 < ids.length ? [ids[index + 1]!] : [],
    sequence: index,
    kind: "message",
    text: `entry ${index}`,
    codeBlocks: [],
  }));
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
    roots: ids.length === 0 ? [] : [ids[0]!],
    activePath: [...ids],
    entries,
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

function page(response: CompanionResponseEnvelope): {
  cursor: string;
} {
  expect(response.ok).toBe(true);
  return response.payload as { cursor: string };
}

describe("coordinator companion boundary review", () => {
  it("rejects a response ceiling that cannot contain configured success payloads", () => {
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          now: () => 150,
          conversations: [
            {
              id: "atomic",
              representation: representation(["entry-0", "entry-1", "entry-2"]),
            },
          ],
          policy: {
            maxResponseSerializedBytes: 256,
          },
        }),
    ).toThrow(/maxResponseSerializedBytes/u);
  });

  it("accepts its own cursor for a maximum-length conversation id", async () => {
    const conversationId = `c${"x".repeat(127)}`;
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        {
          id: conversationId,
          representation: representation(
            Array.from({ length: 8 }, (_, index) => `entry-${index}`),
          ),
        },
      ],
    });

    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId,
          anchorEntryId: null,
          before: 1,
          after: 0,
        },
        "long-open",
      ),
    );
    const cursor = page(opened).cursor;
    expect(cursor.length).toBeGreaterThan(128);

    const paged = await companion.dispatch(
      request(
        "page",
        {
          conversationId,
          cursor,
          direction: "before",
          limit: 1,
        },
        "long-page",
      ),
    );
    expect(paged.ok).toBe(true);
  });

  it("round-trips representation entry ids beyond ordinary token length", async () => {
    const longEntryId = `e${"y".repeat(128)}`;
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [
        {
          id: "long-entry-source",
          representation: representation([longEntryId]),
        },
      ],
    });
    const client = new BoundedCompanionClientState(SESSION);
    client.expect("long-entry-open", "open");

    const opened = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "long-entry-source",
          anchorEntryId: null,
          before: 0,
          after: 0,
        },
        "long-entry-open",
      ),
    );

    expect(opened.ok).toBe(true);
    expect(client.apply(opened).ok).toBe(true);
    expect(client.snapshot.page?.entries[0]?.id).toBe(longEntryId);

    const entry = await companion.dispatch(
      request(
        "entry",
        {
          conversationId: "long-entry-source",
          entryId: longEntryId,
        },
        "long-entry-read",
      ),
    );
    expect(entry.ok).toBe(true);
  });

  it("admits JSON responses with omitted optional page fields", async () => {
    const source = representation(["entry-0"]);
    source.entries[0] = {
      id: "entry-0",
      parentId: null,
      childIds: [],
      sequence: 0,
      kind: "message",
      codeBlocks: [],
    };
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "optional-fields", representation: source }],
    });
    const client = new BoundedCompanionClientState(SESSION);
    client.expect("optional-open", "open");
    const response = await companion.dispatch(
      request(
        "open",
        {
          conversationId: "optional-fields",
          anchorEntryId: null,
          before: 0,
          after: 0,
        },
        "optional-open",
      ),
    );
    const jsonRoundTrip = JSON.parse(JSON.stringify(response)) as unknown;
    expect(client.apply(jsonRoundTrip).ok).toBe(true);
    expect(client.snapshot.page?.entries[0]).toEqual({
      id: "entry-0",
      parentId: null,
      childCount: 0,
      sequence: 0,
      kind: "message",
      textTruncated: false,
      codeBlockCount: 0,
      active: true,
    });
  });

  it("rejects valid private provenance at the public synthetic entrypoint", () => {
    const privateRepresentation = representation(["entry-0"]);
    privateRepresentation.provenance.synthetic = false;

    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          now: () => 150,
          conversations: [
            {
              id: "private-source",
              representation: privateRepresentation,
            },
          ],
        }),
    ).toThrow(/synthetic provenance only/u);
  });

  it("rejects synthetic representations outside the protocol-v1 id subset", () => {
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          now: () => 150,
          conversations: [
            {
              id: "unsupported-id-source",
              representation: representation(["entry id with spaces"]),
            },
          ],
        }),
    ).toThrow(/protocol-v1 compatible/u);
  });
});
