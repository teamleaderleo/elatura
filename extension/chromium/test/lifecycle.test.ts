// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  browserOnlyLaneSignals,
  laneIdForTab,
  manualDiscardEligibility,
  projectChromiumTab,
  type ChromiumTabLike,
} from "../src/lifecycle.js";

const NOW = 1_000_000;

function tab(overrides: Partial<ChromiumTabLike> = {}): ChromiumTabLike {
  return {
    id: 7,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    lastAccessed: NOW - 60_000,
    windowId: 2,
    index: 3,
    ...overrides,
  };
}

describe("Chromium browser-only lifecycle projection", () => {
  it("derives browser-session lane identity from the numeric tab id only", () => {
    expect(laneIdForTab(7)).toBe("chrome-session-tab-7");
    expect(() => laneIdForTab(-1)).toThrow("non-negative safe integer");
    expect(() => laneIdForTab(Number.NaN)).toThrow("non-negative safe integer");
  });

  it("projects only bounded lifecycle metadata", () => {
    const projection = projectChromiumTab(tab());
    expect(projection).toEqual({
      tabId: 7,
      windowId: 2,
      tabIndex: 3,
      lifecycle: {
        laneId: "chrome-session-tab-7",
        active: false,
        pinned: false,
        audible: false,
        discarded: false,
        frozen: false,
        autoDiscardable: true,
        lastAccessedMs: NOW - 60_000,
      },
      manualDiscard: { eligible: true, reason: "eligible" },
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.lifecycle)).toBe(true);
  });

  it("maps unavailable optional lifecycle fields conservatively", () => {
    const projection = projectChromiumTab(tab({ audible: undefined, frozen: undefined }));
    expect(projection.lifecycle).toMatchObject({ audible: false, frozen: null });
  });

  it("keeps browser-only application signals explicitly unknown", () => {
    expect(browserOnlyLaneSignals()).toEqual({
      generating: null,
      unsaved: null,
      needsAttention: false,
      safeToDiscard: "unknown",
    });
    expect(Object.isFrozen(browserOnlyLaneSignals())).toBe(true);
  });
});

describe("manual native discard preflight", () => {
  it("allows only an inactive ordinary browser-discardable tab", () => {
    expect(manualDiscardEligibility(tab())).toEqual({ eligible: true, reason: "eligible" });
  });

  it("refuses active, pinned, audible, discarded, and browser-protected tabs", () => {
    expect(manualDiscardEligibility(tab({ active: true })).reason).toBe("active-tab");
    expect(manualDiscardEligibility(tab({ pinned: true })).reason).toBe("pinned-tab");
    expect(manualDiscardEligibility(tab({ audible: true })).reason).toBe("audible-tab");
    expect(manualDiscardEligibility(tab({ discarded: true })).reason).toBe("already-discarded");
    expect(manualDiscardEligibility(tab({ autoDiscardable: false })).reason).toBe("browser-protected");
  });

  it("refuses a projection without a usable tab id", () => {
    expect(manualDiscardEligibility(tab({ id: undefined }))).toEqual({
      eligible: false,
      reason: "missing-tab-id",
    });
  });

  it("checks the most conservative refusal first", () => {
    expect(
      manualDiscardEligibility(tab({ active: true, pinned: true, audible: true, autoDiscardable: false })),
    ).toEqual({ eligible: false, reason: "active-tab" });
  });
});
