// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIM_DRIFT_FAILURE_LIMIT,
  MAX_SLIM_DISCOVERY_CANDIDATES,
  initialSlimDriftState,
  normalizeSlimObservedRole,
  reduceSlimDrift,
  validateAndGroupSlimDiscovery,
  type SlimDiscoveryCandidate,
} from "../src/slim-discovery.js";

function candidate(
  id: string,
  documentOrder: number,
  role: SlimDiscoveryCandidate["role"],
  overrides: Partial<SlimDiscoveryCandidate> = {},
): SlimDiscoveryCandidate {
  return {
    id,
    parentToken: "parent-1",
    documentOrder,
    role,
    streaming: false,
    estimatedBlockSizePx: 200,
    ...overrides,
  };
}

describe("slim discovery policy", () => {
  it("groups an ordered user/assistant sequence without content", () => {
    const result = validateAndGroupSlimDiscovery([
      candidate("turn-1", 0, "system"),
      candidate("turn-2", 1, "user"),
      candidate("turn-3", 2, "assistant"),
      candidate("turn-4", 3, "tool"),
      candidate("turn-5", 4, "user"),
      candidate("turn-6", 5, "assistant", { streaming: true }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turns.map((turn) => turn.groupKey)).toEqual([
      "group-0",
      "group-1",
      "group-1",
      "group-1",
      "group-2",
      "group-2",
    ]);
    expect(result.value.userTurns).toBe(2);
    expect(result.value.assistantTurns).toBe(2);
    expect(result.value.streamingTurns).toBe(1);
    expect(result.value.groupCount).toBe(2);
  });

  it("normalizes unknown provider roles without preserving arbitrary strings", () => {
    expect(normalizeSlimObservedRole(" USER ")).toBe("user");
    expect(normalizeSlimObservedRole("assistant")).toBe("assistant");
    expect(normalizeSlimObservedRole("future-private-role-name")).toBe("unknown");
    expect(normalizeSlimObservedRole(null)).toBe("unknown");
  });

  it("rejects mismatched parents and ambiguous order in one linear pass", () => {
    const result = validateAndGroupSlimDiscovery([
      candidate("turn-1", 1, "user"),
      candidate("turn-2", 1, "assistant", { parentToken: "parent-2" }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["turn-parent-mismatch", "turn-order-ambiguous"]),
    );
  });

  it("rejects duplicate identifiers and unsupported role-only layouts", () => {
    const duplicate = validateAndGroupSlimDiscovery([
      candidate("turn-1", 0, "user"),
      candidate("turn-1", 1, "assistant"),
    ]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.issues.map((entry) => entry.code)).toContain("duplicate-candidate-id");
    }

    const unsupported = validateAndGroupSlimDiscovery([
      candidate("turn-1", 0, "system"),
      candidate("turn-2", 1, "tool"),
    ]);
    expect(unsupported).toMatchObject({
      ok: false,
      issues: [{ code: "unsupported-role-set" }],
    });
  });

  it("enforces the candidate budget before iterating provider data", () => {
    const oversized = Array.from({ length: MAX_SLIM_DISCOVERY_CANDIDATES + 1 }, (_, index) =>
      candidate(`turn-${index}`, index, index % 2 === 0 ? "user" : "assistant"),
    );
    expect(validateAndGroupSlimDiscovery(oversized)).toMatchObject({
      ok: false,
      issues: [{ code: "candidate-budget-exceeded" }],
    });
  });
});

describe("slim drift reducer", () => {
  it("grants a time-based route transition grace period without consuming failure budget", () => {
    let state = initialSlimDriftState();
    state = reduceSlimDrift(state, { kind: "mode-applied", atMs: 100 }).state;
    const route = reduceSlimDrift(state, { kind: "route-changed", atMs: 1_000 });
    const failure = reduceSlimDrift(route.state, {
      kind: "discovery-failed",
      atMs: 2_000,
      reason: "no-turn-candidates",
    });

    expect(failure.status).toBe("grace");
    expect(failure.shouldRetry).toBe(true);
    expect(failure.shouldFailOpen).toBe(false);
    expect(failure.state.consecutiveFailures).toBe(0);
  });

  it("fails open only after the configured consecutive post-grace failures", () => {
    let state = reduceSlimDrift(initialSlimDriftState(), {
      kind: "mode-applied",
      atMs: 100,
    }).state;

    for (let attempt = 1; attempt < DEFAULT_SLIM_DRIFT_FAILURE_LIMIT; attempt += 1) {
      const decision = reduceSlimDrift(state, {
        kind: "discovery-failed",
        atMs: 2_000 + attempt,
        reason: "turn-parent-mismatch",
      });
      expect(decision.status).toBe("drifted");
      expect(decision.shouldRetry).toBe(true);
      state = decision.state;
    }

    const terminal = reduceSlimDrift(state, {
      kind: "discovery-failed",
      atMs: 3_000,
      reason: "turn-parent-mismatch",
    });
    expect(terminal.status).toBe("failed-open");
    expect(terminal.shouldFailOpen).toBe(true);
    expect(terminal.shouldRetry).toBe(false);
  });

  it("treats a pre-application discovery failure as unsupported rather than drift", () => {
    const result = reduceSlimDrift(initialSlimDriftState(), {
      kind: "discovery-failed",
      atMs: 100,
      reason: "no-turn-candidates",
    });

    expect(result.status).toBe("unsupported");
    expect(result.shouldRetry).toBe(false);
    expect(result.shouldFailOpen).toBe(false);
  });

  it("resets failure and route state after successful discovery", () => {
    const applied = reduceSlimDrift(initialSlimDriftState(), {
      kind: "mode-applied",
      atMs: 100,
    });
    const failed = reduceSlimDrift(applied.state, {
      kind: "discovery-failed",
      atMs: 200,
      reason: "turn-order-ambiguous",
    });
    const recovered = reduceSlimDrift(failed.state, {
      kind: "discovery-succeeded",
      atMs: 300,
    });

    expect(recovered.status).toBe("stable");
    expect(recovered.state.consecutiveFailures).toBe(0);
    expect(recovered.state.routeChangedAtMs).toBeNull();
    expect(recovered.state.lastFailureReason).toBeNull();
  });

  it("rejects invalid timing and failure-limit configuration", () => {
    expect(() =>
      reduceSlimDrift(initialSlimDriftState(), { kind: "route-changed", atMs: Number.NaN }),
    ).toThrow(/event time/u);
    expect(() =>
      reduceSlimDrift(
        initialSlimDriftState(),
        { kind: "route-changed", atMs: 1 },
        { failureLimit: 0 },
      ),
    ).toThrow(/failureLimit/u);
  });
});
