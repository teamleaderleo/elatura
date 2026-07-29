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
const runId = (): string => `10000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

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
    schemaVersion: 3,
    session: {
      planSchemaVersion: session.schemaVersion,
      sessionId: session.sessionId,
      planGeneratedAt: session.generatedAt,
      slotOrdinal: slot.ordinal,
      slotKey: slot.key,
    },
    runId: id,
    recordedAt: new Date(Date.parse(session.generatedAt) + slot.ordinal * 1_000).toISOString(),
    mode: slot.mode,
    navigation: slot.navigation,
    sequence: slot.sequence,
    browser: { name: slot.browserName, version: slot.browserVersion, profile: "clean-test" },
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

function observation(slot: BenchmarkSessionSlot, id: string, session: BenchmarkSessionPlan): Record<string, unknown> {
  return {
    schemaVersion: 3,
    generatedAt: "2026-07-29T12:02:00.000Z",
    mode: "observe",
    run: { id, startedAt: session.generatedAt, exportedAt: "2026-07-29T12:02:00.000Z" },
    extension: { version: session.observer.extensionVersion },
    browser: { name: "Firefox", vendor: "Mozilla", version: session.browserVersions.firefox, buildID: "build" },
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
    requestPaths: [{
      pathTemplate: "/:word-m",
      count: 1,
      bytes: 1_000_000 + slot.ordinal,
      durationMs: 20,
      maxDurationMs: 20,
      errors: 0,
      methods: ["GET"],
      resourceTypes: ["xmlhttprequest"],
    }],
  };
}

function completeInputs(session: BenchmarkSessionPlan) {
  const manifests: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  for (const slot of session.slots) {
    const id = runId();
    manifests.push(manifest(slot, id, session));
    if (slot.observerReportRequired) observations.push(observation(slot, id, session));
  }
  return { manifests, observations };
}

const binding = (input: Record<string, unknown>): Record<string, unknown> =>
  input.session as Record<string, unknown>;
const codes = (readiness: ReturnType<typeof checkBenchmarkSession>): Set<string> =>
  new Set(readiness.issues.map((issue) => issue.code));

describe("content-free benchmark session plans", () => {
  it("creates and strictly parses canonical plans", () => {
    const required = plan();
    expect(required.slots).toHaveLength(45);
    expect(plan(true).slots).toHaveLength(60);
    expect(required.slots.slice(0, 3).map((slot) => slot.mode)).toEqual([
      "edge-stock", "firefox-stock", "firefox-observe",
    ]);
    expect(parseBenchmarkSessionPlan(structuredClone(required))).toEqual(required);
    const altered = structuredClone(required) as BenchmarkSessionPlan & { notes?: string };
    altered.notes = "disallowed";
    expect(() => parseBenchmarkSessionPlan(altered)).toThrow(/unsupported fields/);
  });

  it("marks a complete session-bound matrix ready", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    const readiness = checkBenchmarkSession(session, inputs.manifests, inputs.observations);
    expect(readiness.ready).toBe(true);
    expect(readiness.issues).toEqual([]);
    expect(readiness.manifestCount).toBe(45);
    expect(readiness.observationReportCount).toBe(15);
  });

  it("requires schema 3 for readiness while generic analysis remains compatible", () => {
    nextId = 1;
    const session = plan();
    const legacy = manifest(session.slots[0]!, runId(), session);
    legacy.schemaVersion = 2;
    delete legacy.session;
    expect(() => checkBenchmarkSession(session, [legacy], [])).toThrow(/must be 3 for session readiness/);
  });

  it("rejects mixed plan identities, wrong ordinals, and duplicate ordinals", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    binding(inputs.manifests[0]!).sessionId = "00000000-0000-4000-8000-000000000099";
    binding(inputs.manifests[1]!).planGeneratedAt = "2026-07-29T11:59:00.000Z";
    binding(inputs.manifests[2]!).planSchemaVersion = 2;
    binding(inputs.manifests[3]!).slotOrdinal = 1;
    const found = codes(checkBenchmarkSession(session, inputs.manifests, inputs.observations));
    for (const code of [
      "session-id-mismatch",
      "plan-generated-at-mismatch",
      "plan-schema-version-mismatch",
      "slot-ordinal-mismatch",
      "duplicate-slot-ordinal",
    ]) expect(found.has(code)).toBe(true);
  });

  it("rejects execution before plan creation and non-monotonic plan order", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    inputs.manifests[0]!.recordedAt = "2026-07-29T11:59:59.999Z";
    inputs.manifests[2]!.recordedAt = "2026-07-29T12:00:01.500Z";
    const found = codes(checkBenchmarkSession(session, inputs.manifests, inputs.observations));
    expect(found.has("execution-before-plan")).toBe(true);
    expect(found.has("execution-order-violation")).toBe(true);
  });

  it("retains existing missing, identity, observer, and unexpected-run checks", () => {
    nextId = 1;
    const session = plan();
    const inputs = completeInputs(session);
    inputs.manifests.shift();
    (inputs.manifests[0]!.browser as Record<string, unknown>).version = "127.0";
    (inputs.manifests[1]!.memory as Record<string, unknown>).method = "ps";
    (inputs.observations[0]!.extension as Record<string, unknown>).version = "0.0.9";
    inputs.observations[0]!.schemaVersion = 2;
    const found = codes(checkBenchmarkSession(session, inputs.manifests, inputs.observations));
    for (const code of [
      "missing-run",
      "browser-version-mismatch",
      "memory-method-mismatch",
      "observer-extension-version-mismatch",
      "observer-report-schema-mismatch",
      "matrix-warning",
      "comparison-ineligible",
    ]) expect(found.has(code)).toBe(true);

    const extra: BenchmarkSessionSlot = {
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
    const complete = completeInputs(session);
    complete.manifests.push(manifest(extra, runId(), session));
    expect(codes(checkBenchmarkSession(session, complete.manifests, complete.observations)).has("unexpected-run")).toBe(true);
  });
});
