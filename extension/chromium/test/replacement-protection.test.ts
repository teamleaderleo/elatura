// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  ChromiumLaneHost,
  type ChromiumLaneBrowser,
  type ChromiumLaneStorage,
  type ChromiumTabSnapshot,
} from "../src/host.js";

const NOW = 1_000_000;

function tab(id: number, autoDiscardable = true): ChromiumTabSnapshot {
  return {
    id,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    frozen: false,
    autoDiscardable,
    lastAccessedMs: NOW - 600_000,
  };
}

class MemoryStorage implements ChromiumLaneStorage {
  local = new Map<string, unknown>();
  session = new Map<string, unknown>();

  async getLocal(key: string): Promise<unknown> {
    return this.local.get(key);
  }
  async setLocal(key: string, value: unknown): Promise<void> {
    this.local.set(key, value);
  }
  async getSession(key: string): Promise<unknown> {
    return this.session.get(key);
  }
  async setSession(key: string, value: unknown): Promise<void> {
    this.session.set(key, value);
  }
}

class ReplacementBrowser implements ChromiumLaneBrowser {
  tabs = new Map<number, ChromiumTabSnapshot>([
    [7, tab(7)],
    [9, tab(9, false)],
  ]);

  async listTabs(): Promise<readonly ChromiumTabSnapshot[]> {
    return [...this.tabs.values()];
  }
  async getTab(tabId: number): Promise<ChromiumTabSnapshot | null> {
    return this.tabs.get(tabId) ?? null;
  }
  async updateTab(
    tabId: number,
    update: { active?: boolean; autoDiscardable?: boolean },
  ): Promise<ChromiumTabSnapshot | null> {
    const current = this.tabs.get(tabId);
    if (!current) return null;
    const next = { ...current, ...update };
    this.tabs.set(tabId, next);
    return next;
  }
  async discardTab(): Promise<ChromiumTabSnapshot | null> {
    return null;
  }
}

describe("Chromium tab replacement protection ownership", () => {
  it("drops Elatura ownership instead of inheriting a protected replacement tab", async () => {
    const browser = new ReplacementBrowser();
    const storage = new MemoryStorage();
    const tokens = ["session-1", "lane-1"];
    let tokenIndex = 0;
    const host = new ChromiumLaneHost(browser, storage, {
      nowMs: () => NOW,
      newToken: () => tokens[tokenIndex++] ?? "token-next",
    });

    const bound = await host.bindTab(7);
    const laneId = bound.laneId!;
    expect(await host.protectFromAutomaticDiscard(laneId)).toMatchObject({
      outcome: "applied",
      reason: "protected",
    });
    expect((await host.listLanes()).lanes[0]?.protectionOwned).toBe(true);

    expect(await host.noteTabReplaced(9, 7)).toMatchObject({
      outcome: "observed",
      reason: "tab-replaced",
      laneId,
    });

    const replacement = (await host.listLanes()).lanes[0];
    expect(replacement?.projection?.tabId).toBe(9);
    expect(replacement?.protectionOwned).toBe(false);
    expect(browser.tabs.get(9)?.autoDiscardable).toBe(false);

    expect(await host.removeAutomaticDiscardProtection(laneId)).toMatchObject({
      outcome: "refused",
      reason: "protection-not-owned",
    });
    expect(browser.tabs.get(9)?.autoDiscardable).toBe(false);
  });
});
