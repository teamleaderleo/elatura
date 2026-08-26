// SPDX-License-Identifier: MPL-2.0

import {
  evaluateLane,
  parseLaneSignals,
  type LaneDecision,
  type LaneLifecycle,
  type LaneSignals,
} from "./lane-governor.js";

export const CHROMIUM_LANE_HOST_VERSION = 1 as const;
export const MAX_CHROMIUM_LANES = 64;

const LOCAL_STATE_KEY = "elatura.chromium.lane-host.v1";
const SESSION_EPOCH_KEY = "elatura.chromium.browser-session.v1";
const MAX_TOKEN_LENGTH = 128;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const DEFAULT_LANE_SIGNALS: Readonly<LaneSignals> = Object.freeze({
  generating: null,
  unsaved: null,
  needsAttention: false,
  safeToDiscard: "unknown",
});

export type ChromiumTabSnapshot = Readonly<{
  id: number;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  frozen: boolean | null;
  autoDiscardable: boolean;
  lastAccessedMs: number;
}>;

export type ChromiumTabUpdate = Readonly<{
  active?: boolean;
  autoDiscardable?: boolean;
}>;

export interface ChromiumLaneBrowser {
  listTabs(): Promise<readonly ChromiumTabSnapshot[]>;
  getTab(tabId: number): Promise<ChromiumTabSnapshot | null>;
  updateTab(tabId: number, update: ChromiumTabUpdate): Promise<ChromiumTabSnapshot | null>;
  discardTab(tabId: number): Promise<ChromiumTabSnapshot | null>;
}

export interface ChromiumLaneStorage {
  getLocal(key: string): Promise<unknown>;
  setLocal(key: string, value: unknown): Promise<void>;
  getSession(key: string): Promise<unknown>;
  setSession(key: string, value: unknown): Promise<void>;
}

export interface ChromiumLaneRuntime {
  nowMs(): number;
  newToken(): string;
}

export type LaneProjection = Readonly<{
  browserSessionEpoch: string;
  tabId: number;
}>;

export type DurableLaneRecord = Readonly<{
  laneId: string;
  boundAtMs: number;
  projection: LaneProjection | null;
  signals: LaneSignals;
  protectionOwned: boolean;
}>;

type StoredLaneState = Readonly<{
  version: typeof CHROMIUM_LANE_HOST_VERSION;
  lanes: readonly DurableLaneRecord[];
}>;

export type LaneHostOutcome = "applied" | "observed" | "refused" | "failed" | "partial";

export type LaneHostReason =
  | "initialized"
  | "reconciled"
  | "session-storage-failed"
  | "stored-state-read-failed"
  | "stored-state-invalid"
  | "stored-state-write-failed"
  | "browser-enumeration-failed"
  | "invalid-runtime-token"
  | "invalid-tab-id"
  | "invalid-lane-id"
  | "invalid-signals"
  | "lane-capacity"
  | "bound"
  | "already-bound"
  | "signals-updated"
  | "lane-missing"
  | "projection-missing"
  | "projection-stale-session"
  | "tab-missing"
  | "tab-read-failed"
  | "inspected"
  | "discard-refused"
  | "discarded"
  | "discard-failed"
  | "wake-applied"
  | "wake-failed"
  | "protected"
  | "already-protected"
  | "unprotected"
  | "already-unprotected"
  | "protection-not-owned"
  | "protection-owned"
  | "protect-failed"
  | "unprotect-failed"
  | "protection-record-partial"
  | "forgotten"
  | "tab-removed"
  | "tab-replaced";

export type LaneHostReceipt = Readonly<{
  outcome: LaneHostOutcome;
  reason: LaneHostReason;
  laneId: string | null;
  decision: LaneDecision | null;
}>;

export type LaneHostListResult = Readonly<{
  receipt: LaneHostReceipt;
  lanes: readonly DurableLaneRecord[];
}>;

export type LaneHostInspectResult = Readonly<{
  receipt: LaneHostReceipt;
  lifecycle: LaneLifecycle | null;
}>;

function receipt(
  outcome: LaneHostOutcome,
  reason: LaneHostReason,
  laneId: string | null = null,
  decision: LaneDecision | null = null,
): LaneHostReceipt {
  return Object.freeze({ outcome, reason, laneId, decision });
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(value)
  );
}

function cloneSignals(signals: LaneSignals): LaneSignals {
  return Object.freeze({
    generating: signals.generating,
    unsaved: signals.unsaved,
    needsAttention: signals.needsAttention,
    safeToDiscard: signals.safeToDiscard,
  });
}

function ownDataRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Expected a plain own-data record.");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Expected a plain own-data record.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const expected = new Set(expectedKeys);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    throw new TypeError("Expected a plain own-data record.");
  }
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      throw new TypeError("Expected a plain own-data record.");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function parseProjection(input: unknown): LaneProjection | null {
  if (input === null) return null;
  const record = ownDataRecord(input, ["browserSessionEpoch", "tabId"]);
  if (!validToken(record.browserSessionEpoch) || !safeInteger(record.tabId, 0)) {
    throw new TypeError("Invalid lane projection.");
  }
  return Object.freeze({
    browserSessionEpoch: record.browserSessionEpoch,
    tabId: record.tabId,
  });
}

function parseDurableLane(input: unknown): DurableLaneRecord {
  const record = ownDataRecord(input, [
    "laneId",
    "boundAtMs",
    "projection",
    "signals",
    "protectionOwned",
  ]);
  if (!validToken(record.laneId) || !safeInteger(record.boundAtMs, 0)) {
    throw new TypeError("Invalid lane record.");
  }
  if (typeof record.protectionOwned !== "boolean") {
    throw new TypeError("Invalid lane record.");
  }
  let signals: LaneSignals;
  try {
    signals = parseLaneSignals(record.signals);
  } catch {
    throw new TypeError("Invalid lane record.");
  }
  return Object.freeze({
    laneId: record.laneId,
    boundAtMs: record.boundAtMs,
    projection: parseProjection(record.projection),
    signals: cloneSignals(signals),
    protectionOwned: record.protectionOwned,
  });
}

function parseStoredState(input: unknown): StoredLaneState {
  try {
    const record = ownDataRecord(input, ["version", "lanes"]);
    if (record.version !== CHROMIUM_LANE_HOST_VERSION || !Array.isArray(record.lanes)) {
      throw new TypeError("Invalid stored lane state.");
    }
    if (record.lanes.length > MAX_CHROMIUM_LANES) {
      throw new TypeError("Invalid stored lane state.");
    }
    const lanes = record.lanes.map(parseDurableLane);
    const laneIds = new Set<string>();
    const projections = new Set<string>();
    for (const lane of lanes) {
      if (laneIds.has(lane.laneId)) throw new TypeError("Invalid stored lane state.");
      laneIds.add(lane.laneId);
      if (lane.projection !== null) {
        const projectionKey = `${lane.projection.browserSessionEpoch}:${lane.projection.tabId}`;
        if (projections.has(projectionKey)) throw new TypeError("Invalid stored lane state.");
        projections.add(projectionKey);
      }
    }
    return Object.freeze({ version: CHROMIUM_LANE_HOST_VERSION, lanes: Object.freeze(lanes) });
  } catch {
    throw new TypeError("Stored Chromium lane state is invalid.");
  }
}

function emptyState(): StoredLaneState {
  return Object.freeze({ version: CHROMIUM_LANE_HOST_VERSION, lanes: Object.freeze([]) });
}

function stateWithLanes(lanes: readonly DurableLaneRecord[]): StoredLaneState {
  return Object.freeze({ version: CHROMIUM_LANE_HOST_VERSION, lanes: Object.freeze([...lanes]) });
}

function replaceLane(
  state: StoredLaneState,
  laneId: string,
  replacement: DurableLaneRecord,
): StoredLaneState {
  return stateWithLanes(state.lanes.map((lane) => (lane.laneId === laneId ? replacement : lane)));
}

function lifecycleFromTab(laneId: string, tab: ChromiumTabSnapshot): LaneLifecycle {
  return Object.freeze({
    laneId,
    active: tab.active,
    pinned: tab.pinned,
    audible: tab.audible,
    discarded: tab.discarded,
    frozen: tab.frozen,
    autoDiscardable: tab.autoDiscardable,
    lastAccessedMs: tab.lastAccessedMs,
  });
}

function cloneLane(lane: DurableLaneRecord): DurableLaneRecord {
  return Object.freeze({
    laneId: lane.laneId,
    boundAtMs: lane.boundAtMs,
    projection:
      lane.projection === null
        ? null
        : Object.freeze({
            browserSessionEpoch: lane.projection.browserSessionEpoch,
            tabId: lane.projection.tabId,
          }),
    signals: cloneSignals(lane.signals),
    protectionOwned: lane.protectionOwned,
  });
}

export class ChromiumLaneHost {
  readonly browser: ChromiumLaneBrowser;
  readonly storage: ChromiumLaneStorage;
  readonly runtime: ChromiumLaneRuntime;

  #state: StoredLaneState = emptyState();
  #browserSessionEpoch: string | null = null;
  #ready = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    browser: ChromiumLaneBrowser,
    storage: ChromiumLaneStorage,
    runtime: ChromiumLaneRuntime,
  ) {
    this.browser = browser;
    this.storage = storage;
    this.runtime = runtime;
  }

  initialize(): Promise<LaneHostReceipt> {
    return this.#exclusive(() => this.#initializeUnlocked());
  }

  listLanes(): Promise<LaneHostListResult> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") {
        return Object.freeze({ receipt: initialization, lanes: Object.freeze([]) });
      }
      return Object.freeze({
        receipt: receipt("observed", "inspected"),
        lanes: Object.freeze(this.#state.lanes.map(cloneLane)),
      });
    });
  }

  bindTab(tabIdInput: number): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!safeInteger(tabIdInput, 0)) return receipt("refused", "invalid-tab-id");

      const tabRead = await this.#readTabUnlocked(tabIdInput);
      if (tabRead.reason !== null) return receipt("failed", tabRead.reason);
      if (tabRead.tab === null) return receipt("refused", "tab-missing");

      const epoch = this.#browserSessionEpoch;
      if (epoch === null) return receipt("failed", "session-storage-failed");
      const existing = this.#state.lanes.find(
        (lane) =>
          lane.projection?.browserSessionEpoch === epoch && lane.projection.tabId === tabIdInput,
      );
      if (existing !== undefined) {
        return receipt("observed", "already-bound", existing.laneId);
      }
      if (this.#state.lanes.length >= MAX_CHROMIUM_LANES) {
        return receipt("refused", "lane-capacity");
      }

      const laneId = this.runtime.newToken();
      const nowMs = this.runtime.nowMs();
      if (!validToken(laneId)) return receipt("failed", "invalid-runtime-token");
      if (!safeInteger(nowMs, 0)) return receipt("failed", "invalid-runtime-token");
      const lane: DurableLaneRecord = Object.freeze({
        laneId,
        boundAtMs: nowMs,
        projection: Object.freeze({ browserSessionEpoch: epoch, tabId: tabIdInput }),
        signals: cloneSignals(DEFAULT_LANE_SIGNALS),
        protectionOwned: false,
      });
      const next = stateWithLanes([...this.#state.lanes, lane]);
      if (!(await this.#persistUnlocked(next))) return receipt("failed", "stored-state-write-failed", laneId);
      return receipt("applied", "bound", laneId);
    });
  }

  setSignals(laneIdInput: string, signalsInput: unknown): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!validToken(laneIdInput)) return receipt("refused", "invalid-lane-id");
      let signals: LaneSignals;
      try {
        signals = parseLaneSignals(signalsInput);
      } catch {
        return receipt("refused", "invalid-signals", laneIdInput);
      }
      const lane = this.#findLane(laneIdInput);
      if (lane === null) return receipt("refused", "lane-missing", laneIdInput);
      const replacement: DurableLaneRecord = Object.freeze({
        ...lane,
        signals: cloneSignals(signals),
      });
      const next = replaceLane(this.#state, laneIdInput, replacement);
      if (!(await this.#persistUnlocked(next))) {
        return receipt("failed", "stored-state-write-failed", laneIdInput);
      }
      return receipt("applied", "signals-updated", laneIdInput);
    });
  }

  inspect(laneIdInput: string): Promise<LaneHostInspectResult> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") {
        return Object.freeze({ receipt: initialization, lifecycle: null });
      }
      if (!validToken(laneIdInput)) {
        return Object.freeze({ receipt: receipt("refused", "invalid-lane-id"), lifecycle: null });
      }
      return this.#inspectUnlocked(laneIdInput);
    });
  }

  discard(laneIdInput: string): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!validToken(laneIdInput)) return receipt("refused", "invalid-lane-id");
      const inspected = await this.#inspectUnlocked(laneIdInput);
      if (inspected.lifecycle === null) return inspected.receipt;
      const decision = inspected.receipt.decision;
      if (decision === null || decision.action !== "discard-candidate") {
        return receipt("refused", "discard-refused", laneIdInput, decision);
      }
      const lane = this.#findLane(laneIdInput);
      const tabId = lane?.projection?.tabId;
      if (tabId === undefined) return receipt("refused", "projection-missing", laneIdInput, decision);
      try {
        const discarded = await this.browser.discardTab(tabId);
        if (discarded === null || discarded.discarded !== true) {
          return receipt("failed", "discard-failed", laneIdInput, decision);
        }
      } catch {
        return receipt("failed", "discard-failed", laneIdInput, decision);
      }
      return receipt("applied", "discarded", laneIdInput, decision);
    });
  }

  wake(laneIdInput: string): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!validToken(laneIdInput)) return receipt("refused", "invalid-lane-id");
      const lane = this.#findLane(laneIdInput);
      if (lane === null) return receipt("refused", "lane-missing", laneIdInput);
      const projectionReason = this.#projectionReason(lane);
      if (projectionReason !== null) return receipt("refused", projectionReason, laneIdInput);
      try {
        const updated = await this.browser.updateTab(lane.projection!.tabId, { active: true });
        if (updated === null || updated.active !== true) {
          return receipt("failed", "wake-failed", laneIdInput);
        }
      } catch {
        return receipt("failed", "wake-failed", laneIdInput);
      }
      return receipt("applied", "wake-applied", laneIdInput);
    });
  }

  protectFromAutomaticDiscard(laneIdInput: string): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!validToken(laneIdInput)) return receipt("refused", "invalid-lane-id");
      const lane = this.#findLane(laneIdInput);
      if (lane === null) return receipt("refused", "lane-missing", laneIdInput);
      const projectionReason = this.#projectionReason(lane);
      if (projectionReason !== null) return receipt("refused", projectionReason, laneIdInput);

      const read = await this.#readTabUnlocked(lane.projection!.tabId);
      if (read.reason !== null) return receipt("failed", read.reason, laneIdInput);
      if (read.tab === null) return this.#clearMissingProjectionUnlocked(lane);
      if (read.tab.autoDiscardable === false) {
        return receipt("observed", "already-protected", laneIdInput);
      }

      try {
        const updated = await this.browser.updateTab(lane.projection!.tabId, { autoDiscardable: false });
        if (updated === null || updated.autoDiscardable !== false) {
          return receipt("failed", "protect-failed", laneIdInput);
        }
      } catch {
        return receipt("failed", "protect-failed", laneIdInput);
      }

      const replacement: DurableLaneRecord = Object.freeze({ ...lane, protectionOwned: true });
      if (!(await this.#persistUnlocked(replaceLane(this.#state, laneIdInput, replacement)))) {
        try {
          const rolledBack = await this.browser.updateTab(lane.projection!.tabId, { autoDiscardable: true });
          if (rolledBack !== null && rolledBack.autoDiscardable === true) {
            return receipt("failed", "stored-state-write-failed", laneIdInput);
          }
        } catch {
          // A fixed partial receipt records the browser-side protection without exposing browser errors.
        }
        return receipt("partial", "protection-record-partial", laneIdInput);
      }
      return receipt("applied", "protected", laneIdInput);
    });
  }

  removeAutomaticDiscardProtection(laneIdInput: string): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!validToken(laneIdInput)) return receipt("refused", "invalid-lane-id");
      const lane = this.#findLane(laneIdInput);
      if (lane === null) return receipt("refused", "lane-missing", laneIdInput);
      if (!lane.protectionOwned) return receipt("refused", "protection-not-owned", laneIdInput);
      const projectionReason = this.#projectionReason(lane);
      if (projectionReason !== null) return receipt("refused", projectionReason, laneIdInput);

      const read = await this.#readTabUnlocked(lane.projection!.tabId);
      if (read.reason !== null) return receipt("failed", read.reason, laneIdInput);
      if (read.tab === null) return this.#clearMissingProjectionUnlocked(lane);
      if (read.tab.autoDiscardable !== true) {
        try {
          const updated = await this.browser.updateTab(lane.projection!.tabId, { autoDiscardable: true });
          if (updated === null || updated.autoDiscardable !== true) {
            return receipt("failed", "unprotect-failed", laneIdInput);
          }
        } catch {
          return receipt("failed", "unprotect-failed", laneIdInput);
        }
      }

      const replacement: DurableLaneRecord = Object.freeze({ ...lane, protectionOwned: false });
      if (!(await this.#persistUnlocked(replaceLane(this.#state, laneIdInput, replacement)))) {
        return receipt("partial", "protection-record-partial", laneIdInput);
      }
      return receipt("applied", read.tab.autoDiscardable ? "already-unprotected" : "unprotected", laneIdInput);
    });
  }

  forget(laneIdInput: string): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!validToken(laneIdInput)) return receipt("refused", "invalid-lane-id");
      const lane = this.#findLane(laneIdInput);
      if (lane === null) return receipt("refused", "lane-missing", laneIdInput);
      if (lane.protectionOwned) return receipt("refused", "protection-owned", laneIdInput);
      const next = stateWithLanes(this.#state.lanes.filter((candidate) => candidate.laneId !== laneIdInput));
      if (!(await this.#persistUnlocked(next))) {
        return receipt("failed", "stored-state-write-failed", laneIdInput);
      }
      return receipt("applied", "forgotten", laneIdInput);
    });
  }

  noteTabRemoved(tabIdInput: number): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!safeInteger(tabIdInput, 0)) return receipt("refused", "invalid-tab-id");
      const lane = this.#laneForCurrentTab(tabIdInput);
      if (lane === null) return receipt("observed", "tab-removed");
      const replacement: DurableLaneRecord = Object.freeze({
        ...lane,
        projection: null,
        protectionOwned: false,
      });
      if (!(await this.#persistUnlocked(replaceLane(this.#state, lane.laneId, replacement)))) {
        return receipt("failed", "stored-state-write-failed", lane.laneId);
      }
      return receipt("observed", "tab-removed", lane.laneId);
    });
  }

  noteTabReplaced(addedTabIdInput: number, removedTabIdInput: number): Promise<LaneHostReceipt> {
    return this.#exclusive(async () => {
      const initialization = await this.#ensureReadyUnlocked();
      if (initialization.outcome === "failed") return initialization;
      if (!safeInteger(addedTabIdInput, 0) || !safeInteger(removedTabIdInput, 0)) {
        return receipt("refused", "invalid-tab-id");
      }
      const lane = this.#laneForCurrentTab(removedTabIdInput);
      if (lane === null) return receipt("observed", "tab-replaced");
      const epoch = this.#browserSessionEpoch;
      if (epoch === null) return receipt("failed", "session-storage-failed", lane.laneId);
      const replacement: DurableLaneRecord = Object.freeze({
        ...lane,
        projection: Object.freeze({ browserSessionEpoch: epoch, tabId: addedTabIdInput }),
        protectionOwned: false,
      });
      if (!(await this.#persistUnlocked(replaceLane(this.#state, lane.laneId, replacement)))) {
        return receipt("failed", "stored-state-write-failed", lane.laneId);
      }
      return receipt("observed", "tab-replaced", lane.laneId);
    });
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #ensureReadyUnlocked(): Promise<LaneHostReceipt> {
    if (this.#ready) return receipt("observed", "initialized");
    return this.#initializeUnlocked();
  }

  async #initializeUnlocked(): Promise<LaneHostReceipt> {
    let epoch: string;
    try {
      const current = await this.storage.getSession(SESSION_EPOCH_KEY);
      if (validToken(current)) {
        epoch = current;
      } else {
        const generated = this.runtime.newToken();
        if (!validToken(generated)) return receipt("failed", "invalid-runtime-token");
        await this.storage.setSession(SESSION_EPOCH_KEY, generated);
        epoch = generated;
      }
    } catch {
      return receipt("failed", "session-storage-failed");
    }

    let rawState: unknown;
    try {
      rawState = await this.storage.getLocal(LOCAL_STATE_KEY);
    } catch {
      return receipt("failed", "stored-state-read-failed");
    }
    let state: StoredLaneState;
    try {
      state = rawState === undefined ? emptyState() : parseStoredState(rawState);
    } catch {
      return receipt("failed", "stored-state-invalid");
    }

    let tabs: readonly ChromiumTabSnapshot[];
    try {
      tabs = await this.browser.listTabs();
    } catch {
      return receipt("failed", "browser-enumeration-failed");
    }
    const liveIds = new Set(tabs.map((tab) => tab.id));
    let changed = false;
    const reconciled = state.lanes.map((lane) => {
      const projection = lane.projection;
      if (
        projection !== null &&
        (projection.browserSessionEpoch !== epoch || !liveIds.has(projection.tabId))
      ) {
        changed = true;
        return Object.freeze({ ...lane, projection: null, protectionOwned: false });
      }
      return lane;
    });
    const next = changed ? stateWithLanes(reconciled) : state;
    if (changed) {
      try {
        await this.storage.setLocal(LOCAL_STATE_KEY, next);
      } catch {
        return receipt("failed", "stored-state-write-failed");
      }
    }

    this.#browserSessionEpoch = epoch;
    this.#state = next;
    this.#ready = true;
    return receipt("observed", changed ? "reconciled" : "initialized");
  }

  async #persistUnlocked(next: StoredLaneState): Promise<boolean> {
    try {
      await this.storage.setLocal(LOCAL_STATE_KEY, next);
      this.#state = next;
      return true;
    } catch {
      return false;
    }
  }

  #findLane(laneId: string): DurableLaneRecord | null {
    return this.#state.lanes.find((lane) => lane.laneId === laneId) ?? null;
  }

  #laneForCurrentTab(tabId: number): DurableLaneRecord | null {
    const epoch = this.#browserSessionEpoch;
    if (epoch === null) return null;
    return (
      this.#state.lanes.find(
        (lane) =>
          lane.projection?.browserSessionEpoch === epoch && lane.projection.tabId === tabId,
      ) ?? null
    );
  }

  #projectionReason(lane: DurableLaneRecord): "projection-missing" | "projection-stale-session" | null {
    if (lane.projection === null) return "projection-missing";
    if (lane.projection.browserSessionEpoch !== this.#browserSessionEpoch) {
      return "projection-stale-session";
    }
    return null;
  }

  async #readTabUnlocked(
    tabId: number,
  ): Promise<{ tab: ChromiumTabSnapshot | null; reason: "tab-read-failed" | null }> {
    try {
      return { tab: await this.browser.getTab(tabId), reason: null };
    } catch {
      return { tab: null, reason: "tab-read-failed" };
    }
  }

  async #clearMissingProjectionUnlocked(lane: DurableLaneRecord): Promise<LaneHostReceipt> {
    const replacement: DurableLaneRecord = Object.freeze({
      ...lane,
      projection: null,
      protectionOwned: false,
    });
    if (!(await this.#persistUnlocked(replaceLane(this.#state, lane.laneId, replacement)))) {
      return receipt("failed", "stored-state-write-failed", lane.laneId);
    }
    return receipt("refused", "tab-missing", lane.laneId);
  }

  async #inspectUnlocked(laneId: string): Promise<LaneHostInspectResult> {
    const lane = this.#findLane(laneId);
    if (lane === null) {
      return Object.freeze({ receipt: receipt("refused", "lane-missing", laneId), lifecycle: null });
    }
    const projectionReason = this.#projectionReason(lane);
    if (projectionReason !== null) {
      return Object.freeze({ receipt: receipt("refused", projectionReason, laneId), lifecycle: null });
    }
    const read = await this.#readTabUnlocked(lane.projection!.tabId);
    if (read.reason !== null) {
      return Object.freeze({ receipt: receipt("failed", read.reason, laneId), lifecycle: null });
    }
    if (read.tab === null) {
      return Object.freeze({ receipt: await this.#clearMissingProjectionUnlocked(lane), lifecycle: null });
    }
    const lifecycle = lifecycleFromTab(laneId, read.tab);
    let decision: LaneDecision;
    try {
      decision = evaluateLane(lifecycle, lane.signals, this.runtime.nowMs());
    } catch {
      return Object.freeze({ receipt: receipt("failed", "invalid-runtime-token", laneId), lifecycle: null });
    }
    return Object.freeze({
      receipt: receipt("observed", "inspected", laneId, decision),
      lifecycle,
    });
  }
}
