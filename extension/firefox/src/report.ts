// SPDX-License-Identifier: MPL-2.0
import { isRedactedPathTemplate } from "./path-redaction.js";

export const OBSERVATION_STATE_SCHEMA_VERSION = 4 as const;
export const OBSERVATION_REPORT_SCHEMA_VERSION = 3 as const;
export const OVERFLOW_PATH_TEMPLATE = "/:elatura-overflow";

const MAX_PATH_TEMPLATE_LENGTH = 4_096;
const MAX_PATH_AGGREGATES = 4_097;
const MAX_TAGS_PER_AGGREGATE = 64;
const MAX_TAG_LENGTH = 128;
const MAX_RUN_ID_LENGTH = 256;

export type ObservationRun = { id: string; startedAt: string };

export type ObservationRequestSummary = {
  requestCount: number;
  totalBytesObserved: number;
  totalRequestDurationMs: number;
  requestErrorCount: number;
};

export type ObservationPathAggregate = {
  pathTemplate: string;
  count: number;
  bytes: number;
  durationMs: number;
  maxDurationMs: number;
  errors: number;
  methods: string[];
  resourceTypes: string[];
};

export type ObservationPageMarks = {
  domContentLoadedMs: number | null;
  composerReadyMs: number | null;
};

export type ObservationCaptureIntegrity = {
  pathClassLimit: number;
  pathClassOverflowed: boolean;
  overflowRequestCount: number;
  persistenceErrorCount: number;
  captureInterruptionCount: number;
};

export type StoredObservationState = {
  storageSchemaVersion: typeof OBSERVATION_STATE_SCHEMA_VERSION;
  activeRun?: ObservationRun;
  summary: ObservationRequestSummary;
  requestPaths: Record<string, ObservationPathAggregate>;
  pageMarks: ObservationPageMarks;
  integrity: ObservationCaptureIntegrity;
};

export type ObservationStateMigration = {
  state: StoredObservationState;
  migratedFrom: 2 | 3 | null;
};

export type ObservationReportMetadata = {
  extensionVersion: string;
  browser: { name: string; vendor: string; version: string; buildID: string };
};

export type ObservationReport = {
  schemaVersion: typeof OBSERVATION_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  mode: "observe";
  run: { id: string; startedAt: string; exportedAt: string };
  extension: { version: string };
  browser: ObservationReportMetadata["browser"];
  privacy: {
    responseBodiesCaptured: false;
    messageTextCaptured: false;
    queryStringsCaptured: false;
    credentialsCaptured: false;
    pathsRedacted: true;
  };
  integrity: {
    totalsComplete: boolean;
    pathBreakdownComplete: boolean;
    pathClassLimit: number;
    pathClassOverflowed: boolean;
    overflowRequestCount: number;
    persistenceErrorCount: number;
    captureInterruptionCount: number;
  };
  summary: ObservationRequestSummary & ObservationPageMarks;
  requestPaths: ObservationPathAggregate[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = nonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = nonNegativeNumber(value);
  return parsed === null ? undefined : parsed;
}

function parseTagList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TAGS_PER_AGGREGATE) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== "string" || tag.length === 0 || tag.length > MAX_TAG_LENGTH || seen.has(tag)) {
      return null;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function parseRun(value: unknown): ObservationRun | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > MAX_RUN_ID_LENGTH ||
    typeof value.startedAt !== "string" ||
    Number.isNaN(Date.parse(value.startedAt))
  ) {
    return null;
  }
  return { id: value.id, startedAt: value.startedAt };
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9);
}

function parseStoredObservationState(value: Record<string, unknown>): StoredObservationState | null {
  const sourceVersion = value.storageSchemaVersion;
  if (sourceVersion !== 2 && sourceVersion !== 3 && sourceVersion !== OBSERVATION_STATE_SCHEMA_VERSION) {
    return null;
  }
  if (!isRecord(value.summary) || !isRecord(value.requestPaths) || !isRecord(value.pageMarks) || !isRecord(value.integrity)) {
    return null;
  }

  let activeRun: ObservationRun | undefined;
  if (value.activeRun !== undefined) {
    const parsedRun = parseRun(value.activeRun);
    if (!parsedRun) return null;
    activeRun = parsedRun;
  }

  const requestCount = nonNegativeInteger(value.summary.requestCount);
  const totalBytesObserved = nonNegativeInteger(value.summary.totalBytesObserved);
  const totalRequestDurationMs = nonNegativeNumber(value.summary.totalRequestDurationMs);
  const requestErrorCount = nonNegativeInteger(value.summary.requestErrorCount);
  if (
    requestCount === null ||
    totalBytesObserved === null ||
    totalRequestDurationMs === null ||
    requestErrorCount === null ||
    requestErrorCount > requestCount
  ) {
    return null;
  }

  const domContentLoadedMs = nullableNonNegativeNumber(value.pageMarks.domContentLoadedMs);
  const composerReadyMs = nullableNonNegativeNumber(value.pageMarks.composerReadyMs);
  if (domContentLoadedMs === undefined || composerReadyMs === undefined) return null;

  const pathClassLimit = positiveInteger(value.integrity.pathClassLimit);
  const overflowRequestCount = nonNegativeInteger(value.integrity.overflowRequestCount);
  const persistenceErrorCount = nonNegativeInteger(value.integrity.persistenceErrorCount);
  const captureInterruptionCount =
    sourceVersion === 2 ? 0 : nonNegativeInteger(value.integrity.captureInterruptionCount);
  if (
    pathClassLimit === null ||
    pathClassLimit > MAX_PATH_AGGREGATES ||
    typeof value.integrity.pathClassOverflowed !== "boolean" ||
    overflowRequestCount === null ||
    persistenceErrorCount === null ||
    captureInterruptionCount === null
  ) {
    return null;
  }
  const pathClassOverflowed = value.integrity.pathClassOverflowed;

  const pathEntries = Object.entries(value.requestPaths);
  if (pathEntries.length > Math.min(MAX_PATH_AGGREGATES, pathClassLimit + 1)) return null;

  const requestPaths: Record<string, ObservationPathAggregate> = {};
  let aggregateCount = 0;
  let aggregateBytes = 0;
  let aggregateDurationMs = 0;
  let aggregateErrors = 0;
  let nonOverflowPathCount = 0;

  for (const [key, rawPath] of pathEntries) {
    if (!isRecord(rawPath) || typeof rawPath.pathTemplate !== "string" || rawPath.pathTemplate !== key) return null;
    if (
      key.length === 0 ||
      key.length > MAX_PATH_TEMPLATE_LENGTH ||
      !isRedactedPathTemplate(key)
    ) {
      return null;
    }

    const count = positiveInteger(rawPath.count);
    const bytes = nonNegativeInteger(rawPath.bytes);
    const durationMs = nonNegativeNumber(rawPath.durationMs);
    const maxDurationMs = nonNegativeNumber(rawPath.maxDurationMs);
    const errors = nonNegativeInteger(rawPath.errors);
    const methods = parseTagList(rawPath.methods);
    const resourceTypes = parseTagList(rawPath.resourceTypes);
    if (
      count === null ||
      bytes === null ||
      durationMs === null ||
      maxDurationMs === null ||
      errors === null ||
      methods === null ||
      resourceTypes === null ||
      errors > count ||
      maxDurationMs > durationMs
    ) {
      return null;
    }

    if (key !== OVERFLOW_PATH_TEMPLATE) nonOverflowPathCount += 1;
    requestPaths[key] = {
      pathTemplate: key,
      count,
      bytes,
      durationMs,
      maxDurationMs,
      errors,
      methods,
      resourceTypes,
    };
    aggregateCount += count;
    aggregateBytes += bytes;
    aggregateDurationMs += durationMs;
    aggregateErrors += errors;
  }

  if (nonOverflowPathCount > pathClassLimit) return null;
  if (
    aggregateCount !== requestCount ||
    aggregateBytes !== totalBytesObserved ||
    !close(aggregateDurationMs, totalRequestDurationMs) ||
    aggregateErrors !== requestErrorCount
  ) {
    return null;
  }

  const overflow = requestPaths[OVERFLOW_PATH_TEMPLATE];
  if (pathClassOverflowed) {
    if (!overflow || overflow.count !== overflowRequestCount || overflowRequestCount === 0) return null;
  } else if (overflow || overflowRequestCount !== 0) {
    return null;
  }

  const hasData =
    requestCount > 0 ||
    domContentLoadedMs !== null ||
    composerReadyMs !== null ||
    persistenceErrorCount > 0 ||
    captureInterruptionCount > 0;
  if (!activeRun && hasData) return null;

  return {
    storageSchemaVersion: OBSERVATION_STATE_SCHEMA_VERSION,
    ...(activeRun ? { activeRun } : {}),
    summary: { requestCount, totalBytesObserved, totalRequestDurationMs, requestErrorCount },
    requestPaths,
    pageMarks: { domContentLoadedMs, composerReadyMs },
    integrity: {
      pathClassLimit,
      pathClassOverflowed,
      overflowRequestCount,
      persistenceErrorCount,
      captureInterruptionCount,
    },
  };
}

export function migrateStoredObservationState(value: unknown): ObservationStateMigration | null {
  if (!isRecord(value)) return null;
  const sourceVersion = value.storageSchemaVersion;
  const migratedFrom = sourceVersion === OBSERVATION_STATE_SCHEMA_VERSION ? null : sourceVersion;
  if (migratedFrom !== null && migratedFrom !== 2 && migratedFrom !== 3) return null;
  const state = parseStoredObservationState(value);
  return state ? { state, migratedFrom } : null;
}

function validatedActiveState(state: StoredObservationState): StoredObservationState {
  const migration = migrateStoredObservationState(state);
  if (!migration || migration.migratedFrom !== null) throw new TypeError("Invalid observation state.");
  if (!migration.state.activeRun) throw new Error("Start an observation run before exporting.");
  return migration.state;
}

export function hasObservationData(state: StoredObservationState): boolean {
  return state.summary.requestCount > 0 || state.pageMarks.domContentLoadedMs !== null || state.pageMarks.composerReadyMs !== null;
}

export function buildObservationReport(
  state: StoredObservationState,
  metadata: ObservationReportMetadata,
  generatedAt = new Date().toISOString(),
): ObservationReport {
  const validated = validatedActiveState(state);
  const requestPaths = Object.values(validated.requestPaths)
    .map((path) => ({ ...path, methods: [...path.methods].sort(), resourceTypes: [...path.resourceTypes].sort() }))
    .sort((left, right) => right.bytes - left.bytes || left.pathTemplate.localeCompare(right.pathTemplate));
  const totalsComplete =
    validated.integrity.persistenceErrorCount === 0 && validated.integrity.captureInterruptionCount === 0;
  const pathBreakdownComplete = totalsComplete && !validated.integrity.pathClassOverflowed;
  return {
    schemaVersion: OBSERVATION_REPORT_SCHEMA_VERSION,
    generatedAt,
    mode: "observe",
    run: {
      id: validated.activeRun!.id,
      startedAt: validated.activeRun!.startedAt,
      exportedAt: generatedAt,
    },
    extension: { version: metadata.extensionVersion },
    browser: { ...metadata.browser },
    privacy: {
      responseBodiesCaptured: false,
      messageTextCaptured: false,
      queryStringsCaptured: false,
      credentialsCaptured: false,
      pathsRedacted: true,
    },
    integrity: {
      totalsComplete,
      pathBreakdownComplete,
      pathClassLimit: validated.integrity.pathClassLimit,
      pathClassOverflowed: validated.integrity.pathClassOverflowed,
      overflowRequestCount: validated.integrity.overflowRequestCount,
      persistenceErrorCount: validated.integrity.persistenceErrorCount,
      captureInterruptionCount: validated.integrity.captureInterruptionCount,
    },
    summary: { ...validated.summary, ...validated.pageMarks },
    requestPaths,
  };
}
