// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionClientState,
  COMPANION_PROTOCOL_VERSION,
  SyntheticCompanion,
  parseCompanionRequest,
  parseCompanionResponse,
  type CompanionRequestEnvelope,
  type CompanionResponseEnvelope,
} from "../src/companion.js";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "own-fields-session";

const usage = Object.freeze({
  residentConversationCount: 0,
  residentRecordCount: 0,
  residentEntryCount: 0,
  residentTextCodeUnits: 0,
  residentSerializedBytes: 0,
  residentAccountedBytes: 0,
  inFlightRequests: 0,
  queuedPageRequests: 0,
});

function withPrototypeValue<T>(
  key: string,
  value: unknown,
  action: () => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
  try {
    return action();
  } finally {
    if (previous) {
      Object.defineProperty(Object.prototype, key, previous);
    } else {
      Reflect.deleteProperty(Object.prototype, key);
    }
  }
}

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

describe("companion own-field admission", () => {
  it("rejects inherited request and response envelope fields", () => {
    const request = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: SESSION,
      requestId: "inherited-request",
      operation: "revoke",
    };
    expect(
      withPrototypeValue("payload", {}, () => parseCompanionRequest(request).ok),
    ).toBe(false);

    const response = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: SESSION,
      requestId: "inherited-response",
      operation: "revoke",
      ok: false,
      errorCode: "invalid-request",
      usage,
    };
    expect(
      withPrototypeValue("payload", null, () => parseCompanionResponse(response).ok),
    ).toBe(false);
  });

  it("rejects inherited required fields inside client page entries", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "own-fields", representation: source() }],
    });
    const request: CompanionRequestEnvelope = {
      version: COMPANION_PROTOCOL_VERSION,
      sessionId: SESSION,
      requestId: "own-fields-open",
      operation: "open",
      payload: {
        conversationId: "own-fields",
        anchorEntryId: null,
        before: 0,
        after: 0,
      },
    };
    const response = structuredClone(
      await companion.dispatch(request),
    ) as CompanionResponseEnvelope;
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      entries: Array<Record<string, unknown>>;
    };
    delete payload.entries[0]!.active;

    const client = new BoundedCompanionClientState(SESSION);
    expect(client.expect("own-fields-open", "open").ok).toBe(true);
    const accepted = withPrototypeValue(
      "active",
      true,
      () => client.apply(response).ok,
    );
    expect(accepted).toBe(false);
    expect(client.snapshot.pendingRequestCount).toBe(1);
    expect(client.snapshot.page).toBeNull();
    expect(client.cancel("own-fields-open")).toBe(true);
  });
});
