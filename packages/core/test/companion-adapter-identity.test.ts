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

function openRequest(requestId: string): CompanionRequestEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId,
    operation: "open",
    payload: {
      conversationId: "adapter-source",
      anchorEntryId: null,
      before: 0,
      after: 0,
    },
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

    const response = await companion.dispatch(openRequest("adapter-open"));

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

  it("does not invoke adapter identity accessors", () => {
    let invoked = false;
    const hostile = Object.defineProperties({}, {
      id: {
        enumerable: true,
        get() {
          invoked = true;
          return "chatgpt-conversation";
        },
      },
      version: {
        enumerable: true,
        value: "0.3.0",
      },
    });

    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          conversations: [],
          acceptedAdapters: [hostile as unknown as typeof ADAPTER],
        }),
    ).toThrow(/acceptedAdapters/u);
    expect(invoked).toBe(false);
  });

  it("does not invoke overridden adapter-array methods", () => {
    let invoked = false;
    const identities = [ADAPTER];
    Object.defineProperty(identities, "map", {
      configurable: true,
      get() {
        invoked = true;
        throw new Error("map must remain untouched");
      },
    });

    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          conversations: [],
          acceptedAdapters: identities,
        }),
    ).not.toThrow();
    expect(invoked).toBe(false);
  });

  it("rejects malformed adapter updates before changing drift state", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      acceptedAdapters: [ADAPTER],
      conversations: [{ id: "adapter-source", representation: source() }],
    });
    const opened = await companion.dispatch(openRequest("before-invalid-update"));
    expect(opened.ok).toBe(true);
    expect(companion.usage.residentRecordCount).toBe(1);

    expect(
      () =>
        companion.updateAcceptedAdapters([
          { id: "bad adapter", version: "0.3.0" },
        ]),
    ).toThrow(/acceptedAdapters/u);
    expect(companion.usage.residentRecordCount).toBe(1);

    const reopened = await companion.dispatch(openRequest("after-invalid-update"));
    expect(reopened.ok).toBe(true);
  });
});
