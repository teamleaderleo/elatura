// SPDX-License-Identifier: MPL-2.0

import {
  FIREFOX_CHATGPT_ACTIVITY_CONTENT_MESSAGE_TYPE,
  admitFirefoxChatGptActivityRouteResponseV1,
  createFirefoxChatGptActivityRouteFailureV1,
  parseFirefoxChatGptActivityRouteMessageV1,
  type FirefoxChatGptActivityRouteRequestV1,
  type FirefoxChatGptActivityRouteReceiptV1,
} from "./chatgpt-lane-activity-route.js";
import {
  migrateStoredObservationState,
  OBSERVATION_ACTIVE_REQUEST_LIMIT,
  OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES,
  OBSERVATION_STATE_SCHEMA_VERSION,
  OVERFLOW_PATH_TEMPLATE,
  type ObservationPathAggregate,
  type ObservationRun,
  type StoredObservationState,
} from "./report.js";
import { redactPath } from "./path-redaction.js";
import { createTransformOptInController } from "./transform-opt-in.js";
import {
  BUNDLED_ADAPTER_DENYLIST,
  createTransformSafetyController,
} from "./transform-safety.js";
import {
  clearAllVolatileTransformState,
  registerVolatileTransformStateClearer,
} from "./volatile-transform-state.js";

const MAX_PATH_CLASSES = 256;

type BackgroundRequestMetric = {
  runId: string;
  method: string;
  resourceType: string;
  pathTemplate: string;
  bytes: number;
  durationMs: number;
  outcome: "stopped" | "error";
  oversized: boolean;
};
type BackgroundPageMetric = {
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
};

const transformOptIn = createTransformOptInController();
registerVolatileTransformStateClearer(() => {
  transformOptIn.revoke("emergency-disable");
});
const transformSafety = createTransformSafetyController({
  denylist: BUNDLED_ADAPTER_DENYLIST,
  clearVolatileTransformState: clearAllVolatileTransformState,
});

function idleState(): StoredObservationState {
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
      captureInterruptionCount: 0,
      activeRequestLimit: OBSERVATION_ACTIVE_REQUEST_LIMIT,
      activeRequestCount: 0,
      unobservedRequestCount: 0,
      bodySizeWarningThresholdBytes: OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES,
      oversizedResponseCount: 0,
    },
  };
}

function activeState(run: ObservationRun): StoredObservationState {
  return { ...idleState(), activeRun: run };
}

let observationState = idleState();
let storageWriteQueue: Promise<void> = browser.storage.local
  .get<Record<string, unknown>>()
  .then(async (stored) => {
    const migration = migrateStoredObservationState(stored);
    if (!migration) {
      await browser.storage.local.clear();
      return;
    }

    observationState = migration.state;
    if (observationState.activeRun) {
      observationState.integrity.activeRequestCount = 0;
      observationState.integrity.captureInterruptionCount += 1;
      await persistCurrentState();
    } else if (migration.migratedFrom !== null) {
      await persistCurrentState();
    }
  })
  .catch(() => {
    if (observationState.activeRun) observationState.integrity.persistenceErrorCount += 1;
  });

function enqueueStorage(operation: () => Promise<void>): Promise<void> {
  storageWriteQueue = storageWriteQueue
    .catch(() => undefined)
    .then(operation)
    .catch(() => {
      if (observationState.activeRun) observationState.integrity.persistenceErrorCount += 1;
    });
  return storageWriteQueue;
}

function persistCurrentState(): Promise<void> {
  return browser.storage.local.set(observationState as unknown as Record<string, unknown>);
}

function startObservationRun(): Promise<ObservationRun> {
  const run: ObservationRun = { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
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

async function getObservationState(): Promise<StoredObservationState> {
  await storageWriteQueue.catch(() => undefined);
  return structuredClone(observationState);
}

function sortedUnion(values: readonly string[], addition: string): string[] {
  return values.includes(addition) ? [...values] : [...values, addition].sort();
}

function recordUnobservedRequest(runId: string): Promise<void> {
  return enqueueStorage(async () => {
    if (observationState.activeRun?.id !== runId) return;
    observationState.integrity.unobservedRequestCount += 1;
    await persistCurrentState();
  });
}

function aggregateRequest(metric: BackgroundRequestMetric): Promise<void> {
  return enqueueStorage(async () => {
    if (observationState.activeRun?.id !== metric.runId) return;

    observationState.integrity.activeRequestCount = Math.max(
      0,
      observationState.integrity.activeRequestCount - 1,
    );
    observationState.summary.requestCount += 1;
    observationState.summary.totalBytesObserved += metric.bytes;
    observationState.summary.totalRequestDurationMs += metric.durationMs;
    if (metric.outcome === "error") observationState.summary.requestErrorCount += 1;
    if (metric.oversized) observationState.integrity.oversizedResponseCount += 1;

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
    } satisfies ObservationPathAggregate;
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
    !Number.isNaN(Date.parse(metric.recordedAt))
  );
}

function recordPageMetric(metric: BackgroundPageMetric): Promise<void> {
  return enqueueStorage(async () => {
    const run = observationState.activeRun;
    if (!run || Date.parse(metric.recordedAt) < Date.parse(run.startedAt)) return;
    if (metric.kind === "dom-content-loaded") observationState.pageMarks.domContentLoadedMs = metric.elapsedMs;
    else observationState.pageMarks.composerReadyMs = metric.elapsedMs;
    await persistCurrentState();
  });
}

async function sampleChatGptLaneActivityOnTab(
  request: FirefoxChatGptActivityRouteRequestV1,
): Promise<FirefoxChatGptActivityRouteReceiptV1> {
  let response: unknown;
  try {
    response = await browser.tabs.sendMessage(request.tabId, {
      type: FIREFOX_CHATGPT_ACTIVITY_CONTENT_MESSAGE_TYPE,
      target: {
        laneRef: request.laneRef,
        laneGeneration: request.laneGeneration,
      },
    });
  } catch {
    return createFirefoxChatGptActivityRouteFailureV1(
      request,
      "unavailable",
      "content_unavailable",
    );
  }
  try {
    return admitFirefoxChatGptActivityRouteResponseV1(request, response);
  } catch {
    return createFirefoxChatGptActivityRouteFailureV1(
      request,
      "browser_error",
      "operation_failed",
    );
  }
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const run = observationState.activeRun;
    if (!run) return;
    if (observationState.integrity.activeRequestCount >= observationState.integrity.activeRequestLimit) {
      void recordUnobservedRequest(run.id);
      return;
    }

    let filter: StreamFilter;
    try {
      filter = browser.webRequest.filterResponseData(details.requestId);
    } catch {
      void recordUnobservedRequest(run.id);
      return;
    }

    observationState.integrity.activeRequestCount += 1;
    const bodySizeWarningThresholdBytes = observationState.integrity.bodySizeWarningThresholdBytes;
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
        oversized: bytes > bodySizeWarningThresholdBytes,
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

browser.runtime.onMessage.addListener((message, sender) => {
  const activityRequest = parseFirefoxChatGptActivityRouteMessageV1(message);
  if (activityRequest !== null) {
    // Content scripts may report their own page metrics, but only extension
    // contexts can route an explicit lane-generation target to another tab.
    if (sender?.tab?.id !== undefined) return undefined;
    return sampleChatGptLaneActivityOnTab(activityRequest);
  }

  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { type?: string; metric?: unknown; acknowledgements?: unknown };
  if (candidate.type === "elatura:start-run") return startObservationRun();
  if (candidate.type === "elatura:clear-run") return clearObservationRun();
  if (candidate.type === "elatura:get-state") return getObservationState();
  if (candidate.type === "elatura:get-transform-safety") return transformSafety.getState();
  if (candidate.type === "elatura:get-transform-opt-in") return transformOptIn.getState();
  if (candidate.type === "elatura:record-transform-opt-in") {
    return transformOptIn.record(candidate.acknowledgements);
  }
  if (candidate.type === "elatura:revoke-transform-opt-in") {
    return transformOptIn.revoke("user-revoked");
  }
  if (candidate.type === "elatura:emergency-disable-transforms") {
    return transformSafety.emergencyDisable();
  }
  if (candidate.type === "elatura:page-metric" && isPageMetric(candidate.metric)) {
    return recordPageMetric(candidate.metric);
  }
  return undefined;
});
