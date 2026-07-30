// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  type CompanionRequestEnvelope,
} from "@elatura/core/companion";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "@elatura/core/representation";
import { InProcessCompanionTransport } from "../src/transport.js";

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

function listRequest(requestId: string): CompanionRequestEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: "transport-session",
    requestId,
    operation: "list",
    payload: { cursor: null, limit: 10 },
  };
}

describe("InProcessCompanionTransport", () => {
  it("dispatches through the guarded companion without retaining responses", async () => {
    const companion = new SyntheticCompanion({
      sessionId: "transport-session",
      now: () => 150,
      conversations: [{ id: "conversation", representation: source() }],
    });
    const transport = new InProcessCompanionTransport(companion);
    const response = await transport.dispatch(listRequest("list-success"));

    expect(response.ok).toBe(true);
    expect(transport.snapshot).toEqual({
      dispatchedRequestCount: 1,
      completedRequestCount: 1,
      cancelledRequestCount: 0,
      inFlightRequestCount: 0,
    });
  });

  it("converts an aborted local request into the bounded cancellation channel", async () => {
    const companion = new SyntheticCompanion({
      sessionId: "transport-session",
      now: () => 150,
      conversations: [{ id: "conversation", representation: source() }],
    });
    const transport = new InProcessCompanionTransport(companion);
    const controller = new AbortController();
    const pending = transport.dispatch(listRequest("list-cancelled"), controller.signal);
    controller.abort();
    const response = await pending;

    expect(response.errorCode).toBe("request-cancelled");
    expect(transport.snapshot).toEqual({
      dispatchedRequestCount: 1,
      completedRequestCount: 0,
      cancelledRequestCount: 1,
      inFlightRequestCount: 0,
    });
  });
});
