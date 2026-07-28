// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from "vitest";

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

function createHarness(initialStorage: Record<string, unknown> = {}) {
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
      filterResponseData(requestId: string) {
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
      },
    },
  });

  return {
    local,
    filters,
    message(message: unknown) {
      if (!messageListener) throw new Error("Message listener was not registered.");
      return messageListener(message);
    },
    request(details: Parameters<BeforeRequestListener>[0]) {
      if (!beforeRequestListener) throw new Error("Request listener was not registered.");
      beforeRequestListener(details);
      const filter = filters.get(details.requestId);
      if (!filter) throw new Error(`No filter was created for ${details.requestId}.`);
      return filter;
    },
  };
}

async function loadBackground() {
  vi.resetModules();
  await import("../src/background.js");
}

function activeState(pathTemplate: string): Record<string, unknown> {
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("observer background lifecycle", () => {
  it("clears legacy active state that contains literal path content", async () => {
    const harness = createHarness(activeState("/private-project"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadBackground();

    const state = (await harness.message({ type: "elatura:get-state" })) as {
      storageSchemaVersion: number;
      activeRun?: unknown;
      summary: { requestCount: number };
    };
    expect(state.storageSchemaVersion).toBe(4);
    expect(state.activeRun).toBeUndefined();
    expect(state.summary.requestCount).toBe(0);
    expect(harness.local.clear).toHaveBeenCalled();
  });

  it("migrates a safe active run and marks resumed capture interrupted", async () => {
    const harness = createHarness(activeState("/:word-m"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadBackground();

    const state = (await harness.message({ type: "elatura:get-state" })) as {
      storageSchemaVersion: number;
      requestPaths: Record<string, unknown>;
      integrity: { captureInterruptionCount: number; persistenceErrorCount: number };
    };
    expect(state.storageSchemaVersion).toBe(4);
    expect(state.requestPaths).toHaveProperty("/:word-m");
    expect(state.integrity.captureInterruptionCount).toBe(1);
    expect(state.integrity.persistenceErrorCount).toBe(0);
    expect(harness.local.set).toHaveBeenCalled();
  });

  it("passes arbitrary chunks through byte-for-byte and serializes concurrent completion", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });

    const first = harness.request({
      requestId: "first",
      url: "https://chatgpt.com/a",
      method: "GET",
      type: "xmlhttprequest",
      timeStamp: 0,
    });
    const second = harness.request({
      requestId: "second",
      url: "https://chatgpt.com/b",
      method: "POST",
      type: "other",
      timeStamp: 0,
    });
    const chunkA = new Uint8Array([1, 2]).buffer;
    const chunkB = new Uint8Array([3]).buffer;
    const chunkC = new Uint8Array([4, 5]).buffer;
    first.ondata?.({ data: chunkA });
    first.ondata?.({ data: chunkB });
    second.ondata?.({ data: chunkC });
    second.onerror?.();
    first.onstop?.();
    first.onstop?.();

    const state = (await harness.message({ type: "elatura:get-state" })) as {
      summary: { requestCount: number; totalBytesObserved: number; requestErrorCount: number };
      requestPaths: Record<string, { count: number }>;
    };
    expect(first.write.mock.calls.map((call: unknown[]) => call[0])).toEqual([chunkA, chunkB]);
    expect(second.write.mock.calls.map((call: unknown[]) => call[0])).toEqual([chunkC]);
    expect(second.disconnect).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledTimes(2);
    expect(state.summary).toMatchObject({ requestCount: 2, totalBytesObserved: 5, requestErrorCount: 1 });
    expect(Object.keys(state.requestPaths)).toEqual(["/:word-s"]);
    expect(state.requestPaths["/:word-s"]?.count).toBe(2);
  });

  it("clears an active run without interrupting pass-through or accepting stale marks", async () => {
    const harness = createHarness();
    await loadBackground();
    await harness.message({ type: "elatura:start-run" });
    await harness.message({
      type: "elatura:page-metric",
      metric: {
        kind: "composer-like-input",
        elapsedMs: 10,
        recordedAt: "2000-01-01T00:00:00.000Z",
      },
    });
    const filter = harness.request({
      requestId: "active",
      url: "https://chatgpt.com/active",
      method: "GET",
      type: "xmlhttprequest",
      timeStamp: 0,
    });

    await harness.message({ type: "elatura:clear-run" });
    const chunk = new Uint8Array([9, 8, 7]).buffer;
    filter.ondata?.({ data: chunk });
    filter.onstop?.();

    const state = (await harness.message({ type: "elatura:get-state" })) as {
      activeRun?: unknown;
      summary: { requestCount: number; totalBytesObserved: number };
      pageMarks: { composerReadyMs: number | null };
    };
    expect(filter.write).toHaveBeenCalledWith(chunk);
    expect(state.activeRun).toBeUndefined();
    expect(state.summary).toEqual({
      requestCount: 0,
      totalBytesObserved: 0,
      totalRequestDurationMs: 0,
      requestErrorCount: 0,
    });
    expect(state.pageMarks.composerReadyMs).toBeNull();
  });

  it("surfaces a storage failure in the active run integrity state", async () => {
    const harness = createHarness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadBackground();
    harness.local.set.mockRejectedValueOnce(new Error("quota"));
    await harness.message({ type: "elatura:start-run" });

    const state = (await harness.message({ type: "elatura:get-state" })) as {
      integrity: { persistenceErrorCount: number };
    };
    expect(state.integrity.persistenceErrorCount).toBe(1);
  });
});
