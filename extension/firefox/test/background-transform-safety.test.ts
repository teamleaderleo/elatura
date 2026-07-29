// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredObservationState } from "../src/report.js";
import type { TransformSafetyState } from "../src/transform-safety.js";

type MessageListener = (message: unknown) => unknown;

function createHarness() {
  let stored: Record<string, unknown> = {};
  let messageListener: MessageListener | undefined;
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
      onBeforeRequest: { addListener() {} },
      filterResponseData() {
        throw new Error("not used");
      },
    },
  });

  return {
    async message<T>(message: unknown): Promise<T> {
      if (!messageListener) throw new Error("Message listener was not registered.");
      return (await messageListener(message)) as T;
    },
  };
}

async function loadBackground(): Promise<void> {
  vi.resetModules();
  await import("../src/background.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("production transform safety messages", () => {
  it("starts locked, repeatedly clears through the emergency action, and preserves observation", async () => {
    const harness = createHarness();
    await loadBackground();

    expect(
      await harness.message<TransformSafetyState>({ type: "elatura:get-transform-safety" }),
    ).toEqual({
      schemaVersion: 1,
      emergencyDisabled: true,
      reason: "build-default",
      generation: 0,
      volatileClearCount: 0,
      volatileClearFailureCount: 0,
      denylistEntryCount: 0,
    });

    await harness.message({ type: "elatura:start-run" });
    const first = await harness.message<TransformSafetyState>({
      type: "elatura:emergency-disable-transforms",
    });
    const second = await harness.message<TransformSafetyState>({
      type: "elatura:emergency-disable-transforms",
    });
    const observation = await harness.message<StoredObservationState>({ type: "elatura:get-state" });

    expect(first).toMatchObject({
      emergencyDisabled: true,
      reason: "user-emergency-disable",
      generation: 1,
      volatileClearCount: 1,
    });
    expect(second).toMatchObject({ generation: 2, volatileClearCount: 2 });
    expect(observation.activeRun).toBeDefined();
  });

  it("returns to the locked build default after a background restart", async () => {
    const firstHarness = createHarness();
    await loadBackground();
    await firstHarness.message({ type: "elatura:emergency-disable-transforms" });
    expect(
      await firstHarness.message<TransformSafetyState>({ type: "elatura:get-transform-safety" }),
    ).toMatchObject({ reason: "user-emergency-disable", generation: 1 });

    vi.unstubAllGlobals();
    const restartedHarness = createHarness();
    await loadBackground();
    expect(
      await restartedHarness.message<TransformSafetyState>({ type: "elatura:get-transform-safety" }),
    ).toMatchObject({
      emergencyDisabled: true,
      reason: "build-default",
      generation: 0,
      volatileClearCount: 0,
    });
  });
});
