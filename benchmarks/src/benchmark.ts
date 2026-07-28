// SPDX-License-Identifier: MPL-2.0
import {
  parseObservationReport,
  summarizeDistribution,
  type DistributionSummary,
  type ObservationReport,
} from "./observation.js";

export const BENCHMARK_RUN_MANIFEST_SCHEMA_VERSION = 2 as const;

export type BenchmarkMode = "edge-stock" | "firefox-stock" | "firefox-observe";
export type BenchmarkNavigation = "cold-open" | "hard-reload" | "client-navigation";
export type BenchmarkOutcomeStatus = "usable" | "failed" | "cancelled";
export type BenchmarkFailureCode =
  | "browser-crash"
  | "navigation-error"
  | "composer-unavailable"
  | "timeout"
  | "operator-cancelled";
export type BenchmarkMemoryMethod = "activity-monitor" | "task-manager" | "ps";
export type BenchmarkProcessClass =
  | "browser-total"
  | "browser-main"
  | "content-total"
  | "content-peak"
  | "gpu"
  | "extension";

export type BenchmarkRunManifest = {
  schemaVersion: typeof BENCHMARK_RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  recordedAt: string;
  mode: BenchmarkMode;
  navigation: BenchmarkNavigation;
  sequence: number;
  browser: {
    name: "Edge" | "Firefox";
    version: string;
    profile: "clean-test";
  };
  timings: {
    source: "manual" | "observer-report";
    domContentLoadedMs: number | null;
    composerReadyMs: number | null;
  };
  memory: {
    method: BenchmarkMemoryMethod;
    peaks: Array<{ processClass: BenchmarkProcessClass; peakBytes: number }>;
  } | null;
  outcome: {
    status: BenchmarkOutcomeStatus;
    failureCode: BenchmarkFailureCode | null;
  };
  observerReportRunId: string | null;
  privacy: {
    contentCaptured: false;
    urlsCaptured: false;
    notesCaptured: false;
    processCommandLinesCaptured: false;
  };
};

export type BenchmarkWarningCode =
  | "small-sample"
  | "failed-runs"
  | "missing-composer-readiness"
  | "missing-dom-readiness"
  | "missing-browser-total-memory"
  | "mixed-browser-versions"
  | "unpaired-observer-report"
  | "unexpected-observer-report"
  | "observer-browser-mismatch"
  | "observer-timing-mismatch"
  | "observer-totals-incomplete"
  | "observer-path-breakdown-incomplete"
  | "orphan-observer-report";

export type BenchmarkWarning = {
  code: BenchmarkWarningCode;
  severity: "warning" | "error";
  cohortKey: string | null;
  runIds: string[];
  expectedCount: number | null;
  actualCount: number | null;
};

export type BenchmarkCohortSummary = {
  key: string;
  mode: BenchmarkMode;
  navigation: BenchmarkNavigation;
  expectedRunCount: number;
  runCount: number;
  usableRunCount: number;
  failedRunCount: number;
  browserVersions: string[];
  metrics: {
    domContentLoadedMs: DistributionSummary | null;
    composerReadyMs: DistributionSummary | null;
    browserTotalPeakBytes: DistributionSummary | null;
    totalBytesObserved: DistributionSummary | null;
  };
  observerIntegrity: {
    linkedReportCount: number;
    totalsCompleteReportCount: number;
    pathBreakdownCompleteReportCount: number;
  };
  comparisonEligible: boolean;
  warningCodes: BenchmarkWarningCode[];
};

export type BenchmarkMetricDelta = {
  baselineMedian: number;
  targetMedian: number;
  absoluteDelta: number;
  percentDelta: number | null;
};

export type BenchmarkCohortComparison = {
  baselineKey: string;
  targetKey: string;
  navigation: BenchmarkNavigation;
  metrics: {
    domContentLoadedMs: BenchmarkMetricDelta | null;
    composerReadyMs: BenchmarkMetricDelta | null;
    browserTotalPeakBytes: BenchmarkMetricDelta | null;
    totalBytesObserved: BenchmarkMetricDelta | null;
  };
};

export type BenchmarkMatrixSummary = {
  schemaVersion: 1;
  baselineMode: BenchmarkMode;
  manifestCount: number;
  observationReportCount: number;
  cohorts: BenchmarkCohortSummary[];
  comparisons: BenchmarkCohortComparison[];
  warnings: BenchmarkWarning[];
};

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const MODES: readonly BenchmarkMode[] = ["edge-stock", "firefox-stock", "firefox-observe"];
const NAVIGATIONS: readonly BenchmarkNavigation[] = ["cold-open", "hard-reload", "client-navigation"];
const OUTCOMES: readonly BenchmarkOutcomeStatus[] = ["usable", "failed", "cancelled"];
const FAILURE_CODES: readonly BenchmarkFailureCode[] = [
  "browser-crash",
  "navigation-error",
  "composer-unavailable",
  "timeout",
  "operator-cancelled",
];
const MEMORY_METHODS: readonly BenchmarkMemoryMethod[] = ["activity-monitor", "task-manager", "ps"];
const PROCESS_CLASSES: readonly BenchmarkProcessClass[] = [
  "browser-total",
  "browser-main",
  "content-total",
  "content-peak",
  "gpu",
  "extension",
];
const REQUIRED_NAVIGATIONS: readonly BenchmarkNavigation[] = ["cold-open", "hard-reload"];

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: readonly string[], path: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new TypeError(`${path} contains unsupported fields: ${extras.sort().join(", ")}.`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) throw new TypeError(`${path} is missing fields: ${missing.join(", ")}.`);
}

function enumeration<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${path} has an unsupported value.`);
  }
  return value as T;
}

function dateString(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO-compatible date string.`);
  }
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be null or a finite non-negative number.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return value;
}

function exactFalse(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false.`);
  return false;
}

function expectedRunCount(navigation: BenchmarkNavigation): number {
  if (navigation === "cold-open") return 5;
  if (navigation === "hard-reload") return 10;
  return 0;
}

function cohortKey(mode: BenchmarkMode, navigation: BenchmarkNavigation): string {
  return `${mode}|${navigation}`;
}

function warning(
  code: BenchmarkWarningCode,
  severity: BenchmarkWarning["severity"],
  key: string | null,
  runIds: readonly string[] = [],
  expected: number | null = null,
  actual: number | null = null,
): BenchmarkWarning {
  return {
    code,
    severity,
    cohortKey: key,
    runIds: [...runIds].sort(),
    expectedCount: expected,
    actualCount: actual,
  };
}

function optionalDistribution(values: readonly (number | null)[]): DistributionSummary | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? summarizeDistribution(present) : null;
}

function closeEnough(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9);
}

function peakFor(manifest: BenchmarkRunManifest, processClass: BenchmarkProcessClass): number | null {
  return manifest.memory?.peaks.find((peak) => peak.processClass === processClass)?.peakBytes ?? null;
}

function delta(baseline: DistributionSummary | null, target: DistributionSummary | null): BenchmarkMetricDelta | null {
  if (!baseline || !target) return null;
  const absoluteDelta = target.median - baseline.median;
  return {
    baselineMedian: baseline.median,
    targetMedian: target.median,
    absoluteDelta,
    percentDelta: baseline.median === 0 ? null : (absoluteDelta / baseline.median) * 100,
  };
}

export function parseBenchmarkRunManifest(input: unknown): BenchmarkRunManifest {
  const root = record(input, "$manifest");
  exactKeys(
    root,
    [
      "schemaVersion",
      "runId",
      "recordedAt",
      "mode",
      "navigation",
      "sequence",
      "browser",
      "timings",
      "memory",
      "outcome",
      "observerReportRunId",
      "privacy",
    ],
    "$manifest",
  );
  if (root.schemaVersion !== BENCHMARK_RUN_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(`$manifest.schemaVersion must be ${BENCHMARK_RUN_MANIFEST_SCHEMA_VERSION}.`);
  }
  if (typeof root.runId !== "string" || !UUID.test(root.runId)) {
    throw new TypeError("$manifest.runId must be a UUID.");
  }
  const mode = enumeration(root.mode, MODES, "$manifest.mode");
  const navigation = enumeration(root.navigation, NAVIGATIONS, "$manifest.navigation");

  const browser = record(root.browser, "$manifest.browser");
  exactKeys(browser, ["name", "version", "profile"], "$manifest.browser");
  const browserName = enumeration(browser.name, ["Edge", "Firefox"] as const, "$manifest.browser.name");
  if (typeof browser.version !== "string" || !VERSION.test(browser.version)) {
    throw new TypeError("$manifest.browser.version must be a bounded version token.");
  }
  if (browser.profile !== "clean-test") throw new TypeError('$manifest.browser.profile must be "clean-test".');
  if ((mode === "edge-stock" && browserName !== "Edge") || (mode !== "edge-stock" && browserName !== "Firefox")) {
    throw new TypeError("$manifest.browser.name does not match mode.");
  }

  const timings = record(root.timings, "$manifest.timings");
  exactKeys(timings, ["source", "domContentLoadedMs", "composerReadyMs"], "$manifest.timings");
  const timingSource = enumeration(timings.source, ["manual", "observer-report"] as const, "$manifest.timings.source");
  const domContentLoadedMs = nullableNumber(timings.domContentLoadedMs, "$manifest.timings.domContentLoadedMs");
  const composerReadyMs = nullableNumber(timings.composerReadyMs, "$manifest.timings.composerReadyMs");

  let memory: BenchmarkRunManifest["memory"] = null;
  if (root.memory !== null) {
    const memoryRecord = record(root.memory, "$manifest.memory");
    exactKeys(memoryRecord, ["method", "peaks"], "$manifest.memory");
    const method = enumeration(memoryRecord.method, MEMORY_METHODS, "$manifest.memory.method");
    if (!Array.isArray(memoryRecord.peaks) || memoryRecord.peaks.length === 0) {
      throw new TypeError("$manifest.memory.peaks must be a non-empty array.");
    }
    const seen = new Set<BenchmarkProcessClass>();
    const peaks = memoryRecord.peaks.map((item, index) => {
      const peak = record(item, `$manifest.memory.peaks[${index}]`);
      exactKeys(peak, ["processClass", "peakBytes"], `$manifest.memory.peaks[${index}]`);
      const processClass = enumeration(
        peak.processClass,
        PROCESS_CLASSES,
        `$manifest.memory.peaks[${index}].processClass`,
      );
      if (seen.has(processClass)) throw new TypeError(`Duplicate memory process class: ${processClass}.`);
      seen.add(processClass);
      return {
        processClass,
        peakBytes: positiveInteger(peak.peakBytes, `$manifest.memory.peaks[${index}].peakBytes`),
      };
    });
    memory = { method, peaks: peaks.sort((left, right) => left.processClass.localeCompare(right.processClass)) };
  }

  const outcome = record(root.outcome, "$manifest.outcome");
  exactKeys(outcome, ["status", "failureCode"], "$manifest.outcome");
  const status = enumeration(outcome.status, OUTCOMES, "$manifest.outcome.status");
  const failureCode =
    outcome.failureCode === null
      ? null
      : enumeration(outcome.failureCode, FAILURE_CODES, "$manifest.outcome.failureCode");
  if ((status === "usable" && failureCode !== null) || (status !== "usable" && failureCode === null)) {
    throw new TypeError("$manifest.outcome status and failureCode are inconsistent.");
  }

  let observerReportRunId: string | null = null;
  if (root.observerReportRunId !== null) {
    if (typeof root.observerReportRunId !== "string" || !UUID.test(root.observerReportRunId)) {
      throw new TypeError("$manifest.observerReportRunId must be null or a UUID.");
    }
    observerReportRunId = root.observerReportRunId;
  }
  if (mode === "firefox-observe") {
    if (timingSource !== "observer-report" || observerReportRunId !== root.runId) {
      throw new TypeError("Observe manifests must use their matching observer report for timing.");
    }
  } else if (timingSource !== "manual" || observerReportRunId !== null) {
    throw new TypeError("Stock-browser manifests must use manual timing and no observer report.");
  }

  const privacy = record(root.privacy, "$manifest.privacy");
  exactKeys(
    privacy,
    ["contentCaptured", "urlsCaptured", "notesCaptured", "processCommandLinesCaptured"],
    "$manifest.privacy",
  );

  return {
    schemaVersion: BENCHMARK_RUN_MANIFEST_SCHEMA_VERSION,
    runId: root.runId,
    recordedAt: dateString(root.recordedAt, "$manifest.recordedAt"),
    mode,
    navigation,
    sequence: positiveInteger(root.sequence, "$manifest.sequence"),
    browser: { name: browserName, version: browser.version, profile: "clean-test" },
    timings: { source: timingSource, domContentLoadedMs, composerReadyMs },
    memory,
    outcome: { status, failureCode },
    observerReportRunId,
    privacy: {
      contentCaptured: exactFalse(privacy.contentCaptured, "$manifest.privacy.contentCaptured"),
      urlsCaptured: exactFalse(privacy.urlsCaptured, "$manifest.privacy.urlsCaptured"),
      notesCaptured: exactFalse(privacy.notesCaptured, "$manifest.privacy.notesCaptured"),
      processCommandLinesCaptured: exactFalse(
        privacy.processCommandLinesCaptured,
        "$manifest.privacy.processCommandLinesCaptured",
      ),
    },
  };
}

export function summarizeBenchmarkMatrix(
  manifestInputs: readonly unknown[],
  observationInputs: readonly unknown[],
  baselineMode: BenchmarkMode = "firefox-stock",
): BenchmarkMatrixSummary {
  if (!MODES.includes(baselineMode)) throw new TypeError("Unsupported baseline mode.");
  const manifests = manifestInputs.map(parseBenchmarkRunManifest);
  const manifestIds = new Set<string>();
  const manifestById = new Map<string, BenchmarkRunManifest>();
  const sequenceKeys = new Set<string>();
  for (const manifest of manifests) {
    if (manifestIds.has(manifest.runId)) throw new TypeError(`Duplicate benchmark run id: ${manifest.runId}`);
    manifestIds.add(manifest.runId);
    manifestById.set(manifest.runId, manifest);
    const sequenceKey = `${cohortKey(manifest.mode, manifest.navigation)}|${manifest.sequence}`;
    if (sequenceKeys.has(sequenceKey)) throw new TypeError(`Duplicate benchmark sequence: ${sequenceKey}`);
    sequenceKeys.add(sequenceKey);
  }

  const reports = observationInputs.map(parseObservationReport);
  const reportsById = new Map<string, ObservationReport>();
  for (const report of reports) {
    if (reportsById.has(report.run.id)) throw new TypeError(`Duplicate observation run id: ${report.run.id}`);
    reportsById.set(report.run.id, report);
  }

  const warnings: BenchmarkWarning[] = [];
  const reportForManifest = new Map<string, ObservationReport>();
  for (const manifest of manifests) {
    if (manifest.mode !== "firefox-observe") continue;
    const key = cohortKey(manifest.mode, manifest.navigation);
    const report = reportsById.get(manifest.runId);
    if (!report) {
      warnings.push(warning("unpaired-observer-report", "error", key, [manifest.runId]));
      continue;
    }
    reportForManifest.set(manifest.runId, report);
    if (report.browser.name !== manifest.browser.name || report.browser.version !== manifest.browser.version) {
      warnings.push(warning("observer-browser-mismatch", "error", key, [manifest.runId]));
    }
    if (
      !closeEnough(report.summary.domContentLoadedMs, manifest.timings.domContentLoadedMs) ||
      !closeEnough(report.summary.composerReadyMs, manifest.timings.composerReadyMs)
    ) {
      warnings.push(warning("observer-timing-mismatch", "error", key, [manifest.runId]));
    }
    if (!report.integrity.totalsComplete) {
      warnings.push(warning("observer-totals-incomplete", "error", key, [manifest.runId]));
    }
    if (!report.integrity.pathBreakdownComplete) {
      warnings.push(warning("observer-path-breakdown-incomplete", "warning", key, [manifest.runId]));
    }
  }
  for (const report of reports) {
    const manifest = manifestById.get(report.run.id);
    if (!manifest) {
      warnings.push(warning("orphan-observer-report", "warning", null, [report.run.id]));
    } else if (manifest.mode !== "firefox-observe") {
      warnings.push(
        warning("unexpected-observer-report", "error", cohortKey(manifest.mode, manifest.navigation), [report.run.id]),
      );
    }
  }

  const keys = new Set<string>();
  for (const mode of MODES) {
    for (const navigation of REQUIRED_NAVIGATIONS) keys.add(cohortKey(mode, navigation));
  }
  for (const manifest of manifests) keys.add(cohortKey(manifest.mode, manifest.navigation));

  const cohorts = [...keys]
    .map((key): BenchmarkCohortSummary => {
      const [modeValue, navigationValue] = key.split("|");
      const mode = enumeration(modeValue, MODES, `${key}.mode`);
      const navigation = enumeration(navigationValue, NAVIGATIONS, `${key}.navigation`);
      const group = manifests.filter((manifest) => manifest.mode === mode && manifest.navigation === navigation);
      const expected = expectedRunCount(navigation);
      const usable = group.filter((manifest) => manifest.outcome.status === "usable");
      const failed = group.filter((manifest) => manifest.outcome.status !== "usable");
      const versions = [...new Set(group.map((manifest) => manifest.browser.version))].sort();
      const keyWarnings: BenchmarkWarning[] = [];
      if (expected > 0 && group.length < expected) {
        keyWarnings.push(warning("small-sample", "warning", key, group.map((run) => run.runId), expected, group.length));
      }
      if (failed.length > 0) {
        keyWarnings.push(warning("failed-runs", "error", key, failed.map((run) => run.runId), 0, failed.length));
      }
      const missingComposer = usable.filter((run) => run.timings.composerReadyMs === null);
      if (missingComposer.length > 0) {
        keyWarnings.push(
          warning(
            "missing-composer-readiness",
            "error",
            key,
            missingComposer.map((run) => run.runId),
            usable.length,
            usable.length - missingComposer.length,
          ),
        );
      }
      const missingDom = usable.filter((run) => run.timings.domContentLoadedMs === null);
      if (missingDom.length > 0) {
        keyWarnings.push(
          warning(
            "missing-dom-readiness",
            "warning",
            key,
            missingDom.map((run) => run.runId),
            usable.length,
            usable.length - missingDom.length,
          ),
        );
      }
      const missingMemory = usable.filter((run) => peakFor(run, "browser-total") === null);
      if (missingMemory.length > 0) {
        keyWarnings.push(
          warning(
            "missing-browser-total-memory",
            "warning",
            key,
            missingMemory.map((run) => run.runId),
            usable.length,
            usable.length - missingMemory.length,
          ),
        );
      }
      if (versions.length > 1) {
        keyWarnings.push(warning("mixed-browser-versions", "warning", key, group.map((run) => run.runId)));
      }
      warnings.push(...keyWarnings);

      const linkedReports = group
        .map((manifest) => reportForManifest.get(manifest.runId))
        .filter((report): report is ObservationReport => report !== undefined);
      const criticalWarningCodes = new Set<BenchmarkWarningCode>([
        "small-sample",
        "failed-runs",
        "missing-composer-readiness",
        "mixed-browser-versions",
        "unpaired-observer-report",
        "unexpected-observer-report",
        "observer-browser-mismatch",
        "observer-timing-mismatch",
        "observer-totals-incomplete",
      ]);
      const allWarningsForKey = warnings.filter((item) => item.cohortKey === key);
      const comparisonEligible =
        (expected === 0 || group.length >= expected) &&
        group.length > 0 &&
        allWarningsForKey.every((item) => !criticalWarningCodes.has(item.code));

      return {
        key,
        mode,
        navigation,
        expectedRunCount: expected,
        runCount: group.length,
        usableRunCount: usable.length,
        failedRunCount: failed.length,
        browserVersions: versions,
        metrics: {
          domContentLoadedMs: optionalDistribution(usable.map((run) => run.timings.domContentLoadedMs)),
          composerReadyMs: optionalDistribution(usable.map((run) => run.timings.composerReadyMs)),
          browserTotalPeakBytes: optionalDistribution(usable.map((run) => peakFor(run, "browser-total"))),
          totalBytesObserved: optionalDistribution(linkedReports.map((report) => report.summary.totalBytesObserved)),
        },
        observerIntegrity: {
          linkedReportCount: linkedReports.length,
          totalsCompleteReportCount: linkedReports.filter((report) => report.integrity.totalsComplete).length,
          pathBreakdownCompleteReportCount: linkedReports.filter((report) => report.integrity.pathBreakdownComplete).length,
        },
        comparisonEligible,
        warningCodes: [...new Set(allWarningsForKey.map((item) => item.code))].sort(),
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));

  const comparisons: BenchmarkCohortComparison[] = [];
  for (const navigation of NAVIGATIONS) {
    const baseline = cohorts.find((cohort) => cohort.mode === baselineMode && cohort.navigation === navigation);
    if (!baseline) continue;
    for (const target of cohorts.filter((cohort) => cohort.navigation === navigation && cohort.mode !== baselineMode)) {
      const eligible = baseline.comparisonEligible && target.comparisonEligible;
      comparisons.push({
        baselineKey: baseline.key,
        targetKey: target.key,
        navigation,
        metrics: {
          domContentLoadedMs: eligible ? delta(baseline.metrics.domContentLoadedMs, target.metrics.domContentLoadedMs) : null,
          composerReadyMs: eligible ? delta(baseline.metrics.composerReadyMs, target.metrics.composerReadyMs) : null,
          browserTotalPeakBytes: eligible
            ? delta(baseline.metrics.browserTotalPeakBytes, target.metrics.browserTotalPeakBytes)
            : null,
          totalBytesObserved: eligible ? delta(baseline.metrics.totalBytesObserved, target.metrics.totalBytesObserved) : null,
        },
      });
    }
  }

  const uniqueWarnings = [
    ...new Map(
      warnings.map((item) => [
        [item.code, item.cohortKey, item.runIds.join(","), item.expectedCount, item.actualCount].join("|"),
        item,
      ]),
    ).values(),
  ].sort((left, right) =>
    [left.cohortKey ?? "", left.code, left.runIds.join(",")].join("|").localeCompare(
      [right.cohortKey ?? "", right.code, right.runIds.join(",")].join("|"),
    ),
  );

  return {
    schemaVersion: 1,
    baselineMode,
    manifestCount: manifests.length,
    observationReportCount: reports.length,
    cohorts,
    comparisons,
    warnings: uniqueWarnings,
  };
}
