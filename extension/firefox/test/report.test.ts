// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseObservationReport } from "../../../benchmarks/src/observation.js";
import {
  buildObservationReport,
  migrateStoredObservationState,
  OBSERVATION_ACTIVE_REQUEST_LIMIT,
  OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES,
  OVERFLOW_PATH_TEMPLATE,
  type StoredObservationState,
} from "../src/report.js";

const CONVERSATION_PATH_TEMPLATE = "/:compound-l/:word-l/:uuid";

function state(): StoredObservationState {
  return {
    storageSchemaVersion: 5,
    activeRun: { id: "run-250", startedAt: "2026-07-29T00:00:00.000Z" },
    summary: {
      requestCount: 250,
      totalBytesObserved: 250_000,
      totalRequestDurationMs: 5000,
      requestErrorCount: 2,
    },
    requestPaths: {
      [CONVERSATION_PATH_TEMPLATE]: {
        pathTemplate: CONVERSATION_PATH_TEMPLATE,
        count: 250,
        bytes: 250_000,
        durationMs: 5000,
        maxDurationMs: 30,
        errors: 2,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
    },
    pageMarks: { domContentLoadedMs: 400, composerReadyMs: 1200 },
    integrity: {
      pathClassLimit: 256,
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

const metadata = {
  extensionVersion: "0.0.6",
  browser: { name: "Firefox", vendor: "Mozilla", version: "140.0", buildID: "build" },
};

function legacyState(version: 2 | 3 | 4): Record<string, unknown> {
  const legacy = structuredClone(state()) as unknown as Record<string, unknown>;
  legacy.storageSchemaVersion = version;
  const integrity = legacy.integrity as Record<string, unknown>;
  delete integrity.activeRequestLimit;
  delete integrity.activeRequestCount;
  delete integrity.unobservedRequestCount;
  delete integrity.bodySizeWarningThresholdBytes;
  delete integrity.oversizedResponseCount;
  if (version === 2) delete integrity.captureInterruptionCount;
  return legacy;
}

describe("popup observation report builder", () => {
  it("exports schema v3 and round-trips exact totals beyond the former 200-request ring limit", () => {
    const report = buildObservationReport(state(), metadata, "2026-07-29T00:00:02.000Z");
    expect(report.schemaVersion).toBe(3);
    expect(report.summary.requestCount).toBe(250);
    expect(report.integrity.totalsComplete).toBe(true);
    expect(parseObservationReport(report)).toEqual(report);
  });

  it("migrates safe stored schemas v2 through v4 with explicit stream-policy defaults", () => {
    for (const version of [2, 3, 4] as const) {
      const migration = migrateStoredObservationState(legacyState(version));
      expect(migration?.migratedFrom).toBe(version);
      expect(migration?.state.storageSchemaVersion).toBe(5);
      expect(migration?.state.integrity.captureInterruptionCount).toBe(0);
      expect(migration?.state.integrity.activeRequestLimit).toBe(OBSERVATION_ACTIVE_REQUEST_LIMIT);
      expect(migration?.state.integrity.activeRequestCount).toBe(0);
      expect(migration?.state.integrity.bodySizeWarningThresholdBytes).toBe(
        OBSERVATION_BODY_SIZE_WARNING_THRESHOLD_BYTES,
      );
    }

    const literalLegacy = legacyState(4);
    const aggregate = (literalLegacy.requestPaths as Record<string, unknown>)[CONVERSATION_PATH_TEMPLATE];
    literalLegacy.requestPaths = {
      "/private-project/:uuid": {
        ...(aggregate as Record<string, unknown>),
        pathTemplate: "/private-project/:uuid",
      },
    };
    expect(migrateStoredObservationState(literalLegacy)).toBeNull();
  });

  it("rejects corrupt stored state before the background runtime can use it", () => {
    const corruptions: Array<(input: Record<string, unknown>) => void> = [
      (input) => {
        (input.activeRun as Record<string, unknown>).startedAt = "not-a-date";
      },
      (input) => {
        (input.summary as Record<string, unknown>).requestCount = "250";
      },
      (input) => {
        (input.pageMarks as Record<string, unknown>).composerReadyMs = -1;
      },
      (input) => {
        (input.integrity as Record<string, unknown>).pathClassOverflowed = "false";
      },
      (input) => {
        (input.integrity as Record<string, unknown>).activeRequestCount = OBSERVATION_ACTIVE_REQUEST_LIMIT + 1;
      },
      (input) => {
        (input.integrity as Record<string, unknown>).activeRequestLimit = OBSERVATION_ACTIVE_REQUEST_LIMIT + 1;
      },
      (input) => {
        (input.integrity as Record<string, unknown>).bodySizeWarningThresholdBytes = 1;
      },
      (input) => {
        (input.integrity as Record<string, unknown>).oversizedResponseCount = 251;
      },
      (input) => {
        const paths = input.requestPaths as Record<string, Record<string, unknown>>;
        paths[CONVERSATION_PATH_TEMPLATE]!.pathTemplate = "/:word-m";
      },
      (input) => {
        const paths = input.requestPaths as Record<string, Record<string, unknown>>;
        paths[CONVERSATION_PATH_TEMPLATE]!.methods = ["GET", "GET"];
      },
      (input) => {
        (input.summary as Record<string, unknown>).totalBytesObserved = 1;
      },
      (input) => {
        const paths = input.requestPaths as Record<string, Record<string, unknown>>;
        paths[CONVERSATION_PATH_TEMPLATE]!.pathTemplate = "/private-project/:uuid";
        input.requestPaths = {
          "/private-project/:uuid": paths[CONVERSATION_PATH_TEMPLATE],
        };
      },
    ];

    for (const corrupt of corruptions) {
      const input = structuredClone(state()) as unknown as Record<string, unknown>;
      corrupt(input);
      expect(migrateStoredObservationState(input)).toBeNull();
    }
  });

  it("rejects persisted data that has no active run", () => {
    const input = structuredClone(state()) as unknown as Record<string, unknown>;
    delete input.activeRun;
    expect(migrateStoredObservationState(input)).toBeNull();
  });

  it("marks resumed, in-flight, and capacity-gap captures incomplete", () => {
    const resumed = state();
    resumed.integrity.captureInterruptionCount = 1;
    expect(buildObservationReport(resumed, metadata).integrity.totalsComplete).toBe(false);

    const active = state();
    active.integrity.activeRequestCount = 1;
    const activeReport = buildObservationReport(active, metadata);
    expect(activeReport.integrity.totalsComplete).toBe(false);
    expect(activeReport.integrity.pathBreakdownComplete).toBe(false);
    expect(parseObservationReport(activeReport).integrity.activeRequestCount).toBe(1);

    const unobserved = state();
    unobserved.integrity.unobservedRequestCount = 1;
    expect(buildObservationReport(unobserved, metadata).integrity.totalsComplete).toBe(false);
  });

  it("flags oversized responses without losing exact total completeness", () => {
    const input = state();
    input.integrity.oversizedResponseCount = 1;
    const report = buildObservationReport(input, metadata);
    expect(report.integrity.totalsComplete).toBe(true);
    expect(parseObservationReport(report).integrity.oversizedResponseCount).toBe(1);
  });

  it("surfaces path overflow without losing total completeness", () => {
    const input = state();
    input.requestPaths = {
      "/:word-m": {
        pathTemplate: "/:word-m",
        count: 200,
        bytes: 200_000,
        durationMs: 4000,
        maxDurationMs: 30,
        errors: 1,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
      [OVERFLOW_PATH_TEMPLATE]: {
        pathTemplate: OVERFLOW_PATH_TEMPLATE,
        count: 50,
        bytes: 50_000,
        durationMs: 1000,
        maxDurationMs: 25,
        errors: 1,
        methods: ["GET", "POST"],
        resourceTypes: ["other", "xmlhttprequest"],
      },
    };
    input.integrity.pathClassOverflowed = true;
    input.integrity.overflowRequestCount = 50;
    const report = buildObservationReport(input, metadata);
    expect(report.integrity.totalsComplete).toBe(true);
    expect(report.integrity.pathBreakdownComplete).toBe(false);
    expect(parseObservationReport(report).integrity.overflowRequestCount).toBe(50);
  });

  it("refuses inconsistent or literal-path state instead of exporting a misleading report", () => {
    const inconsistent = state();
    inconsistent.summary.requestCount = 249;
    expect(() => buildObservationReport(inconsistent, metadata)).toThrow(/Invalid observation state/);

    const literal = state();
    const aggregate = literal.requestPaths[CONVERSATION_PATH_TEMPLATE]!;
    literal.requestPaths = {
      "/private-project/:uuid": {
        ...aggregate,
        pathTemplate: "/private-project/:uuid",
      },
    };
    expect(() => buildObservationReport(literal, metadata)).toThrow(/Invalid observation state/);
  });
});
