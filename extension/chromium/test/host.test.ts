// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  ChromiumLaneHost,
  DEFAULT_LANE_SIGNALS,
  type ChromiumLaneBrowser,
  type ChromiumLaneStorage,
  type ChromiumTabSnapshot,
  type LaneHostReceipt,
} from "../src/host.js";

const NOW = 1_000_000;

function tab(overrides: Partial<ChromiumTabSnapshot> = {}): ChromiumTabSnapshot {
  return {
    id: 7,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    lastAccessedMs: NOW - 600_000,
    ...overrides,
  };
}

class FakeStorage implements ChromiumLaneStorage {
  local = new Map<string, unknown>();
  session = new Map<string, unknown>();
  failLocalRead = false;
  failLocalWrite = false;

  async getLocal(key: string): Promise<unknown> {
    if (this.failLocalRead) throw new Error("PRIVATE storage read detail");
    return this.local.get(key);
  }

  async setLocal(key: string, value: unknown): Promise<void> {
    if (this.failLocalWrite) throw new Error("PRIVATE storage write detail");
    this.local.set(key, value);
  }

  async getSession(key: string): Promise<unknown> {
    return this.session.get(key);
  }

  async setSession(key: string, value: unknown): Promise<void> {
    this.session.set(key, value);
  }
}

class FakeBrowser implements ChromiumLaneBrowser {
  tabs = new Map<number, ChromiumTabSnapshot>();
  discarded: number[] = [];
  updates: Array<{ tabId: number; update: { active?: boolean; autoDiscardable?: boolean } }> = [];
  throwOnGet = false;
  throwOnDiscard = false;

  constructor(initialTabs: readonly ChromiumTabSnapshot[] = [tab()]) {
    for (const current of initialTabs) this.tabs.set(current.id, current);
  }

  async listTabs(): Promise<readonly ChromiumTabSnapshot[]> {
    return [...this.tabs.values()];
  }

  async getTab(tabId: number): Promise<ChromiumTabSnapshot | null> {
    if (this.throwOnGet) throw new Error("PRIVATE browser get detail");
    return this.tabs.get(tabId) ?? null;
  }

  async updateTab(
    tabId: number,
    update: { active?: boolean; autoDiscardable?: boolean },
  ): Promise<ChromiumTabSnapshot | null> {
    const current = this.tabs.get(tabId);
    if (!current) return null;
    this.updates.push({ tabId, update: { ...update } });
    const next = { ...current, ...update };
    this.tabs.set(tabId, next);
    return next;
  }

  async discardTab(tabId: number): Promise<ChromiumTabSnapshot | null> {
    if (this.throwOnDiscard) throw new Error("PRIVATE discard detail");
    const current = this.tabs.get(tabId);
    if (!current || current.active || current.discarded || !current.autoDiscardable) return null;
    this.discarded.push(tabId);
    const next = { ...current, discarded: true };
    this.tabs.set(tabId, next);
    return next;
  }
}

function runtime(tokens = ["session-1", "lane-1", "lane-2"]) {
  let index = 0;
  return {
    nowMs: () => NOW,
    newToken: () => tokens[index++] ?? `token-${index}`,
  };
}

async function bind(host: ChromiumLaneHost, tabId = 7): Promise<string> {
  const result = await host.bindTab(tabId);
  expect(result).toMatchObject({ outcome: "applied", reason: "bound" });
  expect(result.laneId).toBeTruthy();
  return result.laneId!;
}

async function markReloadSafe(host: ChromiumLaneHost, laneId: string): Promise<void> {
  expect(
    await host.setSignals(laneId, {
      ...DEFAULT_LANE_SIGNALS,
      generating: false,
      unsaved: false,
      safeToDiscard: "yes",
    }),
  ).toMatchObject({ outcome: "applied", reason: "signals-updated" });
}

function expectFixedFailure(result: LaneHostReceipt, reason: string): void {
  expect(result).toMatchObject({ outcome: "failed", reason });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
}

describe("ChromiumLaneHost projection recovery", () => {
  it("keeps a bound projection across MV3 service-worker restart in the same browser session", async () => {
    const browser = new FakeBrowser();
    const storage = new FakeStorage();
    const first = new ChromiumLaneHost(browser, storage, runtime());
    const laneId = await bind(first);
    await markReloadSafe(first, laneId);

    const restarted = new ChromiumLaneHost(browser, storage, runtime(["unused-session-token"]));
    expect(await restarted.initialize()).toMatchObject({ outcome: "observed", reason: "initialized" });
    const inspected = await restarted.inspect(laneId);
    expect(inspected.receipt).toMatchObject({
      outcome: "observed",
      reason: "inspected",
      decision: { action: "discard-candidate" },
    });
    expect(inspected.lifecycle?.laneId).toBe(laneId);
  });

  it("clears stale tab projections when the browser session epoch changes, even if the tab id is reused", async () => {
    const browser = new FakeBrowser();
    const storage = new FakeStorage();
    const first = new ChromiumLaneHost(browser, storage, runtime());
    const laneId = await bind(first);

    storage.session.clear();
    browser.tabs.set(7, tab({ id: 7 }));
    const afterBrowserRestart = new ChromiumLaneHost(browser, storage, runtime(["session-2"]));
    expect(await afterBrowserRestart.initialize()).toMatchObject({ outcome: "observed", reason: "reconciled" });
    expect(await afterBrowserRestart.inspect(laneId)).toMatchObject({
      receipt: { outcome: "refused", reason: "projection-missing" },
      lifecycle: null,
    });
  });

  it("clears a same-session projection when the tab disappears", async () => {
    const browser = new FakeBrowser();
    const storage = new FakeStorage();
    const host = new ChromiumLaneHost(browser, storage, runtime());
    const laneId = await bind(host);
    browser.tabs.delete(7);

    expect(await host.inspect(laneId)).toMatchObject({
      receipt: { outcome: "refused", reason: "tab-missing" },
      lifecycle: null,
    });
    expect((await host.listLanes()).lanes[0]?.projection).toBeNull();
  });

  it("updates a projection on Chromium tab replacement", async () => {
    const browser = new FakeBrowser([tab({ id: 7 }), tab({ id: 9 })]);
    const storage = new FakeStorage();
    const host = new ChromiumLaneHost(browser, storage, runtime());
    const laneId = await bind(host, 7);

    expect(await host.noteTabReplaced(9, 7)).toMatchObject({ reason: "tab-replaced", laneId });
    expect((await host.listLanes()).lanes[0]?.projection?.tabId).toBe(9);
  });
});

describe("ChromiumLaneHost native lifecycle actions", () => {
  it("never discards from observation alone", async () => {
    const browser = new FakeBrowser();
    const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
    const laneId = await bind(host);
    await markReloadSafe(host, laneId);

    expect((await host.inspect(laneId)).receipt.decision?.action).toBe("discard-candidate");
    expect(browser.discarded).toEqual([]);
  });

  it("executes native discard only after the governor returns discard-candidate", async () => {
    const browser = new FakeBrowser();
    const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
    const laneId = await bind(host);

    expect(await host.discard(laneId)).toMatchObject({ outcome: "refused", reason: "discard-refused" });
    expect(browser.discarded).toEqual([]);

    await markReloadSafe(host, laneId);
    expect(await host.discard(laneId)).toMatchObject({ outcome: "applied", reason: "discarded" });
    expect(browser.discarded).toEqual([7]);
  });

  it("refuses active, pinned, and unknown-safety lanes", async () => {
    for (const current of [tab({ active: true }), tab({ pinned: true }), tab()]) {
      const browser = new FakeBrowser([current]);
      const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
      const laneId = await bind(host);
      if (current.pinned || current.active) await markReloadSafe(host, laneId);
      expect(await host.discard(laneId)).toMatchObject({ outcome: "refused", reason: "discard-refused" });
      expect(browser.discarded).toEqual([]);
    }
  });

  it("activates a discarded lane without claiming application readiness", async () => {
    const browser = new FakeBrowser([tab({ discarded: true })]);
    const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
    const laneId = await bind(host);

    expect(await host.wake(laneId)).toMatchObject({ outcome: "applied", reason: "wake-applied" });
    expect(browser.updates.at(-1)).toEqual({ tabId: 7, update: { active: true } });
  });

  it("protects automatic discard explicitly and only removes protection it owns", async () => {
    const browser = new FakeBrowser();
    const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
    const laneId = await bind(host);

    expect(await host.protectFromAutomaticDiscard(laneId)).toMatchObject({
      outcome: "applied",
      reason: "protected",
    });
    expect(browser.tabs.get(7)?.autoDiscardable).toBe(false);
    expect(await host.removeAutomaticDiscardProtection(laneId)).toMatchObject({
      outcome: "applied",
      reason: "unprotected",
    });
    expect(browser.tabs.get(7)?.autoDiscardable).toBe(true);

    const browserProtected = new FakeBrowser([tab({ autoDiscardable: false })]);
    const second = new ChromiumLaneHost(browserProtected, new FakeStorage(), runtime());
    const secondLane = await bind(second);
    expect(await second.protectFromAutomaticDiscard(secondLane)).toMatchObject({
      outcome: "observed",
      reason: "already-protected",
    });
    expect(await second.removeAutomaticDiscardProtection(secondLane)).toMatchObject({
      outcome: "refused",
      reason: "protection-not-owned",
    });
    expect(browserProtected.tabs.get(7)?.autoDiscardable).toBe(false);
  });
});

describe("ChromiumLaneHost failures", () => {
  it("contains browser failures behind fixed content-free receipts", async () => {
    const browser = new FakeBrowser();
    const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
    const laneId = await bind(host);
    browser.throwOnGet = true;

    expectFixedFailure((await host.inspect(laneId)).receipt, "tab-read-failed");
  });

  it("fails closed when durable storage cannot be read", async () => {
    const storage = new FakeStorage();
    storage.failLocalRead = true;
    const host = new ChromiumLaneHost(new FakeBrowser(), storage, runtime());

    expectFixedFailure(await host.initialize(), "stored-state-read-failed");
    expectFixedFailure(await host.bindTab(7), "stored-state-read-failed");
  });

  it("does not leave an owned protection when recording ownership fails and rollback succeeds", async () => {
    const browser = new FakeBrowser();
    const storage = new FakeStorage();
    const host = new ChromiumLaneHost(browser, storage, runtime());
    const laneId = await bind(host);
    storage.failLocalWrite = true;

    expect(await host.protectFromAutomaticDiscard(laneId)).toMatchObject({
      outcome: "failed",
      reason: "stored-state-write-failed",
    });
    expect(browser.tabs.get(7)?.autoDiscardable).toBe(true);
  });

  it("contains discard errors and keeps the lane resident", async () => {
    const browser = new FakeBrowser();
    const host = new ChromiumLaneHost(browser, new FakeStorage(), runtime());
    const laneId = await bind(host);
    await markReloadSafe(host, laneId);
    browser.throwOnDiscard = true;

    expectFixedFailure(await host.discard(laneId), "discard-failed");
    expect(browser.tabs.get(7)?.discarded).toBe(false);
  });
});
