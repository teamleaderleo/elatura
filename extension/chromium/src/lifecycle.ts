// SPDX-License-Identifier: MPL-2.0

export const CHROMIUM_LIFECYCLE_HOST_VERSION = 1 as const;
export const MAX_CHROMIUM_LANES = 256;

export type ManualDiscardReason =
  | "eligible"
  | "missing-tab-id"
  | "active-tab"
  | "pinned-tab"
  | "audible-tab"
  | "already-discarded"
  | "browser-protected";

export interface ChromiumTabLike {
  id?: number;
  active: boolean;
  pinned: boolean;
  audible?: boolean;
  discarded: boolean;
  frozen?: boolean;
  autoDiscardable: boolean;
  lastAccessed: number;
  windowId: number;
  index: number;
}

export interface ChromiumLaneLifecycle {
  laneId: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  frozen: boolean | null;
  autoDiscardable: boolean;
  lastAccessedMs: number;
}

export interface ChromiumLaneProjection {
  tabId: number;
  windowId: number;
  tabIndex: number;
  lifecycle: ChromiumLaneLifecycle;
  manualDiscard: {
    eligible: boolean;
    reason: ManualDiscardReason;
  };
}

export interface BrowserOnlyLaneSignals {
  generating: null;
  unsaved: null;
  needsAttention: false;
  safeToDiscard: "unknown";
}

const BROWSER_ONLY_SIGNALS: Readonly<BrowserOnlyLaneSignals> = Object.freeze({
  generating: null,
  unsaved: null,
  needsAttention: false,
  safeToDiscard: "unknown",
});

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

export function laneIdForTab(tabIdInput: unknown): string {
  const tabId = safeInteger(tabIdInput, "tabId");
  return `chrome-session-tab-${tabId}`;
}

export function browserOnlyLaneSignals(): Readonly<BrowserOnlyLaneSignals> {
  return BROWSER_ONLY_SIGNALS;
}

export function manualDiscardEligibility(tab: ChromiumTabLike): {
  eligible: boolean;
  reason: ManualDiscardReason;
} {
  if (tab.id === undefined || !Number.isSafeInteger(tab.id) || tab.id < 0) {
    return Object.freeze({ eligible: false, reason: "missing-tab-id" });
  }
  if (tab.active) return Object.freeze({ eligible: false, reason: "active-tab" });
  if (tab.pinned) return Object.freeze({ eligible: false, reason: "pinned-tab" });
  if (tab.audible === true) return Object.freeze({ eligible: false, reason: "audible-tab" });
  if (tab.discarded) return Object.freeze({ eligible: false, reason: "already-discarded" });
  if (!tab.autoDiscardable) return Object.freeze({ eligible: false, reason: "browser-protected" });
  return Object.freeze({ eligible: true, reason: "eligible" });
}

export function projectChromiumTab(tab: ChromiumTabLike): ChromiumLaneProjection {
  const tabId = safeInteger(tab.id, "tab.id");
  const windowId = safeInteger(tab.windowId, "tab.windowId");
  const tabIndex = safeInteger(tab.index, "tab.index");
  const lastAccessedMs = safeInteger(tab.lastAccessed, "tab.lastAccessed");
  const active = booleanValue(tab.active, "tab.active");
  const pinned = booleanValue(tab.pinned, "tab.pinned");
  const discarded = booleanValue(tab.discarded, "tab.discarded");
  const autoDiscardable = booleanValue(tab.autoDiscardable, "tab.autoDiscardable");
  const audible = tab.audible === undefined ? false : booleanValue(tab.audible, "tab.audible");
  const frozen = tab.frozen === undefined ? null : booleanValue(tab.frozen, "tab.frozen");

  const lifecycle = Object.freeze({
    laneId: laneIdForTab(tabId),
    active,
    pinned,
    audible,
    discarded,
    frozen,
    autoDiscardable,
    lastAccessedMs,
  });

  return Object.freeze({
    tabId,
    windowId,
    tabIndex,
    lifecycle,
    manualDiscard: manualDiscardEligibility({
      id: tabId,
      active,
      pinned,
      audible,
      discarded,
      frozen: frozen ?? undefined,
      autoDiscardable,
      lastAccessed: lastAccessedMs,
      windowId,
      index: tabIndex,
    }),
  });
}
