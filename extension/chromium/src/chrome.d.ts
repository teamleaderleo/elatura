// SPDX-License-Identifier: MPL-2.0

type ChromeLaneTab = {
  id?: number;
  active: boolean;
  pinned: boolean;
  audible?: boolean;
  discarded: boolean;
  frozen?: boolean;
  autoDiscardable: boolean;
  lastAccessed: number;
};

type ChromeStorageArea = {
  get(key?: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

type ChromeEvent<T extends (...args: never[]) => unknown> = {
  addListener(listener: T): void;
};

declare const chrome: {
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
  };
  tabs: {
    query(queryInfo: Record<string, never>): Promise<ChromeLaneTab[]>;
    get(tabId: number): Promise<ChromeLaneTab>;
    update(
      tabId: number,
      updateProperties: { active?: boolean; autoDiscardable?: boolean },
    ): Promise<ChromeLaneTab | undefined>;
    discard(tabId: number): Promise<ChromeLaneTab | undefined>;
    onRemoved: ChromeEvent<(tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void>;
    onReplaced: ChromeEvent<(addedTabId: number, removedTabId: number) => void>;
  };
  runtime: {
    onInstalled: ChromeEvent<(details: { reason: string }) => void>;
    onStartup: ChromeEvent<() => void>;
    onMessage: ChromeEvent<(
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean | void>;
  };
};
