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

const SESSION = "conversation-admission-session";

function source(): ReadOnlyRepresentation {
  const adapter = { id: "synthetic-adapter", version: "1.0.0" };
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

describe("companion conversation admission", () => {
  it("preserves undefined malformed fixtures as corrupt metadata", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "undefined-source", representation: undefined }],
    });
    const request: CompanionRequestEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: SESSION,
      requestId: "list-undefined-source",
      operation: "list",
      payload: { cursor: null, limit: 1 },
    };
    const response = await companion.dispatch(request);

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      items: [
        {
          id: "undefined-source",
          entryCount: 0,
          adapter: null,
          freshness: "corrupt",
        },
      ],
    });
  });

  it("does not invoke representation accessors", () => {
    let invoked = false;
    const hostile = Object.defineProperties(
      { id: "hostile-source" },
      {
        representation: {
          enumerable: true,
          get() {
            invoked = true;
            return source();
          },
        },
      },
    );

    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          conversations: [
            hostile as unknown as { id: string; representation: unknown },
          ],
        }),
    ).toThrow(/conversations/u);
    expect(invoked).toBe(false);
  });

  it("does not invoke overridden conversation-array methods", () => {
    let invoked = false;
    const conversations = [{ id: "safe-source", representation: source() }];
    Object.defineProperty(conversations, "map", {
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
          conversations,
        }),
    ).not.toThrow();
    expect(invoked).toBe(false);
  });
});
