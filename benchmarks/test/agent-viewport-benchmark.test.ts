// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  gradeAgentViewportBenchmark,
  parseAgentViewportBenchmarkResult,
  type AgentViewportBenchmarkResult,
} from "../src/agent-viewport-benchmark.js";

function criterion(observed: boolean): Record<string, boolean> {
  return { expected: true, observed, exact: observed };
}

function route(routeName: "broad-control" | "bounded-viewport", workerId: string, threadId: string) {
  const bounded = routeName === "bounded-viewport";
  return {
    route: routeName,
    worker: { workerId, threadId, fresh: true },
    sourceState: "fresh",
    outcome: "success",
    objective: {
      facts: criterion(true),
      resource: criterion(true),
      action: criterion(true),
      evidence: criterion(true),
    },
    metrics: {
      wallTimeMs: bounded ? 250 : 500,
      steps: bounded ? 8 : 4,
      toolCalls: bounded ? 7 : 3,
      sourceBytesAccessible: 120_000_000,
      sourceEntriesAccessible: 100_000,
      agentVisibleBytes: bounded ? 12_000 : 120_000_000,
      uniqueEntriesExposed: bounded ? 6 : 100_000,
      searches: bounded ? 1 : 0,
      opens: bounded ? 2 : 1,
      expansions: bounded ? 1 : 0,
      resourceCalls: bounded ? 1 : 0,
      jumpBackCalls: 0,
      irrelevantEntries: bounded ? 1 : 99_900,
      irrelevantExpansions: 0,
    },
    retained: {
      maxEntries: bounded ? 32 : 100_000,
      finalEntries: bounded ? 16 : 100_000,
      maxBytes: bounded ? 24_000 : 120_000_000,
      finalBytes: bounded ? 12_000 : 120_000_000,
    },
    plateau: { stable: true, samples: 3 },
    explicitness: { provenance: true, omission: true, freshness: true, zeroAuthority: true },
  };
}

function result(): AgentViewportBenchmarkResult {
  return {
    schemaVersion: 1,
    kind: "agent-viewport-benchmark",
    experimentId: "held-out-viewport",
    generatedAt: "2026-08-25T00:00:00Z",
    scenario: { id: "held-out-100000", entries: 100_000 },
    privacy: {
      responseBodiesCaptured: false,
      messageTextCaptured: false,
      queryStringsCaptured: false,
      rawIdentifiersCaptured: false,
      credentialsCaptured: false,
      remoteTranscriptStored: false,
      automaticSubmission: false,
      navigationAuthority: false,
      clickAuthority: false,
    },
    routes: [route("broad-control", "worker-control", "thread-control"), route("bounded-viewport", "worker-bounded", "thread-bounded")],
  };
}

describe("agent viewport benchmark contract", () => {
  it("parses the two-route content-free result without mutation", () => {
    const input = result();
    const before = structuredClone(input);
    const parsed = parseAgentViewportBenchmarkResult(input);
    expect(parsed.routes.map((item) => item.route)).toEqual(["broad-control", "bounded-viewport"]);
    expect(parsed.routes[1]?.metrics.agentVisibleBytes).toBe(12_000);
    expect(input).toEqual(before);
  });

  it("grades objective dimensions and bounded reductions independently", () => {
    const grade = gradeAgentViewportBenchmark(result());
    expect(grade.routes.every((item) => item.objective.factsExact && item.objective.evidenceExact)).toBe(true);
    expect(grade.comparison.metrics.agentVisibleBytes).toEqual({
      control: 120_000_000,
      bounded: 12_000,
      boundedLess: true,
    });
    expect(grade.comparison.retained.maxEntries.boundedLess).toBe(true);
    expect(grade).not.toHaveProperty("score");
  });

  it("preserves stale, drifted, and UNKNOWN as explicit negative states", () => {
    for (const state of ["stale", "drifted", "UNKNOWN"] as const) {
      const input = result();
      const negative = input.routes[1]! as unknown as Record<string, unknown>;
      negative.sourceState = state;
      negative.outcome = state;
      expect(parseAgentViewportBenchmarkResult(input).routes[1]?.sourceState).toBe(state);
      expect(gradeAgentViewportBenchmark(input).routes[1]?.outcome).toBe(state);
    }
  });

  it("rejects privacy widening, contradictory exactness, and duplicate workers", () => {
    const privacy = result();
    (privacy.privacy as unknown as Record<string, unknown>).messageTextCaptured = true;
    expect(() => parseAgentViewportBenchmarkResult(privacy)).toThrow(/must be false/);

    const exactness = result();
    const facts = (exactness.routes[0]!.objective.facts as unknown) as Record<string, unknown>;
    facts.observed = false;
    expect(() => parseAgentViewportBenchmarkResult(exactness)).toThrow(/exact must agree/);

    const duplicate = result();
    duplicate.routes[1]!.worker.workerId = duplicate.routes[0]!.worker.workerId;
    expect(() => parseAgentViewportBenchmarkResult(duplicate)).toThrow(/independent worker/);
  });
});
