// SPDX-License-Identifier: MPL-2.0

import {
  ChromiumLaneHost,
  type ChromiumLaneBrowser,
  type ChromiumLaneStorage,
  type ChromiumTabSnapshot,
} from "./host.js";

const INVALID_REQUEST = Object.freeze({
  receipt: Object.freeze({
    outcome: "refused",
    reason: "invalid-request",
    laneId: null,
    decision: null,
  }),
});

function normalizeTab(tab: ChromeLaneTab): ChromiumTabSnapshot | null {
  if (
    !Number.isSafeInteger(tab.id) ||
    (tab.id ?? -1) < 0 ||
    typeof tab.active !== "boolean" ||
    typeof tab.pinned !== "boolean" ||
    (tab.audible !== undefined && typeof tab.audible !== "boolean") ||
    typeof tab.discarded !== "boolean" ||
    (tab.frozen !== undefined && typeof tab.frozen !== "boolean") ||
    typeof tab.autoDiscardable !== "boolean" ||
    typeof tab.lastAccessed !== "number" ||
    !Number.isFinite(tab.lastAccessed) ||
    tab.lastAccessed < 0 ||
    tab.lastAccessed > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return Object.freeze({
    id: tab.id!,
    active: tab.active,
    pinned: tab.pinned,
    audible: tab.audible ?? false,
    discarded: tab.discarded,
    frozen: tab.frozen ?? null,
    autoDiscardable: tab.autoDiscardable,
    lastAccessedMs: Math.floor(tab.lastAccessed),
  });
}

const browser: ChromiumLaneBrowser = {
  async listTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map(normalizeTab).filter((tab): tab is ChromiumTabSnapshot => tab !== null);
  },
  async getTab(tabId) {
    return normalizeTab(await chrome.tabs.get(tabId));
  },
  async updateTab(tabId, update) {
    const tab = await chrome.tabs.update(tabId, update);
    return tab === undefined ? null : normalizeTab(tab);
  },
  async discardTab(tabId) {
    const tab = await chrome.tabs.discard(tabId);
    return tab === undefined ? null : normalizeTab(tab);
  },
};

function storageArea(area: ChromeStorageArea): Pick<ChromiumLaneStorage, "getLocal" | "setLocal"> {
  return {
    async getLocal(key) {
      const result = await area.get(key);
      return Object.getOwnPropertyDescriptor(result, key)?.value;
    },
    async setLocal(key, value) {
      await area.set({ [key]: value });
    },
  };
}

const local = storageArea(chrome.storage.local);
const session = storageArea(chrome.storage.session);
const storage: ChromiumLaneStorage = {
  getLocal: local.getLocal,
  setLocal: local.setLocal,
  async getSession(key) {
    return session.getLocal(key);
  },
  async setSession(key, value) {
    await session.setLocal(key, value);
  },
};

const host = new ChromiumLaneHost(browser, storage, {
  nowMs: () => Date.now(),
  newToken: () => crypto.randomUUID(),
});

void host.initialize();
chrome.runtime.onInstalled.addListener(() => {
  void host.initialize();
});
chrome.runtime.onStartup.addListener(() => {
  void host.initialize();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void host.noteTabRemoved(tabId);
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void host.noteTabReplaced(addedTabId, removedTabId);
});

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function asRequest(message: unknown): Record<string, unknown> | null {
  try {
    if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
    const prototype = Object.getPrototypeOf(message);
    if (prototype !== Object.prototype && prototype !== null) return null;
    return message as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function dispatch(message: unknown): Promise<unknown> {
  const request = asRequest(message);
  if (request === null) return INVALID_REQUEST;
  const type = dataProperty(request, "type");
  if (typeof type !== "string") return INVALID_REQUEST;

  switch (type) {
    case "elatura:chromium:list-lanes":
      return host.listLanes();
    case "elatura:chromium:bind-tab":
      return host.bindTab(dataProperty(request, "tabId") as number);
    case "elatura:chromium:set-signals":
      return host.setSignals(
        dataProperty(request, "laneId") as string,
        dataProperty(request, "signals"),
      );
    case "elatura:chromium:inspect":
      return host.inspect(dataProperty(request, "laneId") as string);
    case "elatura:chromium:discard":
      return host.discard(dataProperty(request, "laneId") as string);
    case "elatura:chromium:wake":
      return host.wake(dataProperty(request, "laneId") as string);
    case "elatura:chromium:protect":
      return host.protectFromAutomaticDiscard(dataProperty(request, "laneId") as string);
    case "elatura:chromium:unprotect":
      return host.removeAutomaticDiscardProtection(dataProperty(request, "laneId") as string);
    case "elatura:chromium:forget":
      return host.forget(dataProperty(request, "laneId") as string);
    default:
      return INVALID_REQUEST;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void dispatch(message).then(
    (response) => sendResponse(response),
    () => sendResponse(INVALID_REQUEST),
  );
  return true;
});
