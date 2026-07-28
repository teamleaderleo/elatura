// SPDX-License-Identifier: MPL-2.0

const MAX_REQUEST_METRICS = 200;
const STORAGE_KEY = "requestMetrics";

type BackgroundRequestMetric = {
  id: string;
  method: string;
  resourceType: string;
  pathTemplate: string;
  bytes: number;
  durationMs: number;
  outcome: "stopped" | "error";
  recordedAt: string;
};

function redactPath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.pathname
      .split("/")
      .map((segment) => {
        if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":uuid";
        if (/^\d{6,}$/.test(segment)) return ":number";
        if (/^[A-Za-z0-9_-]{20,}$/.test(segment)) return ":id";
        return segment;
      })
      .join("/");
  } catch {
    return "/:invalid-url";
  }
}

async function appendMetric(metric: BackgroundRequestMetric): Promise<void> {
  const stored = await browser.storage.local.get<{ requestMetrics?: BackgroundRequestMetric[] }>({
    requestMetrics: [],
  });
  const metrics = [...(stored.requestMetrics ?? []), metric].slice(-MAX_REQUEST_METRICS);
  await browser.storage.local.set({ [STORAGE_KEY]: metrics });
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    let filter: StreamFilter;
    try {
      filter = browser.webRequest.filterResponseData(details.requestId);
    } catch {
      return;
    }

    const startedAt = performance.now();
    let bytes = 0;
    let completed = false;

    filter.ondata = (event) => {
      bytes += event.data.byteLength;
      filter.write(event.data);
    };

    const finish = (outcome: BackgroundRequestMetric["outcome"]) => {
      if (completed) return;
      completed = true;
      const metric: BackgroundRequestMetric = {
        id: crypto.randomUUID(),
        method: details.method,
        resourceType: details.type,
        pathTemplate: redactPath(details.url),
        bytes,
        durationMs: Math.max(0, performance.now() - startedAt),
        outcome,
        recordedAt: new Date().toISOString(),
      };
      void appendMetric(metric);
    };

    filter.onstop = () => {
      finish("stopped");
      filter.close();
    };

    filter.onerror = () => {
      finish("error");
      try {
        filter.disconnect();
      } catch {
        // The stream may already be gone. Observation must never break navigation.
      }
    };
  },
  {
    urls: ["https://chatgpt.com/*"],
    types: ["xmlhttprequest", "other"],
  },
);

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { type?: string; metric?: unknown };
  if (candidate.type !== "elatura:page-metric") return undefined;
  return browser.storage.local.get<{ pageMetrics?: unknown[] }>({ pageMetrics: [] }).then((stored) =>
    browser.storage.local.set({
      pageMetrics: [...(stored.pageMetrics ?? []), candidate.metric].slice(-100),
    }),
  );
});
