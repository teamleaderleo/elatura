// SPDX-License-Identifier: MPL-2.0
import type {
  ApplicationLaneBrowserResidency,
  ApplicationLaneEligibilityState,
  ApplicationLaneLifecycleBlocker,
} from "@elatura/core/application-lane-lifecycle";

export const CHROMIUM_PROJECTION_HOST_VERSION = 1 as const;
export const MAX_CHROMIUM_PROJECTIONS = 256;

export type ChromiumAudioState = "audible" | "quiet" | "unknown";

export type ManualDiscardReason =
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
  status?: "unloaded" | "loading" | "complete";
}

export interface ChromiumProjection {
  projectionRef: string;
  tabId: number;
  windowId: number;
  tabIndex: number;
  lastAccessedMs: number;
  audioState: ChromiumAudioState;
  browserResidency: ApplicationLaneBrowserResidency;
  freezeEligibility: ApplicationLaneEligibilityState;
  discardEligibility: ApplicationLaneEligibilityState;
  blockers: readonly ApplicationLaneLifecycleBlocker[];
  manualDiscard: Readonly<{
    eligible: boolean;
    reason: ManualDiscardReason;
  }>;
  autoDiscardable: boolean;
  pinned: boolean;
}

const BLOCKER_ORDER: readonly ApplicationLaneLifecycleBlocker[] = Object.freeze([
  "application_unknown",
  "manual_protection",
  "media_or_device_active",
]);

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

export function projectionRefForTab(tabIdInput: unknown): string {
  return `chrome-session-tab-${safeInteger(tabIdInput, "tabId")}`;
}

export function manualDiscardEligibility(tab: ChromiumTabLike): Readonly<{
  eligible: boolean;
  reason: ManualDiscardReason;
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

function browserResidency(tab: ChromiumTabLike, windowFocused: boolean): ApplicationLaneBrowserResidency {
  if (tab.discarded) return "discarded";
  if (tab.status === "loading") return "reloading";
  if (tab.frozen === true) return "frozen";
  if (tab.active && windowFocused) return "foreground";
  return "background";
}

function orderedBlockers(values: Set<ApplicationLaneLifecycleBlocker>): readonly ApplicationLaneLifecycleBlocker[] {
  const output = BLOCKER_ORDER.filter((value) => values.has(value));
  return Object.freeze(output);
}

export function projectChromiumTab(tab: ChromiumTabLike, windowFocusedInput: unknown): ChromiumProjection {
  const windowFocused = booleanValue(windowFocusedInput, "windowFocused");
  const tabId = safeInteger(tab.id, "tab.id");
  const windowId = safeInteger(tab.windowId, "tab.windowId");
  const tabIndex = safeInteger(tab.index, "tab.index");
  const lastAccessedMs = safeInteger(tab.lastAccessed, "tab.lastAccessed");
  const active = booleanValue(tab.active, "tab.active");
  const pinned = booleanValue(tab.pinned, "tab.pinned");
  const discarded = booleanValue(tab.discarded, "tab.discarded");
  const autoDiscardable = booleanValue(tab.autoDiscardable, "tab.autoDiscardable");
  const frozen = tab.frozen === undefined ? undefined : booleanValue(tab.frozen, "tab.frozen");
  const audioState: ChromiumAudioState =
    tab.audible === undefined ? "unknown" : booleanValue(tab.audible, "tab.audible") ? "audible" : "quiet";

  const normalized: ChromiumTabLike = {
    id: tabId,
    active,
    pinned,
    audible: tab.audible,
    discarded,
    frozen,
    autoDiscardable,
    lastAccessed: lastAccessedMs,
    windowId,
    index: tabIndex,
    status: tab.status,
  };

  const blockers = new Set<ApplicationLaneLifecycleBlocker>(["application_unknown"]);
  let freezeEligibility: ApplicationLaneEligibilityState = "unknown";
  let discardEligibility: ApplicationLaneEligibilityState = "unknown";

  if (pinned || !autoDiscardable) {
    blockers.add("manual_protection");
    freezeEligibility = "blocked";
    discardEligibility = "blocked";
  }
  if (audioState === "audible") {
    blockers.add("media_or_device_active");
    freezeEligibility = "blocked";
    discardEligibility = "blocked";
  }

  return Object.freeze({
    projectionRef: projectionRefForTab(tabId),
    tabId,
    windowId,
    tabIndex,
    lastAccessedMs,
    audioState,
    browserResidency: browserResidency(normalized, windowFocused),
    freezeEligibility,
    discardEligibility,
    blockers: orderedBlockers(blockers),
    manualDiscard: manualDiscardEligibility(normalized),
    autoDiscardable,
    pinned,
  });
}
