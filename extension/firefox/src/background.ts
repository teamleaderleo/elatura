// SPDX-License-Identifier: MPL-2.0

const MAX_REQUEST_METRICS = 200;
const MAX_PAGE_METRICS = 100;
let storageWriteQueue: Promise<void> = Promise.resolve();

type ObservationRun = {
  id: string;
  startedAt: string;
};

type BackgroundRequestMetric = {
  runId: string;
  method: string;
  resourceType: string;
  pathTemplate: string;
  bytes: number;
  durationMs: number;
  outcome: "stopped" | "error";
  recordedAt: string;
};

type BackgroundPageMetric = {
  runId: string;
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
  pathTemplate: string;
};

type StoredObservationState = {
  activeRun?: ObservationRun;
  requestMetrics?: BackgroundRequestMetric[];
  pageMetrics?: BackgroundPageMetric[];
};

let activeRun: ObservationRun | null = null;
void browser.storage.local
  .get<StoredObservationState>()
  .then((stored) => {
    activeRun = stored.activeRun ?? null;
  })
  .catch(() => undefined);

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

function enqueueStorage(operation: () => Promise<void>): Promise<void> {
  storageWriteQueue = storageWriteQueue
    .catch(() => undefined)
    .then(operation)
    .catch((error: unknown) => {
      console.warn("Elatura could not persist observation state.", error);
    });
  return storageWriteQueue;
}

function appendBounded<T>(key: string, item: T, limit: number): Promise<void> {
  return enqueueStorage(async () => {
    const stored = await browser.storage.local.get<Record<string, T[]>>({ [key]: [] });
    const current = Array.isArray(stored[key]) ? stored[key] : [];
    await browser.storage.local.set({ [key]: [...current, item].slice(-limit) });
  });
}

function startObservationRun(): Promise<ObservationRun> {
  const run: ObservationRun = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
  };
  activeRun = run;
  return enqueueStorage(async () => {
    await browser.storage.local.clear();
    await browser.storage.local.set({ activeRun: run });
  }).then(() => run);
}

function clearObservationRun(): Promise<void> {
  activeRun = null;
  return enqueueStorage(() => browser.storage.local.clear());
}

async function getObservationState(): Promise<StoredObservationState> {
  await storageWriteQueue.catch(() => undefined);
  return browser.storage.local.get<StoredObservationState>({
    requestMetrics: [],
    pageMetrics: [],
  });
}

function isPageMetric(value: unknown): value is Omit<BackgroundPageMetric, "runId"> {
  if (!value || typeof value !== "object") return false;
  const metric = value as Partial<BackgroundPageMetric>;
  return (
    (metric.kind === "dom-content-loaded" || metric.kind === "composer-like-input") &&
    typeof metric.elapsedMs === "number" &&
    Number.isFinite(metric.elapsedMs) &&
    metric.elapsedMs >= 0 &&
    typeof metric.recordedAt === "string" &&
    typeof metric.pathTemplate === "string" &&
    !metric.pathTemplate.includes("?")
  );
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const run = activeRun;
    if (!run) return;

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
        runId: run.id,
        method: details.method,
        resourceType: details.type,
        pathTemplate: redactPath(details.url),
        bytes,
        durationMs: Math.max(0, performance.now() - startedAt),
        outcome,
        recordedAt: new Date().toISOString(),
      };
      void appendBounded("requestMetrics", metric, MAX_REQUEST_METRICS);
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

  if (candidate.type === "elatura:start-run") return startObservationRun();
  if (candidate.type === "elatura:clear-run") return clearObservationRun();
  if (candidate.type === "elatura:get-state") return getObservationState();

  if (candidate.type !== "elatura:page-metric" || !isPageMetric(candidate.metric)) return undefined;
  const run = activeRun;
  if (!run) return undefined;
  return appendBounded(
    "pageMetrics",
    { ...candidate.metric, runId: run.id },
    MAX_PAGE_METRICS,
  );
});
