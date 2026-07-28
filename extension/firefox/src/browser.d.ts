// SPDX-License-Identifier: MPL-2.0

declare const browser: {
  storage: {
    local: {
      get<T>(defaults?: T): Promise<T>;
      set(values: Record<string, unknown>): Promise<void>;
      clear(): Promise<void>;
    };
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (message: unknown) => unknown): void;
    };
  };
  webRequest: {
    onBeforeRequest: {
      addListener(
        listener: (details: WebRequestDetails) => void,
        filter: { urls: string[]; types?: string[] },
      ): void;
    };
    filterResponseData(requestId: string): StreamFilter;
  };
};

type WebRequestDetails = {
  requestId: string;
  url: string;
  method: string;
  type: string;
  timeStamp: number;
};

type StreamFilter = {
  ondata: ((event: { data: ArrayBuffer }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  write(data: ArrayBuffer): void;
  close(): void;
  disconnect(): void;
  error?: string;
};
