// SPDX-License-Identifier: MPL-2.0

export const OBSERVATION_STATE_SCHEMA_VERSION = 2 as const;
export const OBSERVATION_REPORT_SCHEMA_VERSION = 2 as const;
export const OVERFLOW_PATH_TEMPLATE = "/:elatura-overflow";

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
};

export type StoredObservationState = {
  storageSchemaVersion: typeof OBSERVATION_STATE_SCHEMA_VERSION;
  activeRun?: ObservationRun;
  summary: ObservationRequestSummary;
  requestPaths: Record<string, ObservationPathAggregate>;
  pageMarks: ObservationPageMarks;
  integrity: ObservationCaptureIntegrity;
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
  };
  summary: ObservationRequestSummary & ObservationPageMarks;
  requestPaths: ObservationPathAggregate[];
};

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be finite and non-negative.`);
}

function validateState(state: StoredObservationState): ObservationPathAggregate[] {
  if (state.storageSchemaVersion !== OBSERVATION_STATE_SCHEMA_VERSION) {
    throw new TypeError("Unsupported observation-state schema.");
  }
  if (!state.activeRun) throw new Error("Start an observation run before exporting.");
  finiteNonNegative(state.summary.requestCount, "requestCount");
  finiteNonNegative(state.summary.totalBytesObserved, "totalBytesObserved");
  finiteNonNegative(state.summary.totalRequestDurationMs, "totalRequestDurationMs");
  finiteNonNegative(state.summary.requestErrorCount, "requestErrorCount");

  const paths = Object.values(state.requestPaths);
  const totals = paths.reduce(
    (sum, path) => {
      if (path.pathTemplate.includes("?") || !path.pathTemplate.startsWith("/")) {
        throw new TypeError("Observation path templates must be redacted paths.");
      }
      finiteNonNegative(path.count, `${path.pathTemplate}.count`);
      finiteNonNegative(path.bytes, `${path.pathTemplate}.bytes`);
      finiteNonNegative(path.durationMs, `${path.pathTemplate}.durationMs`);
      finiteNonNegative(path.maxDurationMs, `${path.pathTemplate}.maxDurationMs`);
      finiteNonNegative(path.errors, `${path.pathTemplate}.errors`);
      if (!Number.isInteger(path.count) || !Number.isInteger(path.bytes) || !Number.isInteger(path.errors)) {
        throw new TypeError("Request counts, bytes, and errors must be integers.");
      }
      if (path.errors > path.count || path.maxDurationMs > path.durationMs) {
        throw new TypeError(`Observation aggregate is inconsistent for ${path.pathTemplate}.`);
      }
      return {
        count: sum.count + path.count,
        bytes: sum.bytes + path.bytes,
        durationMs: sum.durationMs + path.durationMs,
        errors: sum.errors + path.errors,
      };
    },
    { count: 0, bytes: 0, durationMs: 0, errors: 0 },
  );
  const close = (left: number, right: number) => Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9);
  if (
    totals.count !== state.summary.requestCount ||
    totals.bytes !== state.summary.totalBytesObserved ||
    !close(totals.durationMs, state.summary.totalRequestDurationMs) ||
    totals.errors !== state.summary.requestErrorCount
  ) {
    throw new TypeError("Observation summary does not reconcile with path aggregates.");
  }

  const overflow = state.requestPaths[OVERFLOW_PATH_TEMPLATE];
  if (state.integrity.pathClassOverflowed) {
    if (!overflow || overflow.count !== state.integrity.overflowRequestCount) {
      throw new TypeError("Overflow integrity metadata does not reconcile.");
    }
  } else if (overflow || state.integrity.overflowRequestCount !== 0) {
    throw new TypeError("Unexpected overflow aggregate or count.");
  }
  return paths;
}

export function hasObservationData(state: StoredObservationState): boolean {
  return state.summary.requestCount > 0 || state.pageMarks.domContentLoadedMs !== null || state.pageMarks.composerReadyMs !== null;
}

export function buildObservationReport(
  state: StoredObservationState,
  metadata: ObservationReportMetadata,
  generatedAt = new Date().toISOString(),
): ObservationReport {
  const requestPaths = validateState(state)
    .map((path) => ({ ...path, methods: [...path.methods].sort(), resourceTypes: [...path.resourceTypes].sort() }))
    .sort((left, right) => right.bytes - left.bytes || left.pathTemplate.localeCompare(right.pathTemplate));
  const totalsComplete = state.integrity.persistenceErrorCount === 0;
  const pathBreakdownComplete = totalsComplete && !state.integrity.pathClassOverflowed;
  return {
    schemaVersion: OBSERVATION_REPORT_SCHEMA_VERSION,
    generatedAt,
    mode: "observe",
    run: {
      id: state.activeRun!.id,
      startedAt: state.activeRun!.startedAt,
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
      pathClassLimit: state.integrity.pathClassLimit,
      pathClassOverflowed: state.integrity.pathClassOverflowed,
      overflowRequestCount: state.integrity.overflowRequestCount,
      persistenceErrorCount: state.integrity.persistenceErrorCount,
    },
    summary: { ...state.summary, ...state.pageMarks },
    requestPaths,
  };
}
