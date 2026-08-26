// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  manualDiscardEligibility,
  projectChromiumTab,
  projectionRefForTab,
  type ChromiumTabLike,
} from "../src/projection.js";

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
    status: "complete",
    ...overrides,
  };
}

describe("Chromium projection identity", () => {
  it("uses a browser-session projection ref without claiming application lane identity", () => {
    expect(projectionRefForTab(7)).toBe("chrome-session-tab-7");
    expect(() => projectionRefForTab(-1)).toThrow("non-negative safe integer");
  });
});

describe("Chromium projection facts", () => {
  it("keeps unbound application eligibility unknown for an ordinary quiet background tab", () => {
    expect(projectChromiumTab(tab(), false)).toEqual({
      projectionRef: "chrome-session-tab-7",
      tabId: 7,
      windowId: 2,
      tabIndex: 3,
      lastAccessedMs: NOW - 60_000,
      audioState: "quiet",
      browserResidency: "background",
      freezeEligibility: "unknown",
      discardEligibility: "unknown",
      blockers: ["application_unknown"],
      manualDiscard: { eligible: true, reason: "eligible" },
      autoDiscardable: true,
      pinned: false,
    });
  });

  it("distinguishes active-in-window from actual foreground using window focus", () => {
    expect(projectChromiumTab(tab({ active: true }), true).browserResidency).toBe("foreground");
    expect(projectChromiumTab(tab({ active: true }), false).browserResidency).toBe("background");
  });

  it("maps discarded, reloading, and frozen before foreground/background", () => {
    expect(projectChromiumTab(tab({ discarded: true, active: true }), true).browserResidency).toBe("discarded");
    expect(projectChromiumTab(tab({ status: "loading", active: true }), true).browserResidency).toBe("reloading");
    expect(projectChromiumTab(tab({ frozen: true, active: true }), true).browserResidency).toBe("frozen");
  });

  it("blocks lifecycle eligibility on explicit browser protection", () => {
    expect(projectChromiumTab(tab({ pinned: true }), false)).toMatchObject({
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
      blockers: ["application_unknown", "manual_protection"],
      manualDiscard: { eligible: false, reason: "pinned-tab" },
    });
    expect(projectChromiumTab(tab({ autoDiscardable: false }), false)).toMatchObject({
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
      blockers: ["application_unknown", "manual_protection"],
      manualDiscard: { eligible: false, reason: "browser-protected" },
    });
  });

  it("blocks lifecycle eligibility while audio is known active", () => {
    expect(projectChromiumTab(tab({ audible: true }), false)).toMatchObject({
      audioState: "audible",
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
      blockers: ["application_unknown", "media_or_device_active"],
      manualDiscard: { eligible: false, reason: "audible-tab" },
    });
  });

  it("preserves unknown audio and refuses manual discard", () => {
    expect(projectChromiumTab(tab({ audible: undefined }), false)).toMatchObject({
      audioState: "unknown",
      freezeEligibility: "unknown",
      discardEligibility: "unknown",
      blockers: ["application_unknown"],
      manualDiscard: { eligible: false, reason: "audible-unknown" },
    });
  });
});

describe("manual native discard preflight", () => {
  it("refuses active, pinned, audible, unknown-audio, discarded, and browser-protected tabs", () => {
    expect(manualDiscardEligibility(tab({ active: true })).reason).toBe("active-tab");
    expect(manualDiscardEligibility(tab({ pinned: true })).reason).toBe("pinned-tab");
    expect(manualDiscardEligibility(tab({ audible: true })).reason).toBe("audible-tab");
    expect(manualDiscardEligibility(tab({ audible: undefined })).reason).toBe("audible-unknown");
    expect(manualDiscardEligibility(tab({ discarded: true })).reason).toBe("already-discarded");
    expect(manualDiscardEligibility(tab({ autoDiscardable: false })).reason).toBe("browser-protected");
  });

  it("permits only explicit operator discard of a fresh ordinary background candidate", () => {
    expect(manualDiscardEligibility(tab())).toEqual({ eligible: true, reason: "eligible" });
  });
});
