// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseObservationReport,
  summarizeDistribution,
  summarizeObservationReports,
  type ObservationReportSchemaVersion,
} from "../src/observation.js";

function report(
  id: string,
  bytes: number,
  composerReadyMs: number | null = 1000,
  schemaVersion: ObservationReportSchemaVersion = 3,
): Record<string, unknown> {
  const paths =
    schemaVersion === 3
      ? ["/:compound-l/:word-l/:uuid", "/:compound-l/:word-m"]
      : ["/backend-api/conversation/:id", "/backend-api/other"];
  return {
    schemaVersion,
    generatedAt: "2026-07-29T00:00:02.000Z",
    mode: "observe",
    run: {
      id,
      startedAt: "2026-07-29T00:00:00.000Z",
      exportedAt: "2026-07-29T00:00:02.000Z",
    },
    extension: { version: schemaVersion === 3 ? "0.0.6" : "0.0.4" },
    browser: { name: "Firefox", vendor: "Mozilla", version: "140.0", buildID: "build" },
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
      ...(schemaVersion === 3 ? { captureInterruptionCount: 0 } : {}),
      activeRequestLimit: 128,
      activeRequestCount: 0,
      unobservedRequestCount: 0,
      bodySizeWarningThresholdBytes: 67_108_864,
      oversizedResponseCount: 0,
    },
    summary: {
      requestCount: 2,
      totalBytesObserved: bytes,
      totalRequestDurationMs: 30,
      requestErrorCount: 0,
      domContentLoadedMs: 500,
      composerReadyMs,
    },
    requestPaths: [
      {
        pathTemplate: paths[0],
        count: 1,
        bytes: bytes - 100,
        durationMs: 20,
        maxDurationMs: 20,
        errors: 0,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
      {
        pathTemplate: paths[1],
        count: 1,
        bytes: 100,
        durationMs: 10,
        maxDurationMs: 10,
        errors: 0,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
    ],
  };
}

describe("observation report analysis", () => {
  it("parses and reconciles a schema-v3 content-free export without mutation", () => {
    const input = report("run-1", 1000);
    const before = structuredClone(input);
    const parsed = parseObservationReport(input);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.summary.totalBytesObserved).toBe(1000);
    expect(parsed.integrity.totalsComplete).toBe(true);
    expect(parsed.integrity.captureInterruptionCount).toBe(0);
    expect(parsed.requestPaths[0]?.pathTemplate).toBe("/:compound-l/:word-l/:uuid");
    expect(input).toEqual(before);
  });

  it("keeps schema-v2 reports readable while enforcing the v3 path grammar", () => {
    const legacy = report("legacy", 1000, 1000, 2);
    const legacyIntegrity = legacy.integrity as Record<string, unknown>;
    delete legacyIntegrity.activeRequestLimit;
    delete legacyIntegrity.activeRequestCount;
    delete legacyIntegrity.unobservedRequestCount;
    delete legacyIntegrity.bodySizeWarningThresholdBytes;
    delete legacyIntegrity.oversizedResponseCount;
    const parsedLegacy = parseObservationReport(legacy);
    expect(parsedLegacy.schemaVersion).toBe(2);
    expect(parsedLegacy.integrity).toMatchObject({
      captureInterruptionCount: 0,
      activeRequestLimit: 0,
      activeRequestCount: 0,
      unobservedRequestCount: 0,
      bodySizeWarningThresholdBytes: 0,
      oversizedResponseCount: 0,
    });

    const literalV3 = report("literal-v3", 1000);
    ((literalV3.requestPaths as Array<Record<string, unknown>>)[0]!).pathTemplate =
      "/backend-api/conversation/:id";
    expect(() => parseObservationReport(literalV3)).toThrow(/content-independent segment classes/);
  });

  it("rejects privacy-invalid, raw-URL, and unreconciled reports", () => {
    const privacyInvalid = report("run-1", 1000);
    (privacyInvalid.privacy as Record<string, unknown>).responseBodiesCaptured = true;
    expect(() => parseObservationReport(privacyInvalid)).toThrow(/responseBodiesCaptured/);

    const rawUrl = report("run-2", 1000);
    ((rawUrl.requestPaths as Array<Record<string, unknown>>)[0]!).pathTemplate =
      "https://chatgpt.com/private";
    expect(() => parseObservationReport(rawUrl)).toThrow(/segment classes/);

    const unreconciled = report("run-3", 1000);
    (unreconciled.summary as Record<string, unknown>).requestCount = 99;
    expect(() => parseObservationReport(unreconciled)).toThrow(/reconcile/);
  });

  it("rejects false completeness and inconsistent integrity claims", () => {
    const persistenceFailure = report("run-1", 1000);
    (persistenceFailure.integrity as Record<string, unknown>).persistenceErrorCount = 1;
    expect(() => parseObservationReport(persistenceFailure)).toThrow(/cannot claim complete totals/);

    const interruption = report("run-interrupted", 1000);
    (interruption.integrity as Record<string, unknown>).captureInterruptionCount = 1;
    expect(() => parseObservationReport(interruption)).toThrow(/cannot claim complete totals/);

    const active = report("run-active", 1000);
    (active.integrity as Record<string, unknown>).activeRequestCount = 1;
    expect(() => parseObservationReport(active)).toThrow(/cannot claim complete totals/);

    const unobserved = report("run-unobserved", 1000);
    (unobserved.integrity as Record<string, unknown>).unobservedRequestCount = 1;
    expect(() => parseObservationReport(unobserved)).toThrow(/cannot claim complete totals/);

    const oversized = report("run-oversized", 1000);
    (oversized.integrity as Record<string, unknown>).oversizedResponseCount = 3;
    expect(() => parseObservationReport(oversized)).toThrow(/cannot exceed requestCount/);

    const overflow = report("run-2", 1000);
    Object.assign(overflow.integrity as object, {
      pathBreakdownComplete: false,
      pathClassOverflowed: true,
      overflowRequestCount: 2,
    });
    expect(() => parseObservationReport(overflow)).toThrow(/Overflow path totals/);
  });

  it("accepts explicit incomplete active and capacity-gap reports", () => {
    const active = report("run-active", 1000);
    Object.assign(active.integrity as object, {
      totalsComplete: false,
      pathBreakdownComplete: false,
      activeRequestCount: 1,
      unobservedRequestCount: 2,
      oversizedResponseCount: 1,
    });
    const parsed = parseObservationReport(active);
    expect(parsed.integrity).toMatchObject({
      activeRequestCount: 1,
      unobservedRequestCount: 2,
      oversizedResponseCount: 1,
    });
  });

  it("rejects duplicate run identifiers", () => {
    expect(() => summarizeObservationReports([report("same", 1000), report("same", 2000)])).toThrow(
      /Duplicate observation run id/,
    );
  });

  it("requires different report schema generations to be analyzed separately", () => {
    expect(() =>
      summarizeObservationReports([
        report("legacy", 1000, 1000, 2),
        report("current", 1000, 1000, 3),
      ]),
    ).toThrow(/schema versions must be analyzed separately/);
  });

  it("uses nearest-rank p95 and explicit worst-case maximum", () => {
    expect(summarizeDistribution([1, 2, 3, 4, 100])).toEqual({
      sampleCount: 5,
      min: 1,
      median: 3,
      p95: 100,
      max: 100,
      mean: 22,
    });
  });

  it("summarizes repeated runs, integrity, and paths", () => {
    const interrupted = report("run-3", 3000, null);
    Object.assign(interrupted.integrity as object, {
      totalsComplete: false,
      pathBreakdownComplete: false,
      captureInterruptionCount: 2,
      activeRequestCount: 2,
      unobservedRequestCount: 3,
      oversizedResponseCount: 1,
    });
    const summary = summarizeObservationReports([
      report("run-1", 1000, 900),
      report("run-2", 2000, 1100),
      interrupted,
    ]);
    expect(summary.schemaVersion).toBe(2);
    expect(summary.reportCount).toBe(3);
    expect(summary.groups).toHaveLength(1);
    const group = summary.groups[0]!;
    expect(group.metrics.totalBytesObserved.median).toBe(2000);
    expect(group.metrics.composerReadyMs?.sampleCount).toBe(2);
    expect(group.integrity.totalsCompleteReportCount).toBe(2);
    expect(group.integrity.captureInterruptionCount).toBe(2);
    expect(group.integrity.activeRequestCount).toBe(2);
    expect(group.integrity.unobservedRequestCount).toBe(3);
    expect(group.integrity.oversizedResponseCount).toBe(1);
    expect(group.requestPaths[0]?.pathTemplate).toBe("/:compound-l/:word-l/:uuid");
    expect(group.requestPaths[0]?.totalBytes).toBe(5700);
  });
});
