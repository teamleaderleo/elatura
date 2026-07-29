// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAllVolatileTransformState,
  registerVolatileTransformStateClearer,
  registeredVolatileTransformStateCount,
} from "../src/volatile-transform-state.js";

const unregister: Array<() => void> = [];

afterEach(() => {
  while (unregister.length > 0) unregister.pop()?.();
});

describe("volatile transform state registry", () => {
  it("clears every registered state owner and supports unregistration", () => {
    const first = vi.fn();
    const second = vi.fn();
    unregister.push(registerVolatileTransformStateClearer(first));
    const removeSecond = registerVolatileTransformStateClearer(second);
    unregister.push(removeSecond);
    expect(registeredVolatileTransformStateCount()).toBe(2);

    clearAllVolatileTransformState();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    removeSecond();
    clearAllVolatileTransformState();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledOnce();
  });

  it("attempts every clearer before reporting a fixed failure", () => {
    const later = vi.fn();
    unregister.push(
      registerVolatileTransformStateClearer(() => {
        throw new Error("private state");
      }),
      registerVolatileTransformStateClearer(later),
    );

    expect(() => clearAllVolatileTransformState()).toThrow("volatile-transform-clear-failed");
    expect(later).toHaveBeenCalledOnce();
  });
});
