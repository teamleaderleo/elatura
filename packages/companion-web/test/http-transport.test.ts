// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type {
  CompanionRequestEnvelope,
  CompanionResponseEnvelope,
} from "@elatura/core/companion";
import {
  COMPANION_PROTOCOL_PATH,
  HttpCompanionTransport,
} from "../src/http-companion-transport.js";
import { BoundedBrowserRequestLedger } from "../src/browser-request-ledger.js";

const ORIGIN = "http://synthetic-loopback.invalid:4173";

function listRequest(requestId: string): CompanionRequestEnvelope {
  return {
    version: 1,
    sessionId: "transport-session",
    requestId,
    operation: "list",
    payload: { cursor: null, limit: 10 },
  };
}

function envelopeFor(request: CompanionRequestEnvelope): CompanionResponseEnvelope {
  return {
    version: 1,
    sessionId: request.sessionId,
    requestId: request.requestId,
    operation: request.operation,
    ok: true,
    payload: { items: [], nextCursor: null },
    errorCode: null,
    usage: {
      residentConversationCount: 0,
      residentRecordCount: 0,
      residentEntryCount: 0,
      residentTextCodeUnits: 0,
      residentSerializedBytes: 0,
      residentAccountedBytes: 0,
      inFlightRequests: 0,
      queuedPageRequests: 0,
    },
  };
}

function okTransport(raw = JSON.stringify(envelopeFor(listRequest("r1")))) {
  const calls: { url: string; body: string; signal?: AbortSignal }[] = [];
  return {
    calls,
    transport: new HttpCompanionTransport({
      origin: ORIGIN,
      ledger: new BoundedBrowserRequestLedger(),
      post: async (url, body, signal) => {
        calls.push({ url, body, signal });
        return raw;
      },
    }),
  };
}

describe("HttpCompanionTransport", () => {
  it("posts bounded JSON to exactly one fixed same-origin protocol path", async () => {
    const { transport, calls } = okTransport();
    const response = await transport.dispatch(listRequest("r1"));
    expect(response.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ORIGIN}${COMPANION_PROTOCOL_PATH}`);
    const parsedBody = JSON.parse(calls[0]!.body) as CompanionRequestEnvelope;
    expect(parsedBody.operation).toBe("list");
    expect(parsedBody.version).toBe(1);
  });

  it("records the settled request into the separately bounded ledger", async () => {
    const ledger = new BoundedBrowserRequestLedger();
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      post: async () => JSON.stringify(envelopeFor(listRequest("ledger-1"))),
    });
    await transport.dispatch(listRequest("ledger-1"));
    const snapshot = ledger.snapshot;
    expect(snapshot.completedRequestCount).toBe(1);
    expect(snapshot.cacheEntryCount).toBe(1);
    expect(snapshot.cacheTotalBytes).toBeGreaterThan(0);
    expect(transport.snapshot.dispatchedRequestCount).toBe(1);
    expect(transport.snapshot.inFlightRequestCount).toBe(0);
  });

  it("refuses origins that are not fixed HTTP(S) origins", () => {
    const ledger = new BoundedBrowserRequestLedger();
    for (const hostile of [
      "https://example.invalid/some/path",
      "http://user:secret@host.invalid",
      "//cdn.example.invalid",
      "ftp://host.invalid",
      "https://host.invalid/path?query=1",
    ]) {
      expect(
        () =>
          new HttpCompanionTransport({
            origin: hostile as string,
            ledger,
            post: async () => "",
          }),
      ).toThrow(TypeError);
    }
  });

  it("converts pre-aborted and in-flight aborts into cancellations", async () => {
    const ledger = new BoundedBrowserRequestLedger();
    const controller = new AbortController();
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      post: async (_url, _body, signal) => {
        controller.abort();
        signal?.throwIfAborted();
        return "";
      },
    });
    await expect(
      transport.dispatch(listRequest("cancel-1"), controller.signal),
    ).rejects.toMatchObject({ message: "request-cancelled" });
    expect(ledger.snapshot.cancelledRequestCount).toBe(1);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      transport.dispatch(listRequest("cancel-2"), preAborted.signal),
    ).rejects.toMatchObject({ message: "request-cancelled" });
    expect(ledger.snapshot.cancelledRequestCount).toBe(2);
  });

  it("maps network failures to a failed-transport rejection with accounting", async () => {
    const ledger = new BoundedBrowserRequestLedger();
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      post: async () => {
        throw new Error("connection refused");
      },
    });
    await expect(transport.dispatch(listRequest("fail-1"))).rejects.toMatchObject({
      message: "transport-post-failed",
    });
    expect(ledger.snapshot.failedRequestCount).toBe(1);
    expect(ledger.snapshot.completedRequestCount).toBe(0);
  });

  it("refuses responses beyond the serialized byte ceiling before parsing", async () => {
    const { transport } = okTransport("x".repeat(2_097_153));
    await expect(transport.dispatch(listRequest("big"))).rejects.toMatchObject({
      message: "response-over-serialized-limit",
    });
  });

  it("refuses non-JSON and structurally invalid envelopes", async () => {
    const notJson = okTransport("<html>not json</html>");
    await expect(notJson.transport.dispatch(listRequest("bad-json"))).rejects.toMatchObject({
      message: "response-not-json",
    });

    const wrongShape = okTransport(JSON.stringify({ hello: true }));
    await expect(wrongShape.transport.dispatch(listRequest("bad-shape"))).rejects.toMatchObject({
      message: "response-envelope-invalid",
    });
  });

  it("refuses oversized request serializations without dispatching", async () => {
    const ledger = new BoundedBrowserRequestLedger();
    let called = 0;
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      maxRequestSerializedBytes: 64,
      post: async () => {
        called += 1;
        return "{}";
      },
    });
    const oversized = listRequest("oversized");
    oversized.payload = {
      cursor: null,
      limit: 10,
      filler: "x".repeat(256),
    };
    await expect(transport.dispatch(oversized)).rejects.toMatchObject({
      message: "request-over-serialized-limit",
    });
    expect(called).toBe(0);
  });

  it("refuses multibyte request bodies by true UTF-8 wire bytes, not code units", async () => {
    const ledger = new BoundedBrowserRequestLedger();
    let called = 0;
    const multibyte = listRequest("multibyte");
    // Each "é" is one UTF-16 code unit but two UTF-8 wire bytes, so the
    // serialization is 8 code units long but 16% larger on the wire.
    multibyte.payload = { cursor: null, limit: 10, filler: "é".repeat(8) };
    const serialized = JSON.stringify(multibyte);
    const unitLength = serialized.length;
    const byteLength = Buffer.byteLength(serialized, "utf8");
    expect(byteLength).toBeGreaterThan(unitLength);
    // A ceiling at byteLength - 1 admits the code-unit length yet must
    // refuse the encoded wire size, proving the check measures bytes.
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      maxRequestSerializedBytes: byteLength - 1,
      post: async () => {
        called += 1;
        return "{}";
      },
    });
    await expect(transport.dispatch(multibyte)).rejects.toMatchObject({
      message: "request-over-serialized-limit",
    });
    expect(called).toBe(0);
    expect(ledger.snapshot.dispatchedRequestCount).toBe(1);
    expect(ledger.snapshot.completedRequestCount).toBe(0);
  });

  it("refuses multibyte responses by true UTF-8 wire bytes before parsing", async () => {
    const ledger = new BoundedBrowserRequestLedger({ maxCacheEntryBytes: 16 });
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      maxResponseSerializedBytes: 20,
      post: async () => "é".repeat(15),
    });
    await expect(transport.dispatch(listRequest("multibyte-resp"))).rejects
      .toMatchObject({ message: "response-over-serialized-limit" });
    const snapshot = ledger.snapshot;
    expect(snapshot.refusedOverLimitRequestCount).toBe(1);
    expect(snapshot.cacheEntryCount).toBe(0);
    expect(snapshot.logEntryCount).toBe(1);
  });

  it("records true UTF-8 wire-byte counts into the ledger", async () => {
    const ledger = new BoundedBrowserRequestLedger();
    const envelope = envelopeFor(listRequest("bytes-1"));
    const raw = JSON.stringify({
      ...envelope,
      payload: { items: [], nextCursor: "é" },
    });
    const transport = new HttpCompanionTransport({
      origin: ORIGIN,
      ledger,
      post: async () => raw,
    });
    await transport.dispatch(listRequest("bytes-1"));
    // The cached footprint is the encoded wire size; the two-byte character
    // makes it exceed the decoded code-unit count.
    expect(ledger.snapshot.cacheTotalBytes).toBe(Buffer.byteLength(raw, "utf8"));
    expect(ledger.snapshot.cacheTotalBytes).toBeGreaterThan(raw.length - 1);
  });
});
