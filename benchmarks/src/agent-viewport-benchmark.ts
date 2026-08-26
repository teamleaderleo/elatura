// SPDX-License-Identifier: MPL-2.0

/**
 * Content-free result contract for the held-out agent viewport experiment.
 *
 * This module deliberately records only fixed enums, bounded tokens, booleans,
 * and numeric accounting.  It does not accept transcript text, snippets,
 * URLs, credentials, or a prose assessment.  The grader reports each
 * dimension independently; there is intentionally no composite score.
 */

export const AGENT_VIEWPORT_BENCHMARK_SCHEMA_VERSION = 1 as const;
export const AGENT_VIEWPORT_BENCHMARK_KIND = "agent-viewport-benchmark" as const;
export const AGENT_VIEWPORT_GRADE_KIND = "agent-viewport-benchmark-grade" as const;

export type ViewportRoute = "broad-control" | "bounded-viewport";
export type ViewportSourceState = "fresh" | "stale" | "drifted" | "UNKNOWN";
export type ViewportOutcome = "success" | "incorrect" | "stale" | "drifted" | "UNKNOWN";

export type ObjectiveCriterion = {
  expected: boolean;
  observed: boolean;
  exact: boolean;
};

export type AgentViewportBenchmarkResult = {
  schemaVersion: 1;
  kind: typeof AGENT_VIEWPORT_BENCHMARK_KIND;
  experimentId: string;
  generatedAt: string;
  scenario: {
    id: string;
    entries: number;
  };
  privacy: {
    responseBodiesCaptured: false;
    messageTextCaptured: false;
    queryStringsCaptured: false;
    rawIdentifiersCaptured: false;
    credentialsCaptured: false;
    remoteTranscriptStored: false;
    automaticSubmission: false;
    navigationAuthority: false;
    clickAuthority: false;
  };
  routes: AgentViewportRouteResult[];
};

export type AgentViewportRouteResult = {
  route: ViewportRoute;
  worker: {
    workerId: string;
    threadId: string;
    fresh: true;
  };
  sourceState: ViewportSourceState;
  outcome: ViewportOutcome;
  objective: {
    facts: ObjectiveCriterion;
    resource: ObjectiveCriterion;
    action: ObjectiveCriterion;
    evidence: ObjectiveCriterion;
  };
  metrics: {
    wallTimeMs: number;
    steps: number;
    toolCalls: number;
    sourceBytesAccessible: number;
    sourceEntriesAccessible: number;
    agentVisibleBytes: number;
    uniqueEntriesExposed: number;
    searches: number;
    opens: number;
    expansions: number;
    resourceCalls: number;
    jumpBackCalls: number;
    irrelevantEntries: number;
    irrelevantExpansions: number;
  };
  retained: {
    maxEntries: number;
    finalEntries: number;
    maxBytes: number;
    finalBytes: number;
  };
  plateau: {
    stable: boolean;
    samples: number;
  };
  explicitness: {
    provenance: boolean;
    omission: boolean;
    freshness: boolean;
    zeroAuthority: boolean;
  };
};

export type AgentViewportBenchmarkGrade = {
  schemaVersion: 1;
  kind: typeof AGENT_VIEWPORT_GRADE_KIND;
  experimentId: string;
  routes: Array<{
    route: ViewportRoute;
    sourceState: ViewportSourceState;
    outcome: ViewportOutcome;
    objective: {
      factsExact: boolean;
      resourceExact: boolean;
      actionExact: boolean;
      evidenceExact: boolean;
    };
    explicitness: {
      provenance: boolean;
      omission: boolean;
      freshness: boolean;
      zeroAuthority: boolean;
    };
  }>;
  comparison: {
    independentFreshWorkers: boolean;
    privacyFlagsPinned: boolean;
    objective: {
      facts: { controlExact: boolean; boundedExact: boolean };
      resource: { controlExact: boolean; boundedExact: boolean };
      action: { controlExact: boolean; boundedExact: boolean };
      evidence: { controlExact: boolean; boundedExact: boolean };
    };
    metrics: {
      agentVisibleBytes: { control: number; bounded: number; boundedLess: boolean };
      uniqueEntriesExposed: { control: number; bounded: number; boundedLess: boolean };
      irrelevantEntries: { control: number; bounded: number; boundedLess: boolean };
      irrelevantExpansions: { control: number; bounded: number; boundedLess: boolean };
      expansions: { control: number; bounded: number; boundedLess: boolean };
    };
    retained: {
      maxEntries: { control: number; bounded: number; boundedLess: boolean };
      finalEntries: { control: number; bounded: number; boundedLess: boolean };
      maxBytes: { control: number; bounded: number; boundedLess: boolean };
      finalBytes: { control: number; bounded: number; boundedLess: boolean };
    };
    boundedPlateauStable: boolean;
  };
};

type JsonRecord = Record<string, unknown>;

const ROUTES: readonly ViewportRoute[] = ["broad-control", "bounded-viewport"];
const SOURCE_STATES: readonly ViewportSourceState[] = ["fresh", "stale", "drifted", "UNKNOWN"];
const OUTCOMES: readonly ViewportOutcome[] = ["success", "incorrect", "stale", "drifted", "UNKNOWN"];
const TOKEN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_ENTRIES = 10_000_000;
const MAX_BYTES = 1_073_741_824;
const MAX_COUNT = 10_000_000;
const MAX_WALL_TIME_MS = 86_400_000;

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${path} contains unexpected or missing fields.`);
  }
}

function token(value: unknown, path: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw new TypeError(`${path} must be a bounded token.`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new TypeError(`${path} must be a canonical UTC timestamp.`);
  }
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${path} must be a valid timestamp.`);
  return value;
}

function integer(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${path} must be a bounded non-negative integer.`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean.`);
  return value;
}

function pinnedFalse(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false.`);
  return false;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${path} must be one of the fixed values.`);
  }
  return value as T;
}

function criterion(value: unknown, path: string): ObjectiveCriterion {
  const item = record(value, path);
  exactKeys(item, ["expected", "observed", "exact"], path);
  const expected = bool(item.expected, `${path}.expected`);
  const observed = bool(item.observed, `${path}.observed`);
  const exact = bool(item.exact, `${path}.exact`);
  if (exact !== (expected === observed)) {
    throw new TypeError(`${path}.exact must agree with expected and observed.`);
  }
  return { expected, observed, exact };
}

function parsePrivacy(value: unknown, path: string): AgentViewportBenchmarkResult["privacy"] {
  const item = record(value, path);
  const keys = [
    "responseBodiesCaptured",
    "messageTextCaptured",
    "queryStringsCaptured",
    "rawIdentifiersCaptured",
    "credentialsCaptured",
    "remoteTranscriptStored",
    "automaticSubmission",
    "navigationAuthority",
    "clickAuthority",
  ] as const;
  exactKeys(item, keys, path);
  for (const key of keys) pinnedFalse(item[key], `${path}.${key}`);
  return {
    responseBodiesCaptured: false,
    messageTextCaptured: false,
    queryStringsCaptured: false,
    rawIdentifiersCaptured: false,
    credentialsCaptured: false,
    remoteTranscriptStored: false,
    automaticSubmission: false,
    navigationAuthority: false,
    clickAuthority: false,
  };
}

function parseRoute(value: unknown, index: number): AgentViewportRouteResult {
  const path = `$result.routes[${index}]`;
  const item = record(value, path);
  exactKeys(item, ["route", "worker", "sourceState", "outcome", "objective", "metrics", "retained", "plateau", "explicitness"], path);
  const worker = record(item.worker, `${path}.worker`);
  exactKeys(worker, ["workerId", "threadId", "fresh"], `${path}.worker`);
  const parsedWorker = {
    workerId: token(worker.workerId, `${path}.worker.workerId`),
    threadId: token(worker.threadId, `${path}.worker.threadId`),
    fresh: true as const,
  };
  if (worker.fresh !== true) throw new TypeError(`${path}.worker.fresh must be true.`);

  const metrics = record(item.metrics, `${path}.metrics`);
  const metricKeys = [
    "wallTimeMs", "steps", "toolCalls", "sourceBytesAccessible", "sourceEntriesAccessible",
    "agentVisibleBytes", "uniqueEntriesExposed", "searches", "opens", "expansions",
    "resourceCalls", "jumpBackCalls", "irrelevantEntries", "irrelevantExpansions",
  ] as const;
  exactKeys(metrics, metricKeys, `${path}.metrics`);
  const parsedMetrics = {
    wallTimeMs: integer(metrics.wallTimeMs, `${path}.metrics.wallTimeMs`, MAX_WALL_TIME_MS),
    steps: integer(metrics.steps, `${path}.metrics.steps`, MAX_COUNT),
    toolCalls: integer(metrics.toolCalls, `${path}.metrics.toolCalls`, MAX_COUNT),
    sourceBytesAccessible: integer(metrics.sourceBytesAccessible, `${path}.metrics.sourceBytesAccessible`, MAX_BYTES),
    sourceEntriesAccessible: integer(metrics.sourceEntriesAccessible, `${path}.metrics.sourceEntriesAccessible`, MAX_ENTRIES),
    agentVisibleBytes: integer(metrics.agentVisibleBytes, `${path}.metrics.agentVisibleBytes`, MAX_BYTES),
    uniqueEntriesExposed: integer(metrics.uniqueEntriesExposed, `${path}.metrics.uniqueEntriesExposed`, MAX_ENTRIES),
    searches: integer(metrics.searches, `${path}.metrics.searches`, MAX_COUNT),
    opens: integer(metrics.opens, `${path}.metrics.opens`, MAX_COUNT),
    expansions: integer(metrics.expansions, `${path}.metrics.expansions`, MAX_COUNT),
    resourceCalls: integer(metrics.resourceCalls, `${path}.metrics.resourceCalls`, MAX_COUNT),
    jumpBackCalls: integer(metrics.jumpBackCalls, `${path}.metrics.jumpBackCalls`, MAX_COUNT),
    irrelevantEntries: integer(metrics.irrelevantEntries, `${path}.metrics.irrelevantEntries`, MAX_ENTRIES),
    irrelevantExpansions: integer(metrics.irrelevantExpansions, `${path}.metrics.irrelevantExpansions`, MAX_COUNT),
  };

  const retained = record(item.retained, `${path}.retained`);
  exactKeys(retained, ["maxEntries", "finalEntries", "maxBytes", "finalBytes"], `${path}.retained`);
  const parsedRetained = {
    maxEntries: integer(retained.maxEntries, `${path}.retained.maxEntries`, MAX_ENTRIES),
    finalEntries: integer(retained.finalEntries, `${path}.retained.finalEntries`, MAX_ENTRIES),
    maxBytes: integer(retained.maxBytes, `${path}.retained.maxBytes`, MAX_BYTES),
    finalBytes: integer(retained.finalBytes, `${path}.retained.finalBytes`, MAX_BYTES),
  };
  if (parsedRetained.finalEntries > parsedRetained.maxEntries || parsedRetained.finalBytes > parsedRetained.maxBytes) {
    throw new TypeError(`${path}.retained final usage cannot exceed maximum usage.`);
  }

  const plateau = record(item.plateau, `${path}.plateau`);
  exactKeys(plateau, ["stable", "samples"], `${path}.plateau`);
  const parsedPlateau = { stable: bool(plateau.stable, `${path}.plateau.stable`), samples: integer(plateau.samples, `${path}.plateau.samples`, MAX_COUNT) };
  if (parsedPlateau.stable && parsedPlateau.samples < 2) throw new TypeError(`${path}.plateau.stable requires at least two samples.`);

  const explicitness = record(item.explicitness, `${path}.explicitness`);
  exactKeys(explicitness, ["provenance", "omission", "freshness", "zeroAuthority"], `${path}.explicitness`);
  const parsedExplicitness = {
    provenance: bool(explicitness.provenance, `${path}.explicitness.provenance`),
    omission: bool(explicitness.omission, `${path}.explicitness.omission`),
    freshness: bool(explicitness.freshness, `${path}.explicitness.freshness`),
    zeroAuthority: bool(explicitness.zeroAuthority, `${path}.explicitness.zeroAuthority`),
  };

  const sourceState = enumValue(item.sourceState, SOURCE_STATES, `${path}.sourceState`);
  const outcome = enumValue(item.outcome, OUTCOMES, `${path}.outcome`);
  if (sourceState !== "fresh" && outcome !== sourceState) {
    throw new TypeError(`${path}.outcome must preserve the negative source state.`);
  }
  if (sourceState === "fresh" && (outcome === "stale" || outcome === "drifted" || outcome === "UNKNOWN")) {
    throw new TypeError(`${path}.outcome cannot claim a negative source state for a fresh source.`);
  }
  const objective = record(item.objective, `${path}.objective`);
  exactKeys(objective, ["facts", "resource", "action", "evidence"], `${path}.objective`);
  return {
    route: enumValue(item.route, ROUTES, `${path}.route`),
    worker: parsedWorker,
    sourceState,
    outcome,
    objective: {
      facts: criterion(objective.facts, `${path}.objective.facts`),
      resource: criterion(objective.resource, `${path}.objective.resource`),
      action: criterion(objective.action, `${path}.objective.action`),
      evidence: criterion(objective.evidence, `${path}.objective.evidence`),
    },
    metrics: parsedMetrics,
    retained: parsedRetained,
    plateau: parsedPlateau,
    explicitness: parsedExplicitness,
  };
}

export function parseAgentViewportBenchmarkResult(input: unknown): AgentViewportBenchmarkResult {
  const root = record(input, "$result");
  exactKeys(root, ["schemaVersion", "kind", "experimentId", "generatedAt", "scenario", "privacy", "routes"], "$result");
  if (root.schemaVersion !== AGENT_VIEWPORT_BENCHMARK_SCHEMA_VERSION) throw new TypeError("$result.schemaVersion is unsupported.");
  if (root.kind !== AGENT_VIEWPORT_BENCHMARK_KIND) throw new TypeError("$result.kind is invalid.");
  const experimentId = token(root.experimentId, "$result.experimentId");
  const generatedAt = timestamp(root.generatedAt, "$result.generatedAt");
  const scenario = record(root.scenario, "$result.scenario");
  exactKeys(scenario, ["id", "entries"], "$result.scenario");
  const parsedScenario = {
    id: token(scenario.id, "$result.scenario.id"),
    entries: integer(scenario.entries, "$result.scenario.entries", MAX_ENTRIES),
  };
  const routesValue = root.routes;
  if (!Array.isArray(routesValue) || routesValue.length !== 2) throw new TypeError("$result.routes must contain exactly two routes.");
  const routes = routesValue.map(parseRoute);
  const routeNames = routes.map((route) => route.route);
  if (new Set(routeNames).size !== 2 || !ROUTES.every((route) => routeNames.includes(route))) {
    throw new TypeError("$result.routes must contain one control and one bounded route.");
  }
  if (routes[0]!.worker.workerId === routes[1]!.worker.workerId || routes[0]!.worker.threadId === routes[1]!.worker.threadId) {
    throw new TypeError("$result routes require independent worker and thread identifiers.");
  }
  return {
    schemaVersion: 1,
    kind: AGENT_VIEWPORT_BENCHMARK_KIND,
    experimentId,
    generatedAt,
    scenario: parsedScenario,
    privacy: parsePrivacy(root.privacy, "$result.privacy"),
    routes: routes.sort((left, right) => ROUTES.indexOf(left.route) - ROUTES.indexOf(right.route)),
  };
}

function comparisonNumber(control: number, bounded: number): { control: number; bounded: number; boundedLess: boolean } {
  return { control, bounded, boundedLess: bounded < control };
}

export function gradeAgentViewportBenchmark(input: unknown): AgentViewportBenchmarkGrade {
  const result = parseAgentViewportBenchmarkResult(input);
  const control = result.routes.find((route) => route.route === "broad-control")!;
  const bounded = result.routes.find((route) => route.route === "bounded-viewport")!;
  const criterionGrade = (name: keyof AgentViewportRouteResult["objective"]) => ({
    controlExact: control.objective[name].exact,
    boundedExact: bounded.objective[name].exact,
  });
  const metricGrade = (name: keyof AgentViewportRouteResult["metrics"]) =>
    comparisonNumber(control.metrics[name], bounded.metrics[name]);
  const retainedGrade = (name: keyof AgentViewportRouteResult["retained"]) =>
    comparisonNumber(control.retained[name], bounded.retained[name]);
  return {
    schemaVersion: 1,
    kind: AGENT_VIEWPORT_GRADE_KIND,
    experimentId: result.experimentId,
    routes: result.routes.map((route) => ({
      route: route.route,
      sourceState: route.sourceState,
      outcome: route.outcome,
      objective: {
        factsExact: route.objective.facts.exact,
        resourceExact: route.objective.resource.exact,
        actionExact: route.objective.action.exact,
        evidenceExact: route.objective.evidence.exact,
      },
      explicitness: { ...route.explicitness },
    })),
    comparison: {
      independentFreshWorkers: control.worker.fresh && bounded.worker.fresh && control.worker.workerId !== bounded.worker.workerId && control.worker.threadId !== bounded.worker.threadId,
      privacyFlagsPinned: true,
      objective: {
        facts: criterionGrade("facts"),
        resource: criterionGrade("resource"),
        action: criterionGrade("action"),
        evidence: criterionGrade("evidence"),
      },
      metrics: {
        agentVisibleBytes: metricGrade("agentVisibleBytes"),
        uniqueEntriesExposed: metricGrade("uniqueEntriesExposed"),
        irrelevantEntries: metricGrade("irrelevantEntries"),
        irrelevantExpansions: metricGrade("irrelevantExpansions"),
        expansions: metricGrade("expansions"),
      },
      retained: {
        maxEntries: retainedGrade("maxEntries"),
        finalEntries: retainedGrade("finalEntries"),
        maxBytes: retainedGrade("maxBytes"),
        finalBytes: retainedGrade("finalBytes"),
      },
      boundedPlateauStable: bounded.plateau.stable,
    },
  };
}

// Short aliases for callers that treat the contract as the benchmark API.
export const parseViewportBenchmarkResult = parseAgentViewportBenchmarkResult;
export const gradeViewportBenchmark = gradeAgentViewportBenchmark;
