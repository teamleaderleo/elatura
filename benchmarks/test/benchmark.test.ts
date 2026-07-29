// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseBenchmarkRunManifest,
  summarizeBenchmarkMatrix,
  type BenchmarkMode,
  type BenchmarkNavigation,
} from "../src/benchmark.js";

let nextId = 1;
function runId(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
}

function manifest(
  mode: BenchmarkMode,
  navigation: BenchmarkNavigation,
  sequence: number,
  composerReadyMs: number | null,
  peakBytes: number | null,
): Record<string, unknown> {
  const id = runId();
  const observe = mode === "firefox-observe";
  return {
    schemaVersion: 2,
    runId: id,
    recordedAt: "2026-07-29T00:00:00.000Z",
    mode,
    navigation,
    sequence,
    browser: {
      name: mode === "edge-stock" ? "Edge" : "Firefox",
      version: mode === "edge-stock" ? "126.0" : "140.0",
      profile: "clean-test",
    },
    timings: {
      source: observe ? "observer-report" : "manual",
      domContentLoadedMs: composerReadyMs === null ? null : composerReadyMs / 2,
      composerReadyMs,
    },
    memory:
      peakBytes === null
        ? null
        : {
            method: "activity-monitor",
            peaks: [{ processClass: "browser-total", peakBytes }],
          },
    outcome: { status: "usable", failureCode: null },
    observerReportRunId: observe ? id : null,
    privacy: {
      contentCaptured: false,
      urlsCaptured: false,
      notesCaptured: false,
      processCommandLinesCaptured: false,
    },
  };
}

function observation(
  input: Record<string, unknown>,
  bytes = 1_000_000,
  extensionVersion = "0.0.4",
  schemaVersion: 2 | 3 = 2,
): Record<string, unknown> {
  const timings = input.timings as Record<string, unknown>;
  const browser = input.browser as Record<string, unknown>;
  return {
    schemaVersion,
    generatedAt: "2026-07-29T00:01:00.000Z",
    mode: "observe",
    run: {
      id: input.runId,
      startedAt: "2026-07-29T00:00:00.000Z",
      exportedAt: "2026-07-29T00:01:00.000Z",
    },
    extension: { version: extensionVersion },
    browser: { name: browser.name, vendor: "Mozilla", version: browser.version, buildID: "build" },
    privacy: {
      responseBodiesCaptured: false,
      messageTextCaptured: false,
      queryStringsCaptured: false,
      credentialsCaptured: false,
      pathsRedacted: true,
    },
    integrity: {
      totalsComplete: true,
      pathBreakdownComplete: true,
      pathClassLimit: 256,
      pathClassOverflowed: false,
      overflowRequestCount: 0,
      persistenceErrorCount: 0,
      captureInterruptionCount: 0,
    },
    summary: {
      requestCount: 1,
      totalBytesObserved: bytes,
      totalRequestDurationMs: 10,
      requestErrorCount: 0,
      domContentLoadedMs: timings.domContentLoadedMs,
      composerReadyMs: timings.composerReadyMs,
    },
    requestPaths: [
      {
        pathTemplate:
          schemaVersion === 3
            ? "/:compound-l/:word-l/:token-s"
            : "/backend-api/conversation/:id",
        count: 1,
        bytes,
        durationMs: 10,
        maxDurationMs: 10,
        errors: 0,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
    ],
  };
}

describe("content-free benchmark manifests", () => {
  it("parses a strict manifest and rejects free-form or private-bearing fields", () => {
    const input = manifest("firefox-stock", "cold-open", 1, 1000, 1_000_000_000);
    expect(parseBenchmarkRunManifest(input).mode).toBe("firefox-stock");

    const notes = structuredClone(input);
    notes.notes = ["private conversation title"];
    expect(() => parseBenchmarkRunManifest(notes)).toThrow(/unsupported fields/);

    const privacy = structuredClone(input);
    (privacy.privacy as Record<string, unknown>).urlsCaptured = true;
    expect(() => parseBenchmarkRunManifest(privacy)).toThrow(/urlsCaptured/);
  });

  it("requires canonical millisecond-precision UTC timestamps", () => {
    const loose = manifest("firefox-stock", "cold-open", 1, 1000, 1_000_000_000);
    loose.recordedAt = "July 29, 2026";
    expect(() => parseBenchmarkRunManifest(loose)).toThrow(/canonical ISO-8601 UTC/);

    const offset = manifest("firefox-stock", "cold-open", 2, 1000, 1_000_000_000);
    offset.recordedAt = "2026-07-29T00:00:00+00:00";
    expect(() => parseBenchmarkRunManifest(offset)).toThrow(/canonical ISO-8601 UTC/);

    const missingMilliseconds = manifest("firefox-stock", "cold-open", 3, 1000, 1_000_000_000);
    missingMilliseconds.recordedAt = "2026-07-29T00:00:00Z";
    expect(() => parseBenchmarkRunManifest(missingMilliseconds)).toThrow(/canonical ISO-8601 UTC/);
  });

  it("summarizes a complete matrix and computes cohort deltas", () => {
    const manifests: Record<string, unknown>[] = [];
    const reports: Record<string, unknown>[] = [];
    for (const navigation of ["cold-open", "hard-reload"] as const) {
      const count = navigation === "cold-open" ? 5 : 10;
      for (let sequence = 1; sequence <= count; sequence += 1) {
        manifests.push(manifest("edge-stock", navigation, sequence, 900, 900_000_000));
        manifests.push(manifest("firefox-stock", navigation, sequence, 1000, 1_000_000_000));
        const observe = manifest("firefox-observe", navigation, sequence, 1100, 1_100_000_000);
        manifests.push(observe);
        reports.push(observation(observe));
      }
    }

    const summary = summarizeBenchmarkMatrix(manifests, reports);
    expect(summary.warnings).toEqual([]);
    expect(summary.cohorts).toHaveLength(6);
    expect(summary.cohorts.every((cohort) => cohort.comparisonEligible)).toBe(true);

    const edgeCold = summary.comparisons.find(
      (comparison) => comparison.targetKey === "edge-stock|cold-open",
    );
    expect(edgeCold?.metrics.composerReadyMs).toMatchObject({
      baselineMedian: 1000,
      targetMedian: 900,
      absoluteDelta: -100,
      percentDelta: -10,
    });
    const observeCold = summary.comparisons.find(
      (comparison) => comparison.targetKey === "firefox-observe|cold-open",
    );
    expect(observeCold?.metrics.browserTotalPeakBytes?.percentDelta).toBe(10);
    expect(
      summary.cohorts.find((cohort) => cohort.key === "firefox-observe|cold-open"),
    ).toMatchObject({
      observerExtensionVersions: ["0.0.4"],
      observerReportSchemaVersions: [2],
    });
  });

  it("keeps one-sample client navigation cohorts descriptive-only", () => {
    const baseline = manifest("firefox-stock", "client-navigation", 1, 1000, 1_000_000_000);
    const target = manifest("edge-stock", "client-navigation", 1, 900, 900_000_000);
    const summary = summarizeBenchmarkMatrix([baseline, target], []);

    for (const key of ["firefox-stock|client-navigation", "edge-stock|client-navigation"]) {
      const cohort = summary.cohorts.find((candidate) => candidate.key === key);
      expect(cohort).toMatchObject({ expectedRunCount: 5, runCount: 1, comparisonEligible: false });
      expect(cohort?.warningCodes).toContain("small-sample");
    }
    const comparison = summary.comparisons.find(
      (candidate) => candidate.targetKey === "edge-stock|client-navigation",
    );
    expect(comparison?.metrics).toEqual({
      domContentLoadedMs: null,
      composerReadyMs: null,
      browserTotalPeakBytes: null,
      totalBytesObserved: null,
    });
  });

  it("blocks mixed observer extension and report schema cohorts", () => {
    const manifests: Record<string, unknown>[] = [];
    const reports: Record<string, unknown>[] = [];
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      manifests.push(manifest("firefox-stock", "cold-open", sequence, 1000, 1_000_000_000));
      const observe = manifest("firefox-observe", "cold-open", sequence, 1100, 1_100_000_000);
      manifests.push(observe);
      reports.push(
        observation(
          observe,
          1_000_000,
          sequence === 5 ? "0.0.5" : "0.0.4",
          sequence === 4 ? 3 : 2,
        ),
      );
    }

    const summary = summarizeBenchmarkMatrix(manifests, reports);
    const observeCohort = summary.cohorts.find(
      (cohort) => cohort.key === "firefox-observe|cold-open",
    );
    expect(observeCohort).toMatchObject({
      observerExtensionVersions: ["0.0.4", "0.0.5"],
      observerReportSchemaVersions: [2, 3],
      comparisonEligible: false,
    });
    expect(observeCohort?.warningCodes).toEqual(
      expect.arrayContaining([
        "mixed-observer-extension-versions",
        "mixed-observer-report-schemas",
      ]),
    );
    const mixedWarnings = summary.warnings.filter((item) => item.code.startsWith("mixed-observer-"));
    expect(mixedWarnings).toHaveLength(2);
    expect(mixedWarnings.every((item) => item.severity === "error")).toBe(true);
    expect(
      summary.comparisons.find(
        (comparison) => comparison.targetKey === "firefox-observe|cold-open",
      )?.metrics.composerReadyMs,
    ).toBeNull();
  });

  it("surfaces small samples, missing measurements, and incomplete observation", () => {
    const observe = manifest("firefox-observe", "cold-open", 1, null, null);
    const report = observation(observe);
    Object.assign(report.integrity as object, {
      totalsComplete: false,
      pathBreakdownComplete: false,
      captureInterruptionCount: 1,
    });

    const summary = summarizeBenchmarkMatrix([observe], [report]);
    const codes = new Set(summary.warnings.map((item) => item.code));
    expect(codes).toEqual(
      new Set([
        "small-sample",
        "missing-composer-readiness",
        "missing-dom-readiness",
        "missing-browser-total-memory",
        "observer-totals-incomplete",
        "observer-path-breakdown-incomplete",
      ]),
    );
    expect(
      summary.cohorts.find((cohort) => cohort.key === "firefox-observe|cold-open")?.comparisonEligible,
    ).toBe(false);
    expect(
      summary.comparisons.find((comparison) => comparison.targetKey === "firefox-observe|cold-open")
        ?.metrics.composerReadyMs,
    ).toBeNull();
  });

  it("detects unpaired, mismatched, unexpected, and orphan observation reports", () => {
    const observe = manifest("firefox-observe", "cold-open", 1, 1000, 1_000_000_000);
    const stock = manifest("firefox-stock", "cold-open", 1, 1000, 1_000_000_000);
    const mismatched = observation(observe);
    (mismatched.browser as Record<string, unknown>).version = "141.0";
    (mismatched.summary as Record<string, unknown>).composerReadyMs = 1001;
    const unexpected = observation(stock);
    const orphanManifest = manifest("firefox-observe", "cold-open", 2, 1000, 1_000_000_000);
    const orphanReport = observation(manifest("firefox-observe", "cold-open", 3, 1000, 1_000_000_000));

    const summary = summarizeBenchmarkMatrix([observe, stock, orphanManifest], [mismatched, unexpected, orphanReport]);
    const codes = new Set(summary.warnings.map((item) => item.code));
    expect(codes.has("observer-browser-mismatch")).toBe(true);
    expect(codes.has("observer-timing-mismatch")).toBe(true);
    expect(codes.has("unexpected-observer-report")).toBe(true);
    expect(codes.has("unpaired-observer-report")).toBe(true);
    expect(codes.has("orphan-observer-report")).toBe(true);
  });

  it("rejects duplicate run identifiers and cohort sequence numbers", () => {
    const first = manifest("firefox-stock", "cold-open", 1, 1000, 1_000_000_000);
    const duplicateId = structuredClone(first);
    expect(() => summarizeBenchmarkMatrix([first, duplicateId], [])).toThrow(/Duplicate benchmark run id/);

    const duplicateSequence = manifest("firefox-stock", "cold-open", 1, 1100, 1_000_000_000);
    expect(() => summarizeBenchmarkMatrix([first, duplicateSequence], [])).toThrow(/Duplicate benchmark sequence/);
  });
});
