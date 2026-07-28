// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseObservationReport } from "../../../benchmarks/src/observation.js";
import {
  buildObservationReport,
  migrateStoredObservationState,
  OVERFLOW_PATH_TEMPLATE,
  type StoredObservationState,
} from "../src/report.js";

function state(): StoredObservationState {
  return {
    storageSchemaVersion: 3,
    activeRun: { id: "run-250", startedAt: "2026-07-29T00:00:00.000Z" },
    summary: {
      requestCount: 250,
      totalBytesObserved: 250_000,
      totalRequestDurationMs: 5000,
      requestErrorCount: 2,
    },
    requestPaths: {
      "/backend-api/conversation/:id": {
        pathTemplate: "/backend-api/conversation/:id",
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
  extensionVersion: "0.0.4",
  browser: { name: "Firefox", vendor: "Mozilla", version: "140.0", buildID: "build" },
};

describe("popup observation report builder", () => {
  it("exports and parses exact totals beyond the former 200-request ring limit", () => {
    const report = buildObservationReport(state(), metadata, "2026-07-29T00:00:02.000Z");
    expect(report.summary.requestCount).toBe(250);
    expect(report.integrity.totalsComplete).toBe(true);
    expect(parseObservationReport(report)).toEqual(report);
  });

  it("migrates a completely valid stored schema v2 without inventing an interruption", () => {
    const legacy = structuredClone(state()) as unknown as Record<string, unknown>;
    legacy.storageSchemaVersion = 2;
    delete (legacy.integrity as Record<string, unknown>).captureInterruptionCount;
    const migration = migrateStoredObservationState(legacy);
    expect(migration?.migratedFrom).toBe(2);
    expect(migration?.state.storageSchemaVersion).toBe(3);
    expect(migration?.state.integrity.captureInterruptionCount).toBe(0);
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
        paths["/backend-api/conversation/:id"]!.pathTemplate = "/different";
      },
      (input) => {
        const paths = input.requestPaths as Record<string, Record<string, unknown>>;
        paths["/backend-api/conversation/:id"]!.methods = ["GET", "GET"];
      },
      (input) => {
        (input.summary as Record<string, unknown>).totalBytesObserved = 1;
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
      "/known": {
        pathTemplate: "/known",
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
});
