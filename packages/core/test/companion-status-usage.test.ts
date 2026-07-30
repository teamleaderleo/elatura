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

const SESSION = "status-usage-session";

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

function request(
  requestId: string,
  operation: "open" | "status",
  payload: Record<string, unknown>,
): CompanionRequestEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId,
    operation,
    payload,
  };
}

function statusUsage(response: { payload: unknown }): unknown {
  return (response.payload as { usage: unknown }).usage;
}

describe("companion status usage", () => {
  it("matches settled envelope usage for an idle status request", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [],
    });
    const response = await companion.dispatch(
      request("idle-status", "status", { conversationId: null }),
    );

    expect(response.ok).toBe(true);
    expect(statusUsage(response)).toEqual(response.usage);
    expect(response.usage.inFlightRequests).toBe(0);
  });

  it("matches settled usage while another request remains in flight", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "delayed", representation: source() }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = companion.dispatch(
      request("delayed-open", "open", {
        conversationId: "delayed",
        anchorEntryId: null,
        before: 0,
        after: 0,
      }),
      { beforeCommit: () => gate },
    );

    const response = await companion.dispatch(
      request("busy-status", "status", { conversationId: null }),
    );
    expect(response.ok).toBe(true);
    expect(response.usage.inFlightRequests).toBe(1);
    expect(statusUsage(response)).toEqual(response.usage);

    release();
    await delayed;
    expect(companion.usage.inFlightRequests).toBe(0);
  });
});
