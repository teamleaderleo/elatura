// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredObservationState } from "../src/report.js";
import {
  TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS,
  type TransformOptInState,
} from "../src/transform-opt-in.js";
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

describe("production transform safety and opt-in messages", () => {
  it("records non-authorizing intent and emergency disable revokes it without stopping observation", async () => {
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
    expect(
      await harness.message<TransformOptInState>({ type: "elatura:get-transform-opt-in" }),
    ).toEqual({
      schemaVersion: 1,
      recorded: false,
      reason: "build-default",
      generation: 0,
      acknowledgementCount: 0,
      authorizesTransform: false,
    });

    const recorded = await harness.message<TransformOptInState>({
      type: "elatura:record-transform-opt-in",
      acknowledgements: [...TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS],
    });
    expect(recorded).toMatchObject({
      recorded: true,
      reason: "user-recorded",
      generation: 1,
      acknowledgementCount: 3,
      authorizesTransform: false,
    });

    await harness.message({ type: "elatura:start-run" });
    const safety = await harness.message<TransformSafetyState>({
      type: "elatura:emergency-disable-transforms",
    });
    const optIn = await harness.message<TransformOptInState>({
      type: "elatura:get-transform-opt-in",
    });
    const observation = await harness.message<StoredObservationState>({ type: "elatura:get-state" });

    expect(safety).toMatchObject({
      emergencyDisabled: true,
      reason: "user-emergency-disable",
      generation: 1,
      volatileClearCount: 1,
      volatileClearFailureCount: 0,
    });
    expect(optIn).toMatchObject({
      recorded: false,
      reason: "emergency-disable",
      generation: 2,
      acknowledgementCount: 0,
      authorizesTransform: false,
    });
    expect(observation.activeRun).toBeDefined();
  });

  it("rejects malformed or free-form opt-in acknowledgements", async () => {
    const harness = createHarness();
    await loadBackground();
    await expect(
      harness.message({
        type: "elatura:record-transform-opt-in",
        acknowledgements: [
          "session-local-only",
          "future-transform-risk",
          "private conversation title",
        ],
      }),
    ).rejects.toThrow(/exact fixed acknowledgement set/);
    expect(
      await harness.message<TransformOptInState>({ type: "elatura:get-transform-opt-in" }),
    ).toMatchObject({ recorded: false, generation: 0, authorizesTransform: false });
  });

  it("supports explicit revocation and returns to defaults after a background restart", async () => {
    const firstHarness = createHarness();
    await loadBackground();
    await firstHarness.message({
      type: "elatura:record-transform-opt-in",
      acknowledgements: [...TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS],
    });
    expect(
      await firstHarness.message<TransformOptInState>({ type: "elatura:revoke-transform-opt-in" }),
    ).toMatchObject({
      recorded: false,
      reason: "user-revoked",
      generation: 2,
      authorizesTransform: false,
    });

    await firstHarness.message({
      type: "elatura:record-transform-opt-in",
      acknowledgements: [...TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS],
    });
    vi.unstubAllGlobals();
    const restartedHarness = createHarness();
    await loadBackground();
    expect(
      await restartedHarness.message<TransformOptInState>({ type: "elatura:get-transform-opt-in" }),
    ).toEqual({
      schemaVersion: 1,
      recorded: false,
      reason: "build-default",
      generation: 0,
      acknowledgementCount: 0,
      authorizesTransform: false,
    });
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
