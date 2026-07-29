// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  checkBenchmarkSession,
  createBenchmarkSessionPlan,
  parseBenchmarkSessionPlan,
  type BenchmarkSessionPlan,
  type BenchmarkSessionSlot,
} from "../src/session.js";

let nextId = 1;
function runId(): string {
  return `10000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
}

function plan(includeClientNavigation = false): BenchmarkSessionPlan {
  return createBenchmarkSessionPlan({
    sessionId: "00000000-0000-4000-8000-000000000055",
    generatedAt: "2026-07-29T12:00:00.000Z",
    edgeVersion: "126.0",
    firefoxVersion: "140.0",
    observerExtensionVersion: "0.0.8",
    observerReportSchemaVersion: 3,
    memoryMethod: "activity-monitor",
    includeClientNavigation,
  });
}

function manifest(slot: BenchmarkSessionSlot, id: string, session: BenchmarkSessionPlan): Record<string, unknown> {
  const observe = slot.mode === "firefox-observe";
  return {
    schemaVersion: 2,
    runId: id,
    recordedAt: "2026-07-29T12:01:00.000Z",
    mode: slot.mode,
    navigation: slot.navigation,
    sequence: slot.sequence,
    browser: {
      name: slot.browserName,
      version: slot.browserVersion,
      profile: "clean-test",
    },
    timings: {
      source: observe ? "observer-report" : "manual",
      domContentLoadedMs: 500 + slot.ordinal,
      composerReadyMs: 1_000 + slot.ordinal,
    },
    memory: {
      method: session.memoryMethod,
      peaks: [{ processClass: "browser-total", peakBytes: 1_000_000_000 + slot.ordinal }],
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
  slot: BenchmarkSessionSlot,
  id: string,
  session: BenchmarkSessionPlan,
): Record<string, unknown> {
  return {
    schemaVersion: session.observer.reportSchemaVersion,
    generatedAt: "2026-07-29T12:02:00.000Z",
    mode: "observe",
    run: {
      id,
      startedAt: "2026-07-29T12:00:00.000Z",
      exportedAt: "2026-07-29T12:02:00.000Z",
    },
    extension: { version: session.observer.extensionVersion },
    browser: {
      name: "Firefox",
      vendor: "Mozilla",
      version: session.browserVersions.firefox,
      buildID: "build",
    },
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
      activeRequestLimit: 128,
      activeRequestCount: 0,
      unobservedRequestCount: 0,
      bodySizeWarningThresholdBytes: 67_108_864,
      oversizedResponseCount: 0,
    },
    summary: {
      requestCount: 1,
      totalBytesObserved: 1_000_000 + slot.ordinal,
      totalRequestDurationMs: 20,
      requestErrorCount: 0,
      domContentLoadedMs: 500 + slot.ordinal,
      composerReadyMs: 1_000 + slot.ordinal,
    },
    requestPaths: [
      {
        pathTemplate: "/:word-m",
        count: 1,
        bytes: 1_000_000 + slot.ordinal,
        durationMs: 20,
        maxDurationMs: 20,
        errors: 0,
        methods: ["GET"],
        resourceTypes: ["xmlhttprequest"],
      },
    ],
  };
}

function completeInputs(session: BenchmarkSessionPlan): {
  manifests: Record<string, unknown>[];
  observations: Record<string, unknown>[];
} {
  const manifests: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  for (const slot of session.slots) {
    const id = runId();
    manifests.push(manifest(slot, id, session));
    if (slot.observerReportRequired) observations.push(observation(slot, id, session));
  }
  return { manifests, observations };
}

describe("content-free benchmark session plans", () => {
  it("creates deterministic balanced 45-run and optional 60-run plans", () => {
    const required = plan();
    expect(required.slots).toHaveLength(45);
    expect(required.sampleCounts).toEqual({
      "cold-open": 5,
      "hard-reload": 10,
      "client-navigation": 0,
    });
    expect(required.slots.slice(0, 3).map((slot) => slot.mode)).toEqual([
      "edge-stock",
      "firefox-stock",
      "firefox-observe",
    ]);
    expect(required.slots.slice(3, 6).map((slot) => slot.mode)).toEqual([
      "firefox-stock",
      "firefox-observe",
      "edge-stock",
    ]);
    expect(createBenchmarkSessionPlan({
      sessionId: required.sessionId,
      generatedAt: required.generatedAt,
      edgeVersion: required.browserVersions.edge,
      firefoxVersion: required.browserVersions.firefox,
      observerExtensionVersion: required.observer.extensionVersion,
      observerReportSchemaVersion: required.observer.reportSchemaVersion,
      memoryMethod: required.memoryMethod,
    })).toEqual(required);
    expect(plan(true).slots).toHaveLength(60);
  });

  it("strictly parses canonical plans and rejects private-bearing or reordered data", () => {
    const input = plan();
    expect(parseBenchmarkSessionPlan(structuredClone(input))).toEqual(input);

    const notes = structuredClone(input) as BenchmarkSessionPlan & { notes?: string };
    notes.notes = "private conversation title";
    expect(() => parseBenchmarkSessionPlan(notes)).toThrow(/unsupported fields/);

    const altered = structuredClone(input);
    altered.slots[0]!.key = "edge-stock|cold-open|99";
    expect(() => parseBenchmarkSessionPlan(altered)).toThrow(/canonical plan/);

    const looseDate = structuredClone(input);
    looseDate.generatedAt = "2026-07-29T12:00:00Z";
    expect(() => parseBenchmarkSessionPlan(looseDate)).toThrow(/canonical millisecond-precision UTC/);
  });

  it("marks a complete comparable matrix ready", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    expect(checkBenchmarkSession(session, inputs.manifests, inputs.observations)).toEqual({
      schemaVersion: 1,
      sessionId: session.sessionId,
      plannedRunCount: 45,
      manifestCount: 45,
      observationReportCount: 15,
      presentPlannedRunCount: 45,
      missingRunCount: 0,
      unexpectedRunCount: 0,
      ready: true,
      issues: [],
    });
  });

  it("reports missing slots, version drift, memory drift, and observer identity drift", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    inputs.manifests.shift();
    const browser = inputs.manifests[0]!.browser as Record<string, unknown>;
    browser.version = "127.0";
    const memory = inputs.manifests[1]!.memory as Record<string, unknown>;
    memory.method = "ps";
    const firstObservation = inputs.observations[0]!;
    (firstObservation.extension as Record<string, unknown>).version = "0.0.9";
    firstObservation.schemaVersion = 2;

    const readiness = checkBenchmarkSession(session, inputs.manifests, inputs.observations);
    const codes = new Set(readiness.issues.map((issue) => issue.code));
    expect(readiness.ready).toBe(false);
    expect(readiness.missingRunCount).toBe(1);
    expect(codes.has("missing-run")).toBe(true);
    expect(codes.has("browser-version-mismatch")).toBe(true);
    expect(codes.has("memory-method-mismatch")).toBe(true);
    expect(codes.has("observer-extension-version-mismatch")).toBe(true);
    expect(codes.has("observer-report-schema-mismatch")).toBe(true);
    expect(codes.has("matrix-warning")).toBe(true);
    expect(codes.has("comparison-ineligible")).toBe(true);
  });

  it("rejects runs outside the planned matrix", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    const extraSlot: BenchmarkSessionSlot = {
      ordinal: 46,
      key: "edge-stock|client-navigation|1",
      mode: "edge-stock",
      navigation: "client-navigation",
      sequence: 1,
      browserName: "Edge",
      browserVersion: session.browserVersions.edge,
      timingSource: "manual",
      observerReportRequired: false,
    };
    inputs.manifests.push(manifest(extraSlot, runId(), session));
    const readiness = checkBenchmarkSession(session, inputs.manifests, inputs.observations);
    expect(readiness.unexpectedRunCount).toBe(1);
    expect(readiness.issues).toContainEqual({
      code: "unexpected-run",
      slotKey: extraSlot.key,
      cohortKey: "edge-stock|client-navigation",
      warningCode: null,
    });
  });
});
