// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildObservationReport,
  OBSERVATION_ACTIVE_REQUEST_LIMIT,
  OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES,
  type StoredObservationState,
} from "../src/report.js";

type MessageListener = (message: unknown) => unknown;
type BeforeRequestListener = (details: {
  requestId: string;
  url: string;
  method: string;
  type: string;
  timeStamp: number;
}) => void;

type TestFilter = {
  ondata: ((event: { data: ArrayBuffer }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const metadata = {
  extensionVersion: "0.0.6",
  browser: { name: "Firefox", vendor: "Mozilla", version: "140.0", buildID: "build" },
};

function createHarness(
  initialStorage: Record<string, unknown> = {},
  failRequestIds: ReadonlySet<string> = new Set(),
) {
  let stored = structuredClone(initialStorage);
  let messageListener: MessageListener | undefined;
  let beforeRequestListener: BeforeRequestListener | undefined;
  const filters = new Map<string, TestFilter>();

  const local = {
    get: vi.fn(async () => structuredClone(stored)),
    set: vi.fn(async (values: Record<string, unknown>) => {
      stored = structuredClone(values);
    }),
    clear: vi.fn(async () => {
      stored = {};
    }),
  };
  const filterResponseData = vi.fn((requestId: string) => {
    if (failRequestIds.has(requestId)) throw new Error("filter unavailable");
    const filter: TestFilter = {
      ondata: null,
      onstop: null,
      onerror: null,
      write: vi.fn(),
      close: vi.fn(),
      disconnect: vi.fn(),
    };
    filters.set(requestId, filter);
    return filter;
  });

  vi.stubGlobal("browser", {
    storage: { local },
    runtime: {
      onMessage: {
        addListener(listener: MessageListener) {
          messageListener = listener;
        },
      },
    },
    webRequest: {
      onBeforeRequest: {
        addListener(listener: BeforeRequestListener) {
          beforeRequestListener = listener;
        },
      },
      filterResponseData,
    },
  });

  const fireRequest = (details: Parameters<BeforeRequestListener>[0]): TestFilter | undefined => {
    if (!beforeRequestListener) throw new Error("Request listener was not registered.");
    beforeRequestListener(details);
    return filters.get(details.requestId);
  };

  return {
    local,
    filters,
    filterResponseData,
    message(message: unknown) {
      if (!messageListener) throw new Error("Message listener was not registered.");
      return messageListener(message);
    },
    fireRequest,
    request(details: Parameters<BeforeRequestListener>[0]) {
      const filter = fireRequest(details);
      if (!filter) throw new Error(`No filter was created for ${details.requestId}.`);
      return filter;
    },
  };
}

async function loadBackground() {
  vi.resetModules();
  await import("../src/background.js");
}

function legacyActiveState(pathTemplate = "/:word-m"): Record<string, unknown> {
  return {
    storageSchemaVersion: 3,
    activeRun: { id: "resumed-run", startedAt: "2026-07-29T00:00:00.000Z" },
    summary: {
      requestCount: 1,
      totalBytesObserved: 10,
      totalRequestDurationMs: 5,
      requestErrorCount: 0,
    },
    requestPaths: {
      [pathTemplate]: {
        pathTemplate,
        count: 1,
        bytes: 10,
        durationMs: 5,
        maxDurationMs: 5,
        errors: 0,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
    },
    pageMarks: { domContentLoadedMs: null, composerReadyMs: null },
    integrity: {
      pathClassLimit: 256,
      pathClassOverflowed: false,
      overflowRequestCount: 0,
      persistenceErrorCount: 0,
      captureInterruptionCount: 0,
    },
  };
}

function requestDetails(requestId: string) {
  return {
    requestId,
    url: `https://chatgpt.com/${requestId}`,
    method: "GET",
    type: "xmlhttprequest",
    timeStamp: 0,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("observer background lifecycle", () => {
  it("clears legacy active state that contains literal path content", async () => {
    const harness = createHarness(legacyActiveState("/private-project"));
    await loadBackground();

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(state.storageSchemaVersion).toBe(5);
    expect(state.activeRun).toBeUndefined();
    expect(state.summary.requestCount).toBe(0);
    expect(harness.local.clear).toHaveBeenCalled();
  });

  it("migrates and marks a resumed active run as interrupted", async () => {
    const harness = createHarness(legacyActiveState());
    await loadBackground();

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(state.storageSchemaVersion).toBe(5);
    expect(state.integrity.captureInterruptionCount).toBe(1);
    expect(state.integrity.activeRequestCount).toBe(0);
    expect(state.integrity.persistenceErrorCount).toBe(0);
    expect(harness.local.set).toHaveBeenCalled();
  });

  it("passes arbitrary chunks through byte-for-byte and serializes concurrent completion", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });

    const first = harness.request(requestDetails("first"));
    const second = harness.request({ ...requestDetails("second"), method: "POST", type: "other" });
    const chunkA = new Uint8Array([1, 2]).buffer;
    const chunkB = new Uint8Array([3]).buffer;
    const chunkC = new Uint8Array([4, 5]).buffer;
    first.ondata?.({ data: chunkA });
    first.ondata?.({ data: chunkB });
    second.ondata?.({ data: chunkC });
    second.onerror?.();
    first.onstop?.();
    first.onstop?.();

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(first.write.mock.calls.map((call: unknown[]) => call[0])).toEqual([chunkA, chunkB]);
    expect(second.write.mock.calls.map((call: unknown[]) => call[0])).toEqual([chunkC]);
    expect(second.disconnect).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledTimes(2);
    expect(state.integrity.activeRequestCount).toBe(0);
    expect(state.summary).toMatchObject({ requestCount: 2, totalBytesObserved: 5, requestErrorCount: 1 });
  });

  it("marks an export incomplete until the active response completes", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });
    const filter = harness.request(requestDetails("inflight"));
    const chunk = new Uint8Array([1, 2, 3, 4]).buffer;
    filter.ondata?.({ data: chunk });

    const during = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    const interruptedExport = buildObservationReport(during, metadata);
    expect(during.integrity.activeRequestCount).toBe(1);
    expect(interruptedExport.integrity.totalsComplete).toBe(false);
    expect(interruptedExport.summary.requestCount).toBe(0);

    filter.onstop?.();
    const after = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    const completeExport = buildObservationReport(after, metadata);
    expect(after.integrity.activeRequestCount).toBe(0);
    expect(completeExport.integrity.totalsComplete).toBe(true);
    expect(completeExport.summary).toMatchObject({ requestCount: 1, totalBytesObserved: 4 });
  });

  it("bounds active observer state and records capacity gaps during a synthetic storm", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });

    for (let index = 0; index < OBSERVATION_ACTIVE_REQUEST_LIMIT; index += 1) {
      const filter = harness.request(requestDetails(`storm-${index}`));
      filter.ondata?.({ data: new Uint8Array([index % 256]).buffer });
    }
    for (let index = 0; index < 7; index += 1) {
      expect(harness.fireRequest(requestDetails(`overflow-${index}`))).toBeUndefined();
    }

    const saturated = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(saturated.integrity.activeRequestCount).toBe(OBSERVATION_ACTIVE_REQUEST_LIMIT);
    expect(saturated.integrity.unobservedRequestCount).toBe(7);
    expect(harness.filterResponseData).toHaveBeenCalledTimes(OBSERVATION_ACTIVE_REQUEST_LIMIT);
    expect(buildObservationReport(saturated, metadata).integrity.totalsComplete).toBe(false);

    for (const filter of harness.filters.values()) filter.onstop?.();
    const completed = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(completed.integrity.activeRequestCount).toBe(0);
    expect(completed.summary.requestCount).toBe(OBSERVATION_ACTIVE_REQUEST_LIMIT);
    expect(completed.summary.totalBytesObserved).toBe(OBSERVATION_ACTIVE_REQUEST_LIMIT);
    expect(completed.integrity.unobservedRequestCount).toBe(7);
  });

  it("records filter attachment failure as an unobserved request", async () => {
    const harness = createHarness({}, new Set(["unavailable"]));
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });
    expect(harness.fireRequest(requestDetails("unavailable"))).toBeUndefined();

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(state.integrity.unobservedRequestCount).toBe(1);
    expect(buildObservationReport(state, metadata).integrity.totalsComplete).toBe(false);
  });

  it("flags an oversized response while preserving exact counting and pass-through", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });
    const filter = harness.request(requestDetails("large"));
    const largeChunk = { byteLength: OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES + 1 } as ArrayBuffer;
    filter.ondata?.({ data: largeChunk });
    filter.onstop?.();

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(filter.write).toHaveBeenCalledWith(largeChunk);
    expect(state.summary.totalBytesObserved).toBe(OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES + 1);
    expect(state.integrity.oversizedResponseCount).toBe(1);
    expect(buildObservationReport(state, metadata).integrity.totalsComplete).toBe(true);
  });

  it("clears an active run without interrupting pass-through or accepting stale marks", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });
    const filter = harness.request(requestDetails("active"));

    await harness.message({ type: "elatura:clear-run" });
    const chunk = new Uint8Array([9, 8, 7]).buffer;
    filter.ondata?.({ data: chunk });
    filter.onstop?.();
    await harness.message({
      type: "elatura:page-metric",
      metric: {
        kind: "composer-like-input",
        elapsedMs: 10,
        recordedAt: "2000-01-01T00:00:00.000Z",
      },
    });

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(filter.write).toHaveBeenCalledWith(chunk);
    expect(state.activeRun).toBeUndefined();
    expect(state.summary).toEqual({
      requestCount: 0,
      totalBytesObserved: 0,
      totalRequestDurationMs: 0,
      requestErrorCount: 0,
    });
    expect(state.integrity.activeRequestCount).toBe(0);
    expect(state.pageMarks.composerReadyMs).toBeNull();
  });

  it("surfaces a storage failure in the active run integrity state", async () => {
    const harness = createHarness();
    await loadBackground();
    harness.local.set.mockRejectedValueOnce(new Error("quota"));
    await harness.message({ type: "elatura:start-run" });

    const state = (await harness.message({ type: "elatura:get-state" })) as StoredObservationState;
    expect(state.integrity.persistenceErrorCount).toBe(1);
  });
});
