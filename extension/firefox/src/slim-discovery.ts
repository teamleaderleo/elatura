// SPDX-License-Identifier: MPL-2.0

import type { SlimTurnDescriptor } from "./slim-window.js";

export const MAX_SLIM_DISCOVERY_CANDIDATES = 10_000;
export const DEFAULT_SLIM_ROUTE_GRACE_MS = 1_500;
export const DEFAULT_SLIM_DRIFT_FAILURE_LIMIT = 3;
const MAX_DISCOVERY_TOKEN_LENGTH = 128;
const MAX_DISCOVERY_BLOCK_SIZE_PX = 1_000_000;
const TOKEN_PATTERN = /^[0-9A-Za-z:_-]+$/u;

export type SlimObservedRole = "user" | "assistant" | "tool" | "system" | "unknown";

export type SlimDiscoveryCandidate = {
  id: string;
  parentToken: string;
  documentOrder: number;
  role: SlimObservedRole;
  streaming: boolean;
  estimatedBlockSizePx: number;
};

export type SlimDiscoveryFailureReason =
  | "no-turn-candidates"
  | "candidate-budget-exceeded"
  | "invalid-candidate"
  | "invalid-candidate-id"
  | "duplicate-candidate-id"
  | "invalid-parent-token"
  | "turn-parent-mismatch"
  | "invalid-document-order"
  | "turn-order-ambiguous"
  | "invalid-role"
  | "invalid-streaming-flag"
  | "invalid-block-size"
  | "unsupported-role-set";

export type SlimDiscoveryIssue = {
  path: string;
  code: SlimDiscoveryFailureReason;
  message: string;
};

export type SlimDiscoveryResult =
  | {
      ok: true;
      value: {
        turns: SlimTurnDescriptor[];
        userTurns: number;
        assistantTurns: number;
        streamingTurns: number;
        groupCount: number;
      };
      warnings: SlimDiscoveryIssue[];
    }
  | { ok: false; issues: SlimDiscoveryIssue[] };

export type SlimDriftState = {
  everApplied: boolean;
  consecutiveFailures: number;
  routeChangedAtMs: number | null;
  lastFailureReason: SlimDiscoveryFailureReason | null;
};

export type SlimDriftDecision = {
  state: SlimDriftState;
  status: "stable" | "grace" | "unsupported" | "drifted" | "failed-open";
  shouldRetry: boolean;
  shouldFailOpen: boolean;
};

export type SlimDriftEvent =
  | { kind: "route-changed"; atMs: number }
  | { kind: "discovery-succeeded"; atMs: number }
  | { kind: "discovery-failed"; atMs: number; reason: SlimDiscoveryFailureReason }
  | { kind: "mode-applied"; atMs: number };

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DISCOVERY_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(value)
  );
}

function validRole(value: unknown): value is SlimObservedRole {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "tool" ||
    value === "system" ||
    value === "unknown"
  );
}

function issue(
  path: string,
  code: SlimDiscoveryFailureReason,
  message: string,
): SlimDiscoveryIssue {
  return { path, code, message };
}

export function normalizeSlimObservedRole(value: unknown): SlimObservedRole {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return validRole(normalized) ? normalized : "unknown";
}

export function validateAndGroupSlimDiscovery(
  candidates: readonly SlimDiscoveryCandidate[],
): SlimDiscoveryResult {
  if (candidates.length === 0) {
    return {
      ok: false,
      issues: [issue("$.candidates", "no-turn-candidates", "Expected at least one turn candidate.")],
    };
  }
  if (candidates.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return {
      ok: false,
      issues: [
        issue(
          "$.candidates",
          "candidate-budget-exceeded",
          `Turn discovery exceeds the ${MAX_SLIM_DISCOVERY_CANDIDATES} candidate budget.`,
        ),
      ],
    };
  }

  const issues: SlimDiscoveryIssue[] = [];
  const seenIds = new Set<string>();
  let expectedParent: string | null = null;
  let previousOrder = -1;
  let userTurns = 0;
  let assistantTurns = 0;
  let streamingTurns = 0;
  let groupIndex = 0;
  const turns: SlimTurnDescriptor[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const path = `$.candidates[${index}]`;
    if (!candidate || typeof candidate !== "object") {
      issues.push(issue(path, "invalid-candidate", "Expected a turn candidate."));
      continue;
    }

    if (!validToken(candidate.id)) {
      issues.push(issue(`${path}.id`, "invalid-candidate-id", "Candidate ids must be bounded opaque tokens."));
    } else if (seenIds.has(candidate.id)) {
      issues.push(issue(`${path}.id`, "duplicate-candidate-id", "Candidate ids must be unique."));
    } else {
      seenIds.add(candidate.id);
    }

    if (!validToken(candidate.parentToken)) {
      issues.push(
        issue(`${path}.parentToken`, "invalid-parent-token", "Parent tokens must be bounded opaque tokens."),
      );
    } else {
      if (expectedParent === null) expectedParent = candidate.parentToken;
      else if (candidate.parentToken !== expectedParent) {
        issues.push(
          issue(`${path}.parentToken`, "turn-parent-mismatch", "All discovered turns must share one parent."),
        );
      }
    }

    if (!Number.isInteger(candidate.documentOrder) || candidate.documentOrder < 0) {
      issues.push(
        issue(`${path}.documentOrder`, "invalid-document-order", "Document order must be a non-negative integer."),
      );
    } else if (candidate.documentOrder <= previousOrder) {
      issues.push(
        issue(`${path}.documentOrder`, "turn-order-ambiguous", "Turn order must be strictly increasing."),
      );
    } else {
      previousOrder = candidate.documentOrder;
    }

    if (!validRole(candidate.role)) {
      issues.push(issue(`${path}.role`, "invalid-role", "Observed roles must use the bounded role vocabulary."));
    }
    if (typeof candidate.streaming !== "boolean") {
      issues.push(
        issue(`${path}.streaming`, "invalid-streaming-flag", "The streaming marker must be boolean."),
      );
    }
    if (
      !Number.isFinite(candidate.estimatedBlockSizePx) ||
      candidate.estimatedBlockSizePx < 0 ||
      candidate.estimatedBlockSizePx > MAX_DISCOVERY_BLOCK_SIZE_PX
    ) {
      issues.push(
        issue(
          `${path}.estimatedBlockSizePx`,
          "invalid-block-size",
          `Block size must be finite and between 0 and ${MAX_DISCOVERY_BLOCK_SIZE_PX}.`,
        ),
      );
    }

    if (candidate.role === "user") {
      groupIndex += 1;
      userTurns += 1;
    } else if (candidate.role === "assistant") {
      assistantTurns += 1;
    }
    if (candidate.streaming) streamingTurns += 1;

    turns.push({
      id: candidate.id,
      groupKey: `group-${groupIndex}`,
      streaming: candidate.streaming,
      estimatedBlockSizePx: candidate.estimatedBlockSizePx,
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  if (userTurns === 0 && assistantTurns === 0) {
    return {
      ok: false,
      issues: [
        issue(
          "$.candidates",
          "unsupported-role-set",
          "Discovery must contain at least one user or assistant turn.",
        ),
      ],
    };
  }

  return {
    ok: true,
    value: {
      turns,
      userTurns,
      assistantTurns,
      streamingTurns,
      groupCount: groupIndex + (groupIndex === 0 ? 1 : 0),
    },
    warnings: [],
  };
}

export function initialSlimDriftState(): SlimDriftState {
  return {
    everApplied: false,
    consecutiveFailures: 0,
    routeChangedAtMs: null,
    lastFailureReason: null,
  };
}

function validTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function reduceSlimDrift(
  state: SlimDriftState,
  event: SlimDriftEvent,
  options: {
    routeGraceMs?: number;
    failureLimit?: number;
  } = {},
): SlimDriftDecision {
  if (!validTime(event.atMs)) throw new RangeError("Drift event time must be finite and non-negative.");
  const routeGraceMs = options.routeGraceMs ?? DEFAULT_SLIM_ROUTE_GRACE_MS;
  const failureLimit = options.failureLimit ?? DEFAULT_SLIM_DRIFT_FAILURE_LIMIT;
  if (!Number.isFinite(routeGraceMs) || routeGraceMs < 0) {
    throw new RangeError("routeGraceMs must be finite and non-negative.");
  }
  if (!Number.isInteger(failureLimit) || failureLimit < 1) {
    throw new RangeError("failureLimit must be a positive integer.");
  }

  if (event.kind === "route-changed") {
    return {
      state: {
        ...state,
        consecutiveFailures: 0,
        routeChangedAtMs: event.atMs,
        lastFailureReason: null,
      },
      status: "grace",
      shouldRetry: true,
      shouldFailOpen: false,
    };
  }

  if (event.kind === "mode-applied") {
    return {
      state: {
        ...state,
        everApplied: true,
        consecutiveFailures: 0,
        routeChangedAtMs: null,
        lastFailureReason: null,
      },
      status: "stable",
      shouldRetry: false,
      shouldFailOpen: false,
    };
  }

  if (event.kind === "discovery-succeeded") {
    return {
      state: {
        ...state,
        consecutiveFailures: 0,
        routeChangedAtMs: null,
        lastFailureReason: null,
      },
      status: "stable",
      shouldRetry: false,
      shouldFailOpen: false,
    };
  }

  const insideRouteGrace =
    state.routeChangedAtMs !== null && event.atMs - state.routeChangedAtMs < routeGraceMs;
  if (insideRouteGrace) {
    return {
      state: { ...state, lastFailureReason: event.reason },
      status: "grace",
      shouldRetry: true,
      shouldFailOpen: false,
    };
  }

  if (!state.everApplied) {
    return {
      state: { ...state, lastFailureReason: event.reason },
      status: "unsupported",
      shouldRetry: false,
      shouldFailOpen: false,
    };
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  const shouldFailOpen = consecutiveFailures >= failureLimit;
  return {
    state: {
      ...state,
      consecutiveFailures,
      routeChangedAtMs: null,
      lastFailureReason: event.reason,
    },
    status: shouldFailOpen ? "failed-open" : "drifted",
    shouldRetry: !shouldFailOpen,
    shouldFailOpen,
  };
}
