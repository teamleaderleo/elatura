// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseObservationReport } from "../../../benchmarks/src/observation.js";
import {
  buildObservationReport,
  migrateStoredObservationState,
  OVERFLOW_PATH_TEMPLATE,
  type StoredObservationState,
} from "../src/report.js";

const CONVERSATION_PATH_TEMPLATE = "/:compound-l/:word-l/:uuid";

function state(): StoredObservationState {
  return {
    storageSchemaVersion: 4,
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
    },
  };
}

const metadata = {
  extensionVersion: "0.0.5",
  browser: { name: "Firefox", vendor: "Mozilla", version: "140.0", buildID: "build" },
};

describe("popup observation report builder", () => {
  it("exports schema v3 and round-trips exact totals beyond the former 200-request ring limit", () => {
    const report = buildObservationReport(state(), metadata, "2026-07-29T00:00:02.000Z");
    expect(report.schemaVersion).toBe(3);
    expect(report.summary.requestCount).toBe(250);
    expect(report.integrity.totalsComplete).toBe(true);
    expect(parseObservationReport(report)).toEqual(report);
  });

  it("migrates only legacy states whose paths already satisfy the private grammar", () => {
    const legacyV2 = structuredClone(state()) as unknown as Record<string, unknown>;
    legacyV2.storageSchemaVersion = 2;
    delete (legacyV2.integrity as Record<string, unknown>).captureInterruptionCount;
    const v2Migration = migrateStoredObservationState(legacyV2);
    expect(v2Migration?.migratedFrom).toBe(2);
    expect(v2Migration?.state.storageSchemaVersion).toBe(4);
    expect(v2Migration?.state.integrity.captureInterruptionCount).toBe(0);

    const legacyV3 = structuredClone(state()) as unknown as Record<string, unknown>;
    legacyV3.storageSchemaVersion = 3;
    expect(migrateStoredObservationState(legacyV3)?.migratedFrom).toBe(3);

    const literalLegacy = structuredClone(legacyV3);
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

  it("marks resumed capture totals incomplete", () => {
    const input = state();
    input.integrity.captureInterruptionCount = 1;
    const report = buildObservationReport(input, metadata);
    expect(report.integrity.totalsComplete).toBe(false);
    expect(report.integrity.pathBreakdownComplete).toBe(false);
    expect(parseObservationReport(report).integrity.captureInterruptionCount).toBe(1);
  });

  it("surfaces overflow without losing total completeness", () => {
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

  it("refuses inconsistent state instead of exporting a misleading report", () => {
    const input = state();
    input.summary.requestCount = 249;
    expect(() => buildObservationReport(input, metadata)).toThrow(/Invalid observation state/);
  });

  it("refuses literal path content in schema-v4 state", () => {
    const input = state();
    const aggregate = input.requestPaths[CONVERSATION_PATH_TEMPLATE]!;
    input.requestPaths = {
      "/private-project/:uuid": {
        ...aggregate,
        pathTemplate: "/private-project/:uuid",
      },
    };
    expect(() => buildObservationReport(input, metadata)).toThrow(/Invalid observation state/);
  });
});
