// SPDX-License-Identifier: MPL-2.0

const OBSERVATION_STATE_SCHEMA_VERSION = 2 as const;
const MAX_PATH_CLASSES = 256;
const OVERFLOW_PATH_TEMPLATE = "/:elatura-overflow";

type BackgroundObservationRun = { id: string; startedAt: string };
type BackgroundRequestMetric = {
  runId: string;
  method: string;
  resourceType: string;
  pathTemplate: string;
  bytes: number;
  durationMs: number;
  outcome: "stopped" | "error";
};
type BackgroundPageMetric = {
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
  pathTemplate: string;
};
type BackgroundPathAggregate = {
  pathTemplate: string;
  count: number;
  bytes: number;
  durationMs: number;
  maxDurationMs: number;
  errors: number;
  methods: string[];
  resourceTypes: string[];
};
type BackgroundObservationState = {
  storageSchemaVersion: typeof OBSERVATION_STATE_SCHEMA_VERSION;
  activeRun?: BackgroundObservationRun;
  summary: {
    requestCount: number;
    totalBytesObserved: number;
    totalRequestDurationMs: number;
    requestErrorCount: number;
  };
  requestPaths: Record<string, BackgroundPathAggregate>;
  pageMarks: { domContentLoadedMs: number | null; composerReadyMs: number | null };
  integrity: {
    pathClassLimit: number;
    pathClassOverflowed: boolean;
    overflowRequestCount: number;
    persistenceErrorCount: number;
  };
};

function idleState(): BackgroundObservationState {
  return {
    storageSchemaVersion: OBSERVATION_STATE_SCHEMA_VERSION,
    summary: {
      requestCount: 0,
      totalBytesObserved: 0,
      totalRequestDurationMs: 0,
      requestErrorCount: 0,
    },
    requestPaths: {},
    pageMarks: { domContentLoadedMs: null, composerReadyMs: null },
    integrity: {
      pathClassLimit: MAX_PATH_CLASSES,
      pathClassOverflowed: false,
      overflowRequestCount: 0,
      persistenceErrorCount: 0,
    },
  };
}

function activeState(run: BackgroundObservationRun): BackgroundObservationState {
  return { ...idleState(), activeRun: run };
}

function isCurrentState(value: unknown): value is BackgroundObservationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BackgroundObservationState>;
  return (
    state.storageSchemaVersion === OBSERVATION_STATE_SCHEMA_VERSION &&
    typeof state.summary === "object" &&
    state.summary !== null &&
    typeof state.requestPaths === "object" &&
    state.requestPaths !== null &&
    typeof state.pageMarks === "object" &&
    state.pageMarks !== null &&
    typeof state.integrity === "object" &&
    state.integrity !== null
  );
}

let observationState = idleState();
let storageWriteQueue: Promise<void> = browser.storage.local
  .get<Record<string, unknown>>()
  .then(async (stored) => {
    if (isCurrentState(stored)) observationState = stored;
    else await browser.storage.local.clear();
  })
  .catch((error: unknown) => {
    console.warn("Elatura could not initialize observation storage.", error);
  });

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
      if (observationState.activeRun) observationState.integrity.persistenceErrorCount += 1;
      console.warn("Elatura could not persist observation state.", error);
    });
  return storageWriteQueue;
}

function persistCurrentState(): Promise<void> {
  return browser.storage.local.set(observationState as unknown as Record<string, unknown>);
}

function startObservationRun(): Promise<BackgroundObservationRun> {
  const run: BackgroundObservationRun = { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
  return enqueueStorage(async () => {
    observationState = activeState(run);
    await browser.storage.local.clear();
    await persistCurrentState();
  }).then(() => run);
}

function clearObservationRun(): Promise<void> {
  return enqueueStorage(async () => {
    observationState = idleState();
    await browser.storage.local.clear();
  });
}

async function getObservationState(): Promise<BackgroundObservationState> {
  await storageWriteQueue.catch(() => undefined);
  return structuredClone(observationState);
}

function sortedUnion(values: readonly string[], addition: string): string[] {
  return values.includes(addition) ? [...values] : [...values, addition].sort();
}

function aggregateRequest(metric: BackgroundRequestMetric): Promise<void> {
  return enqueueStorage(async () => {
    if (observationState.activeRun?.id !== metric.runId) return;

    observationState.summary.requestCount += 1;
    observationState.summary.totalBytesObserved += metric.bytes;
    observationState.summary.totalRequestDurationMs += metric.durationMs;
    if (metric.outcome === "error") observationState.summary.requestErrorCount += 1;

    let pathTemplate = metric.pathTemplate;
    let aggregate = observationState.requestPaths[pathTemplate];
    if (!aggregate) {
      const knownPathCount = Object.keys(observationState.requestPaths).filter(
        (path) => path !== OVERFLOW_PATH_TEMPLATE,
      ).length;
      if (knownPathCount >= observationState.integrity.pathClassLimit) {
        pathTemplate = OVERFLOW_PATH_TEMPLATE;
        observationState.integrity.pathClassOverflowed = true;
        observationState.integrity.overflowRequestCount += 1;
        aggregate = observationState.requestPaths[pathTemplate];
      }
    }
    aggregate ??= {
      pathTemplate,
      count: 0,
      bytes: 0,
      durationMs: 0,
      maxDurationMs: 0,
      errors: 0,
      methods: [],
      resourceTypes: [],
    };
    aggregate.count += 1;
    aggregate.bytes += metric.bytes;
    aggregate.durationMs += metric.durationMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, metric.durationMs);
    if (metric.outcome === "error") aggregate.errors += 1;
    aggregate.methods = sortedUnion(aggregate.methods, metric.method);
    aggregate.resourceTypes = sortedUnion(aggregate.resourceTypes, metric.resourceType);
    observationState.requestPaths[pathTemplate] = aggregate;
    await persistCurrentState();
  });
}

function isPageMetric(value: unknown): value is BackgroundPageMetric {
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

function recordPageMetric(metric: BackgroundPageMetric): Promise<void> {
  return enqueueStorage(async () => {
    if (!observationState.activeRun) return;
    if (metric.kind === "dom-content-loaded") observationState.pageMarks.domContentLoadedMs = metric.elapsedMs;
    else observationState.pageMarks.composerReadyMs = metric.elapsedMs;
    await persistCurrentState();
  });
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const run = observationState.activeRun;
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
      void aggregateRequest({
        runId: run.id,
        method: details.method,
        resourceType: details.type,
        pathTemplate: redactPath(details.url),
        bytes,
        durationMs: Math.max(0, performance.now() - startedAt),
        outcome,
      });
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
  { urls: ["https://chatgpt.com/*"], types: ["xmlhttprequest", "other"] },
);

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { type?: string; metric?: unknown };
  if (candidate.type === "elatura:start-run") return startObservationRun();
  if (candidate.type === "elatura:clear-run") return clearObservationRun();
  if (candidate.type === "elatura:get-state") return getObservationState();
  if (candidate.type === "elatura:page-metric" && isPageMetric(candidate.metric)) {
    return recordPageMetric(candidate.metric);
  }
  return undefined;
});
