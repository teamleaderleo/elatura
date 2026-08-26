// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  manualBrowserDiscardEligibility,
  projectChromiumTab,
  projectionIdForTab,
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

describe("Chromium browser projection", () => {
  it("labels tab identity explicitly as a browser-session projection token", () => {
    expect(projectionIdForTab(7)).toBe("chrome-session-tab-7");
    expect(() => projectionIdForTab(-1)).toThrow("non-negative safe integer");
    expect(() => projectionIdForTab(Number.NaN)).toThrow("non-negative safe integer");
  });

  it("projects only bounded browser lifecycle metadata", () => {
    const projection = projectChromiumTab(tab());
    expect(projection).toEqual({
      projectionId: "chrome-session-tab-7",
      tabId: 7,
      windowId: 2,
      tabIndex: 3,
      audioState: "quiet",
      browserResidency: "background",
      pinned: false,
      autoDiscardable: true,
      lastAccessedMs: NOW - 60_000,
      frozen: false,
      manualDiscard: { eligible: true, reason: "eligible" },
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.manualDiscard)).toBe(true);
    expect("laneRef" in projection).toBe(false);
    expect("url" in projection).toBe(false);
    expect("title" in projection).toBe(false);
  });

  it("maps browser residency without inventing application recovery state", () => {
    expect(projectChromiumTab(tab({ active: true })).browserResidency).toBe("foreground");
    expect(projectChromiumTab(tab({ frozen: true })).browserResidency).toBe("frozen");
    expect(projectChromiumTab(tab({ discarded: true })).browserResidency).toBe("discarded");
  });

  it("preserves unknown audio and freeze state explicitly", () => {
    const projection = projectChromiumTab(tab({ audible: undefined, frozen: undefined }));
    expect(projection).toMatchObject({
      audioState: "unknown",
      frozen: null,
      manualDiscard: { eligible: false, reason: "audible-unknown" },
    });
  });
});

describe("manual native discard browser preflight", () => {
  it("allows only an inactive ordinary browser-discardable tab with known quiet audio", () => {
    expect(manualBrowserDiscardEligibility(tab())).toEqual({
      eligible: true,
      reason: "eligible",
    });
  });

  it("refuses active, pinned, audible, unknown-audio, discarded, and browser-protected tabs", () => {
    expect(manualBrowserDiscardEligibility(tab({ active: true })).reason).toBe("active-tab");
    expect(manualBrowserDiscardEligibility(tab({ pinned: true })).reason).toBe("pinned-tab");
    expect(manualBrowserDiscardEligibility(tab({ audible: true })).reason).toBe("audible-tab");
    expect(manualBrowserDiscardEligibility(tab({ audible: undefined })).reason).toBe("audible-unknown");
    expect(manualBrowserDiscardEligibility(tab({ discarded: true })).reason).toBe("already-discarded");
    expect(manualBrowserDiscardEligibility(tab({ autoDiscardable: false })).reason).toBe("browser-protected");
  });

  it("refuses a projection without a usable tab id", () => {
    expect(manualBrowserDiscardEligibility(tab({ id: undefined }))).toEqual({
      eligible: false,
      reason: "missing-tab-id",
    });
  });

  it("checks active-tab protection before weaker browser predicates", () => {
    expect(
      manualBrowserDiscardEligibility(
        tab({ active: true, pinned: true, audible: true, autoDiscardable: false }),
      ),
    ).toEqual({ eligible: false, reason: "active-tab" });
  });
});
