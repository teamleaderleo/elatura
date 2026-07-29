// SPDX-License-Identifier: MPL-2.0
import {
  summarizeBenchmarkMatrix as summarizeLegacyBenchmarkMatrix,
  type BenchmarkCohortComparison,
  type BenchmarkCohortSummary as LegacyBenchmarkCohortSummary,
  type BenchmarkMatrixSummary as LegacyBenchmarkMatrixSummary,
  type BenchmarkMode,
  type BenchmarkNavigation,
  type BenchmarkRunManifest,
  type BenchmarkWarning as LegacyBenchmarkWarning,
  type BenchmarkWarningCode as LegacyBenchmarkWarningCode,
} from "./benchmark-legacy.js";
import { parseObservationReport, type ObservationReport } from "./observation.js";
import { parseAnyBenchmarkRunManifest } from "./session-manifest.js";

export * from "./benchmark-legacy.js";
export * from "./session-manifest.js";

export type BenchmarkWarningCode =
  | LegacyBenchmarkWarningCode
  | "mixed-observer-extension-versions"
  | "mixed-observer-report-schemas";

export type BenchmarkWarning = Omit<LegacyBenchmarkWarning, "code"> & {
  code: BenchmarkWarningCode;
};

export type BenchmarkCohortSummary = Omit<
  LegacyBenchmarkCohortSummary,
  "expectedRunCount" | "comparisonEligible" | "warningCodes"
> & {
  expectedRunCount: number;
  observerExtensionVersions: string[];
  observerReportSchemaVersions: number[];
  comparisonEligible: boolean;
  warningCodes: BenchmarkWarningCode[];
};

export type BenchmarkMatrixSummary = Omit<
  LegacyBenchmarkMatrixSummary,
  "cohorts" | "comparisons" | "warnings"
> & {
  cohorts: BenchmarkCohortSummary[];
  comparisons: BenchmarkCohortComparison[];
  warnings: BenchmarkWarning[];
};

const CLIENT_NAVIGATION_MINIMUM = 5;

function cohortKey(mode: BenchmarkMode, navigation: BenchmarkNavigation): string {
  return `${mode}|${navigation}`;
}

function expectedRunCount(navigation: BenchmarkNavigation): number {
  if (navigation === "cold-open") return 5;
  if (navigation === "hard-reload") return 10;
  return CLIENT_NAVIGATION_MINIMUM;
}

function warning(
  code: BenchmarkWarningCode,
  severity: BenchmarkWarning["severity"],
  key: string,
  runIds: readonly string[],
  expectedCount: number | null = null,
  actualCount: number | null = null,
): BenchmarkWarning {
  return {
    code,
    severity,
    cohortKey: key,
    runIds: [...runIds].sort(),
    expectedCount,
    actualCount,
  };
}

function uniqueWarnings(warnings: readonly BenchmarkWarning[]): BenchmarkWarning[] {
  return [
    ...new Map(
      warnings.map((item) => [
        [item.code, item.cohortKey ?? "", item.runIds.join(","), item.expectedCount, item.actualCount].join("|"),
        item,
      ]),
    ).values(),
  ].sort((left, right) =>
    [left.cohortKey ?? "", left.code, left.runIds.join(",")].join("|").localeCompare(
      [right.cohortKey ?? "", right.code, right.runIds.join(",")].join("|"),
    ),
  );
}

export function parseBenchmarkRunManifest(input: unknown): BenchmarkRunManifest {
  return parseAnyBenchmarkRunManifest(input);
}

export function summarizeBenchmarkMatrix(
  manifestInputs: readonly unknown[],
  observationInputs: readonly unknown[],
  baselineMode: BenchmarkMode = "firefox-stock",
): BenchmarkMatrixSummary {
  const manifests = manifestInputs.map(parseBenchmarkRunManifest);
  const reports = observationInputs.map(parseObservationReport);
  const legacy = summarizeLegacyBenchmarkMatrix(manifests, reports, baselineMode);
  const reportsById = new Map<string, ObservationReport>(
    reports.map((report) => [report.run.id, report]),
  );
  const warnings: BenchmarkWarning[] = legacy.warnings.map((item) => ({ ...item }));

  const cohorts = legacy.cohorts.map((legacyCohort): BenchmarkCohortSummary => {
    const group = manifests.filter(
      (manifest) =>
        manifest.mode === legacyCohort.mode && manifest.navigation === legacyCohort.navigation,
    );
    const linkedReports =
      legacyCohort.mode === "firefox-observe"
        ? group
            .map((manifest) => reportsById.get(manifest.runId))
            .filter((report): report is ObservationReport => report !== undefined)
        : [];
    const observerExtensionVersions = [
      ...new Set(linkedReports.map((report) => report.extension.version)),
    ].sort();
    const observerReportSchemaVersions = [
      ...new Set(linkedReports.map((report) => report.schemaVersion)),
    ].sort((left, right) => left - right);
    const expected = expectedRunCount(legacyCohort.navigation);
    const key = cohortKey(legacyCohort.mode, legacyCohort.navigation);
    const addedWarnings: BenchmarkWarning[] = [];

    if (
      legacyCohort.navigation === "client-navigation" &&
      group.length > 0 &&
      group.length < CLIENT_NAVIGATION_MINIMUM
    ) {
      addedWarnings.push(
        warning(
          "small-sample",
          "warning",
          key,
          group.map((manifest) => manifest.runId),
          CLIENT_NAVIGATION_MINIMUM,
          group.length,
        ),
      );
    }
    if (observerExtensionVersions.length > 1) {
      addedWarnings.push(
        warning(
          "mixed-observer-extension-versions",
          "error",
          key,
          linkedReports.map((report) => report.run.id),
          1,
          observerExtensionVersions.length,
        ),
      );
    }
    if (observerReportSchemaVersions.length > 1) {
      addedWarnings.push(
        warning(
          "mixed-observer-report-schemas",
          "error",
          key,
          linkedReports.map((report) => report.run.id),
          1,
          observerReportSchemaVersions.length,
        ),
      );
    }
    warnings.push(...addedWarnings);

    const mixedObserverImplementation =
      observerExtensionVersions.length > 1 || observerReportSchemaVersions.length > 1;
    const comparisonEligible =
      legacyCohort.comparisonEligible &&
      group.length >= expected &&
      !mixedObserverImplementation;
    const warningCodes = [
      ...new Set<BenchmarkWarningCode>([
        ...legacyCohort.warningCodes,
        ...addedWarnings.map((item) => item.code),
      ]),
    ].sort();

    return {
      ...legacyCohort,
      expectedRunCount: expected,
      observerExtensionVersions,
      observerReportSchemaVersions,
      comparisonEligible,
      warningCodes,
    };
  });

  const cohortByKey = new Map(cohorts.map((cohort) => [cohort.key, cohort]));
  const comparisons = legacy.comparisons.map((comparison): BenchmarkCohortComparison => {
    const baseline = cohortByKey.get(comparison.baselineKey);
    const target = cohortByKey.get(comparison.targetKey);
    if (baseline?.comparisonEligible && target?.comparisonEligible) return comparison;
    return {
      ...comparison,
      metrics: {
        domContentLoadedMs: null,
        composerReadyMs: null,
        browserTotalPeakBytes: null,
        totalBytesObserved: null,
      },
    };
  });

  return {
    ...legacy,
    cohorts,
    comparisons,
    warnings: uniqueWarnings(warnings),
  };
}
