// SPDX-License-Identifier: MPL-2.0

export const CHROMIUM_LIFECYCLE_HOST_VERSION = 1 as const;
export const MAX_CHROMIUM_PROJECTIONS = 256;

export type ChromiumAudioState = "audible" | "quiet" | "unknown";
export type ChromiumBrowserResidency =
  | "foreground"
  | "background"
  | "frozen"
  | "discarded";

export type ManualBrowserDiscardReason =
  | "eligible"
  | "missing-tab-id"
  | "active-tab"
  | "pinned-tab"
  | "audible-tab"
  | "audible-unknown"
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

/**
 * Browser-session projection only. `projectionId` is deliberately not an
 * application-lane identity and carries no application/work authority.
 */
export interface ChromiumTabProjection {
  projectionId: string;
  tabId: number;
  windowId: number;
  tabIndex: number;
  audioState: ChromiumAudioState;
  browserResidency: ChromiumBrowserResidency;
  pinned: boolean;
  autoDiscardable: boolean;
  lastAccessedMs: number;
  frozen: boolean | null;
  manualDiscard: Readonly<{
    eligible: boolean;
    reason: ManualBrowserDiscardReason;
  }>;
}

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

export function projectionIdForTab(tabIdInput: unknown): string {
  const tabId = safeInteger(tabIdInput, "tabId");
  return `chrome-session-tab-${tabId}`;
}

export function manualBrowserDiscardEligibility(tab: ChromiumTabLike): Readonly<{
  eligible: boolean;
  reason: ManualBrowserDiscardReason;
}> {
  if (tab.id === undefined || !Number.isSafeInteger(tab.id) || tab.id < 0) {
    return Object.freeze({ eligible: false, reason: "missing-tab-id" });
  }
  if (tab.active) return Object.freeze({ eligible: false, reason: "active-tab" });
  if (tab.pinned) return Object.freeze({ eligible: false, reason: "pinned-tab" });
  if (tab.audible === true) return Object.freeze({ eligible: false, reason: "audible-tab" });
  if (tab.audible === undefined) return Object.freeze({ eligible: false, reason: "audible-unknown" });
  if (tab.discarded) return Object.freeze({ eligible: false, reason: "already-discarded" });
  if (!tab.autoDiscardable) return Object.freeze({ eligible: false, reason: "browser-protected" });
  return Object.freeze({ eligible: true, reason: "eligible" });
}

export function projectChromiumTab(tab: ChromiumTabLike): ChromiumTabProjection {
  const tabId = safeInteger(tab.id, "tab.id");
  const windowId = safeInteger(tab.windowId, "tab.windowId");
  const tabIndex = safeInteger(tab.index, "tab.index");
  const lastAccessedMs = safeInteger(tab.lastAccessed, "tab.lastAccessed");
  const active = booleanValue(tab.active, "tab.active");
  const pinned = booleanValue(tab.pinned, "tab.pinned");
  const discarded = booleanValue(tab.discarded, "tab.discarded");
  const autoDiscardable = booleanValue(tab.autoDiscardable, "tab.autoDiscardable");
  const audioState: ChromiumAudioState =
    tab.audible === undefined
      ? "unknown"
      : booleanValue(tab.audible, "tab.audible")
        ? "audible"
        : "quiet";
  const frozen = tab.frozen === undefined ? null : booleanValue(tab.frozen, "tab.frozen");
  const browserResidency: ChromiumBrowserResidency = discarded
    ? "discarded"
    : active
      ? "foreground"
      : frozen === true
        ? "frozen"
        : "background";

  return Object.freeze({
    projectionId: projectionIdForTab(tabId),
    tabId,
    windowId,
    tabIndex,
    audioState,
    browserResidency,
    pinned,
    autoDiscardable,
    lastAccessedMs,
    frozen,
    manualDiscard: manualBrowserDiscardEligibility({
      id: tabId,
      active,
      pinned,
      audible: tab.audible,
      discarded,
      frozen: frozen ?? undefined,
      autoDiscardable,
      lastAccessed: lastAccessedMs,
      windowId,
      index: tabIndex,
    }),
  });
}
