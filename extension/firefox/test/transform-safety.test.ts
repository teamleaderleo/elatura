// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from "vitest";
import {
  createTransformSafetyController,
  evaluateTransformPermission,
  isAdapterDenied,
  normalizeAdapterDenylist,
} from "../src/transform-safety.js";

describe("local transform safety", () => {
  it("starts locked and requires explicit local opt-in even without an emergency lock", () => {
    const controller = createTransformSafetyController({
      clearVolatileTransformState() {},
    });
    expect(controller.getState()).toMatchObject({
      emergencyDisabled: true,
      reason: "build-default",
      generation: 0,
      denylistEntryCount: 0,
    });
    expect(controller.evaluate({ id: "chatgpt-conversation", version: "0.3.0" }, true)).toEqual({
      allowed: false,
      reason: "emergency-disabled",
    });
    expect(
      evaluateTransformPermission({
        emergencyDisabled: false,
        explicitLocalOptIn: false,
        identity: { id: "chatgpt-conversation", version: "0.3.0" },
        denylist: [],
      }),
    ).toEqual({ allowed: false, reason: "local-opt-in-required" });
  });

  it("clears volatile state every time the emergency lock is engaged", () => {
    const clear = vi.fn();
    const controller = createTransformSafetyController({ clearVolatileTransformState: clear });
    expect(controller.emergencyDisable()).toMatchObject({
      emergencyDisabled: true,
      reason: "user-emergency-disable",
      generation: 1,
      volatileClearCount: 1,
      volatileClearFailureCount: 0,
    });
    expect(controller.emergencyDisable()).toMatchObject({
      generation: 2,
      volatileClearCount: 2,
      volatileClearFailureCount: 0,
    });
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("remains locked and records a content-free failure when clearing throws", () => {
    const controller = createTransformSafetyController({
      clearVolatileTransformState() {
        throw new Error("private transform state");
      },
    });
    expect(controller.emergencyDisable()).toEqual({
      schemaVersion: 1,
      emergencyDisabled: true,
      reason: "user-emergency-disable",
      generation: 1,
      volatileClearCount: 1,
      volatileClearFailureCount: 1,
      denylistEntryCount: 0,
    });
  });

  it("uses exact local adapter id/version denylist matching", () => {
    const denylist = normalizeAdapterDenylist([
      { id: "chatgpt-conversation", version: "0.3.0" },
      { id: "other", version: "1.0.0" },
    ]);
    expect(isAdapterDenied({ id: "chatgpt-conversation", version: "0.3.0" }, denylist)).toBe(true);
    expect(isAdapterDenied({ id: "chatgpt-conversation", version: "0.3.1" }, denylist)).toBe(false);
    expect(isAdapterDenied({ id: "chatgpt", version: "0.3.0" }, denylist)).toBe(false);
    expect(
      evaluateTransformPermission({
        emergencyDisabled: false,
        explicitLocalOptIn: true,
        identity: { id: "chatgpt-conversation", version: "0.3.0" },
        denylist,
      }),
    ).toEqual({ allowed: false, reason: "adapter-denylisted" });
    expect(
      evaluateTransformPermission({
        emergencyDisabled: false,
        explicitLocalOptIn: true,
        identity: { id: "chatgpt-conversation", version: "0.3.1" },
        denylist,
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects malformed and duplicate local denylist entries", () => {
    expect(() => normalizeAdapterDenylist([{ id: "bad id", version: "1" }])).toThrow(/bounded local tokens/);
    expect(() =>
      normalizeAdapterDenylist([
        { id: "adapter", version: "1" },
        { id: "adapter", version: "1" },
      ]),
    ).toThrow(/unique/);
  });
});
