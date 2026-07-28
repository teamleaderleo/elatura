// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseObservationReport,
  summarizeDistribution,
  summarizeObservationReports,
} from "../src/observation.js";

function report(id: string, bytes: number, composerReadyMs: number | null = 1000): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-29T00:00:02.000Z",
    mode: "observe",
    run: {
      id,
      startedAt: "2026-07-29T00:00:00.000Z",
      exportedAt: "2026-07-29T00:00:02.000Z",
    },
    extension: { version: "0.0.1" },
    browser: { name: "Firefox", vendor: "Mozilla", version: "140.0", buildID: "build" },
    privacy: {
      responseBodiesCaptured: false,
      messageTextCaptured: false,
      queryStringsCaptured: false,
      credentialsCaptured: false,
      pathsRedacted: true,
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
        pathTemplate: "/backend-api/conversation/:id",
        count: 1,
        bytes: bytes - 100,
        durationMs: 20,
        maxDurationMs: 20,
        errors: 0,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
      {
        pathTemplate: "/backend-api/other",
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
  it("parses and reconciles a content-free export without mutation", () => {
    const input = report("run-1", 1000);
    const before = structuredClone(input);
    const parsed = parseObservationReport(input);
    expect(parsed.summary.totalBytesObserved).toBe(1000);
    expect(parsed.requestPaths[0]?.pathTemplate).toBe("/backend-api/conversation/:id");
    expect(input).toEqual(before);
  });

  it("rejects privacy-invalid, raw-URL, and unreconciled reports", () => {
    const privacyInvalid = report("run-1", 1000);
    (privacyInvalid.privacy as Record<string, unknown>).responseBodiesCaptured = true;
    expect(() => parseObservationReport(privacyInvalid)).toThrow(/responseBodiesCaptured/);

    const rawUrl = report("run-2", 1000);
    ((rawUrl.requestPaths as Array<Record<string, unknown>>)[0]!).pathTemplate =
      "https://chatgpt.com/private";
    expect(() => parseObservationReport(rawUrl)).toThrow(/redacted path/);

    const unreconciled = report("run-3", 1000);
    (unreconciled.summary as Record<string, unknown>).requestCount = 99;
    expect(() => parseObservationReport(unreconciled)).toThrow(/reconcile/);
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

  it("summarizes repeated runs and aggregates paths", () => {
    const summary = summarizeObservationReports([
      report("run-1", 1000, 900),
      report("run-2", 2000, 1100),
      report("run-3", 3000, null),
    ]);
    expect(summary.reportCount).toBe(3);
    expect(summary.groups).toHaveLength(1);
    const group = summary.groups[0]!;
    expect(group.metrics.totalBytesObserved.median).toBe(2000);
    expect(group.metrics.composerReadyMs?.sampleCount).toBe(2);
    expect(group.requestPaths[0]?.pathTemplate).toBe("/backend-api/conversation/:id");
    expect(group.requestPaths[0]?.totalBytes).toBe(5700);
  });
});
