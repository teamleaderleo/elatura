// SPDX-License-Identifier: MPL-2.0
import { assertContentFreeReport } from "./report.js";

export type ObservationReportSchemaVersion = 2 | 3;

export type ObservationRequestPath = {
  pathTemplate: string;
  count: number;
  bytes: number;
  durationMs: number;
  maxDurationMs: number;
  errors: number;
  methods: string[];
  resourceTypes: string[];
};

export type ObservationReport = {
  schemaVersion: ObservationReportSchemaVersion;
  generatedAt: string;
  mode: "observe";
  run: { id: string; startedAt: string; exportedAt: string };
  extension: { version: string };
  browser: { name: string; vendor: string; version: string; buildID: string };
  privacy: {
    responseBodiesCaptured: false;
    messageTextCaptured: false;
    queryStringsCaptured: false;
    credentialsCaptured: false;
    pathsRedacted: true;
  };
  integrity: {
    totalsComplete: boolean;
    pathBreakdownComplete: boolean;
    pathClassLimit: number;
    pathClassOverflowed: boolean;
    overflowRequestCount: number;
    persistenceErrorCount: number;
    captureInterruptionCount: number;
    activeRequestLimit: number;
    activeRequestCount: number;
    unobservedRequestCount: number;
    bodySizeWarningThresholdBytes: number;
    oversizedResponseCount: number;
  };
  summary: {
    requestCount: number;
    totalBytesObserved: number;
    totalRequestDurationMs: number;
    requestErrorCount: number;
    domContentLoadedMs: number | null;
    composerReadyMs: number | null;
  };
  requestPaths: ObservationRequestPath[];
};

export type DistributionSummary = {
  sampleCount: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
};

export type ObservationGroupSummary = {
  key: string;
  mode: "observe";
  browser: { name: string; version: string };
  extensionVersion: string;
  reportCount: number;
  metrics: {
    requestCount: DistributionSummary;
    totalBytesObserved: DistributionSummary;
    totalRequestDurationMs: DistributionSummary;
    requestErrorCount: DistributionSummary;
    domContentLoadedMs: DistributionSummary | null;
    composerReadyMs: DistributionSummary | null;
  };
  integrity: {
    totalsCompleteReportCount: number;
    pathBreakdownCompleteReportCount: number;
    overflowRequestCount: number;
    persistenceErrorCount: number;
    captureInterruptionCount: number;
    activeRequestCount: number;
    unobservedRequestCount: number;
    oversizedResponseCount: number;
  };
  requestPaths: Array<{
    pathTemplate: string;
    reportCount: number;
    requestCount: number;
    totalBytes: number;
    totalDurationMs: number;
    maxDurationMs: number;
    errors: number;
    methods: string[];
    resourceTypes: string[];
  }>;
};

export type ObservationBatchSummary = {
  schemaVersion: 2;
  reportCount: number;
  groups: ObservationGroupSummary[];
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${path} must be a non-empty string.`);
  return value;
}

function dateString(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (Number.isNaN(Date.parse(parsed))) throw new TypeError(`${path} must be an ISO-compatible date string.`);
  return parsed;
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a finite non-negative number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path);
  if (!Number.isInteger(parsed)) throw new TypeError(`${path} must be an integer.`);
  return parsed;
}

function nullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : nonNegativeNumber(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const parsed = value.map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new TypeError(`${path} must not contain duplicates.`);
  return [...parsed].sort();
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean.`);
  return value;
}

function exactBoolean(value: unknown, expected: boolean, path: string): boolean {
  const parsed = boolean(value, path);
  if (parsed !== expected) throw new TypeError(`${path} must be ${String(expected)}.`);
  return expected;
}

function optionalNonNegativeInteger(value: unknown, path: string): number {
  return value === undefined ? 0 : nonNegativeInteger(value, path);
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9);
}

const SEGMENT_CLASS =
  /^:(?:uuid|invalid-url|elatura-overflow|path-overflow|empty|(?:number|hex|compound|word|token|file|encoded|segment)-(?:s|m|l|xl))$/;

function validLegacyPathTemplate(pathTemplate: string): boolean {
  return (
    pathTemplate.startsWith("/") &&
    !pathTemplate.includes("?") &&
    !pathTemplate.includes("#") &&
    !pathTemplate.includes("://")
  );
}

function validSegmentClassPathTemplate(pathTemplate: string): boolean {
  if (pathTemplate === "/") return true;
  if (!validLegacyPathTemplate(pathTemplate)) return false;
  return pathTemplate
    .slice(1)
    .split("/")
    .every((segment) => SEGMENT_CLASS.test(segment));
}

function reportSchemaVersion(value: unknown): ObservationReportSchemaVersion {
  if (value !== 2 && value !== 3) throw new TypeError("$report.schemaVersion must be 2 or 3.");
  return value;
}

export function parseObservationReport(input: unknown): ObservationReport {
  assertContentFreeReport(input);
  const root = record(input, "$report");
  const schemaVersion = reportSchemaVersion(root.schemaVersion);
  if (root.mode !== "observe") throw new TypeError('$report.mode must be "observe".');

  const run = record(root.run, "$report.run");
  const extension = record(root.extension, "$report.extension");
  const browser = record(root.browser, "$report.browser");
  const privacy = record(root.privacy, "$report.privacy");
  const summary = record(root.summary, "$report.summary");
  const integrity = record(root.integrity, "$report.integrity");

  exactBoolean(privacy.responseBodiesCaptured, false, "$report.privacy.responseBodiesCaptured");
  exactBoolean(privacy.messageTextCaptured, false, "$report.privacy.messageTextCaptured");
  exactBoolean(privacy.queryStringsCaptured, false, "$report.privacy.queryStringsCaptured");
  exactBoolean(privacy.credentialsCaptured, false, "$report.privacy.credentialsCaptured");
  exactBoolean(privacy.pathsRedacted, true, "$report.privacy.pathsRedacted");

  const parsedIntegrity = {
    totalsComplete: boolean(integrity.totalsComplete, "$report.integrity.totalsComplete"),
    pathBreakdownComplete: boolean(integrity.pathBreakdownComplete, "$report.integrity.pathBreakdownComplete"),
    pathClassLimit: nonNegativeInteger(integrity.pathClassLimit, "$report.integrity.pathClassLimit"),
    pathClassOverflowed: boolean(integrity.pathClassOverflowed, "$report.integrity.pathClassOverflowed"),
    overflowRequestCount: nonNegativeInteger(integrity.overflowRequestCount, "$report.integrity.overflowRequestCount"),
    persistenceErrorCount: nonNegativeInteger(integrity.persistenceErrorCount, "$report.integrity.persistenceErrorCount"),
    captureInterruptionCount:
      schemaVersion === 2 && integrity.captureInterruptionCount === undefined
        ? 0
        : nonNegativeInteger(
            integrity.captureInterruptionCount,
            "$report.integrity.captureInterruptionCount",
          ),
    activeRequestLimit: optionalNonNegativeInteger(
      integrity.activeRequestLimit,
      "$report.integrity.activeRequestLimit",
    ),
    activeRequestCount: optionalNonNegativeInteger(
      integrity.activeRequestCount,
      "$report.integrity.activeRequestCount",
    ),
    unobservedRequestCount: optionalNonNegativeInteger(
      integrity.unobservedRequestCount,
      "$report.integrity.unobservedRequestCount",
    ),
    bodySizeWarningThresholdBytes: optionalNonNegativeInteger(
      integrity.bodySizeWarningThresholdBytes,
      "$report.integrity.bodySizeWarningThresholdBytes",
    ),
    oversizedResponseCount: optionalNonNegativeInteger(
      integrity.oversizedResponseCount,
      "$report.integrity.oversizedResponseCount",
    ),
  };
  if (parsedIntegrity.pathClassLimit < 1) {
    throw new TypeError("$report.integrity.pathClassLimit must be positive.");
  }
  if (
    parsedIntegrity.activeRequestLimit === 0 &&
    (parsedIntegrity.activeRequestCount > 0 || parsedIntegrity.unobservedRequestCount > 0)
  ) {
    throw new TypeError("Active request integrity counters require an activeRequestLimit.");
  }
  if (
    parsedIntegrity.activeRequestLimit > 0 &&
    parsedIntegrity.activeRequestCount > parsedIntegrity.activeRequestLimit
  ) {
    throw new TypeError("activeRequestCount cannot exceed activeRequestLimit.");
  }
  if (parsedIntegrity.bodySizeWarningThresholdBytes === 0 && parsedIntegrity.oversizedResponseCount > 0) {
    throw new TypeError("Oversized response counts require a body-size warning threshold.");
  }
  if (
    parsedIntegrity.totalsComplete &&
    (parsedIntegrity.persistenceErrorCount > 0 ||
      parsedIntegrity.captureInterruptionCount > 0 ||
      parsedIntegrity.activeRequestCount > 0 ||
      parsedIntegrity.unobservedRequestCount > 0)
  ) {
    throw new TypeError(
      "A report with persistence errors, capture interruptions, active requests, or unobserved requests cannot claim complete totals.",
    );
  }
  if (!parsedIntegrity.pathClassOverflowed && parsedIntegrity.overflowRequestCount > 0) {
    throw new TypeError("Overflow requests require pathClassOverflowed=true.");
  }
  if (
    parsedIntegrity.pathBreakdownComplete &&
    (!parsedIntegrity.totalsComplete || parsedIntegrity.pathClassOverflowed)
  ) {
    throw new TypeError("Complete path breakdown requires complete totals and no path overflow.");
  }

  if (!Array.isArray(root.requestPaths)) throw new TypeError("$report.requestPaths must be an array.");
  const seenPaths = new Set<string>();
  const requestPaths = root.requestPaths.map((item, index): ObservationRequestPath => {
    const path = record(item, `$report.requestPaths[${index}]`);
    const pathTemplate = string(path.pathTemplate, `$report.requestPaths[${index}].pathTemplate`);
    const pathValid =
      schemaVersion === 3
        ? validSegmentClassPathTemplate(pathTemplate)
        : validLegacyPathTemplate(pathTemplate);
    if (!pathValid) {
      throw new TypeError(
        schemaVersion === 3
          ? `$report.requestPaths[${index}].pathTemplate must contain only content-independent segment classes.`
          : `$report.requestPaths[${index}].pathTemplate must be a redacted path without host or query.`,
      );
    }
    if (seenPaths.has(pathTemplate)) throw new TypeError(`Duplicate path template: ${pathTemplate}`);
    seenPaths.add(pathTemplate);
    const count = nonNegativeInteger(path.count, `$report.requestPaths[${index}].count`);
    const bytes = nonNegativeInteger(path.bytes, `$report.requestPaths[${index}].bytes`);
    const durationMs = nonNegativeNumber(path.durationMs, `$report.requestPaths[${index}].durationMs`);
    const maxDurationMs = nonNegativeNumber(path.maxDurationMs, `$report.requestPaths[${index}].maxDurationMs`);
    const errors = nonNegativeInteger(path.errors, `$report.requestPaths[${index}].errors`);
    if (errors > count) throw new TypeError(`$report.requestPaths[${index}].errors cannot exceed count.`);
    if (count === 0 && (bytes > 0 || durationMs > 0 || maxDurationMs > 0 || errors > 0)) {
      throw new TypeError(`$report.requestPaths[${index}] has totals without requests.`);
    }
    if (maxDurationMs > durationMs && count > 0) {
      throw new TypeError(`$report.requestPaths[${index}].maxDurationMs cannot exceed durationMs.`);
    }
    return {
      pathTemplate,
      count,
      bytes,
      durationMs,
      maxDurationMs,
      errors,
      methods: stringArray(path.methods, `$report.requestPaths[${index}].methods`),
      resourceTypes: stringArray(path.resourceTypes, `$report.requestPaths[${index}].resourceTypes`),
    };
  });

  const parsedSummary = {
    requestCount: nonNegativeInteger(summary.requestCount, "$report.summary.requestCount"),
    totalBytesObserved: nonNegativeInteger(summary.totalBytesObserved, "$report.summary.totalBytesObserved"),
    totalRequestDurationMs: nonNegativeNumber(summary.totalRequestDurationMs, "$report.summary.totalRequestDurationMs"),
    requestErrorCount: nonNegativeInteger(summary.requestErrorCount, "$report.summary.requestErrorCount"),
    domContentLoadedMs: nullableNumber(summary.domContentLoadedMs, "$report.summary.domContentLoadedMs"),
    composerReadyMs: nullableNumber(summary.composerReadyMs, "$report.summary.composerReadyMs"),
  };
  if (parsedIntegrity.oversizedResponseCount > parsedSummary.requestCount) {
    throw new TypeError("oversizedResponseCount cannot exceed requestCount.");
  }

  const reconciled = requestPaths.reduce(
    (totals, path) => ({
      count: totals.count + path.count,
      bytes: totals.bytes + path.bytes,
      durationMs: totals.durationMs + path.durationMs,
      errors: totals.errors + path.errors,
    }),
    { count: 0, bytes: 0, durationMs: 0, errors: 0 },
  );
  if (parsedSummary.requestCount !== reconciled.count) throw new TypeError("Summary requestCount does not reconcile.");
  if (parsedSummary.totalBytesObserved !== reconciled.bytes) throw new TypeError("Summary totalBytesObserved does not reconcile.");
  if (!closeEnough(parsedSummary.totalRequestDurationMs, reconciled.durationMs)) {
    throw new TypeError("Summary totalRequestDurationMs does not reconcile.");
  }
  if (parsedSummary.requestErrorCount !== reconciled.errors) {
    throw new TypeError("Summary requestErrorCount does not reconcile.");
  }

  const overflowPath = requestPaths.find((path) => path.pathTemplate === "/:elatura-overflow");
  if (parsedIntegrity.pathClassOverflowed) {
    if (!overflowPath || overflowPath.count !== parsedIntegrity.overflowRequestCount) {
      throw new TypeError("Overflow path totals do not reconcile with integrity metadata.");
    }
  } else if (overflowPath || parsedIntegrity.overflowRequestCount !== 0) {
    throw new TypeError("Unexpected overflow path or count.");
  }

  return {
    schemaVersion,
    generatedAt: dateString(root.generatedAt, "$report.generatedAt"),
    mode: "observe",
    run: {
      id: string(run.id, "$report.run.id"),
      startedAt: dateString(run.startedAt, "$report.run.startedAt"),
      exportedAt: dateString(run.exportedAt, "$report.run.exportedAt"),
    },
    extension: { version: string(extension.version, "$report.extension.version") },
    browser: {
      name: string(browser.name, "$report.browser.name"),
      vendor: string(browser.vendor, "$report.browser.vendor"),
      version: string(browser.version, "$report.browser.version"),
      buildID: string(browser.buildID, "$report.browser.buildID"),
    },
    privacy: {
      responseBodiesCaptured: false,
      messageTextCaptured: false,
      queryStringsCaptured: false,
      credentialsCaptured: false,
      pathsRedacted: true,
    },
    integrity: parsedIntegrity,
    summary: parsedSummary,
    requestPaths,
  };
}

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) throw new RangeError("Cannot summarize an empty distribution.");
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
      : (sorted[midpoint] ?? 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    sampleCount: sorted.length,
    min: sorted[0] ?? 0,
    median,
    p95: sorted[p95Index] ?? 0,
    max: sorted.at(-1) ?? 0,
    mean: total / sorted.length,
  };
}

function optionalDistribution(values: readonly (number | null)[]): DistributionSummary | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? summarizeDistribution(present) : null;
}

export function summarizeObservationReports(inputs: readonly unknown[]): ObservationBatchSummary {
  if (inputs.length === 0) throw new RangeError("At least one observation report is required.");
  const reports = inputs.map(parseObservationReport);
  const schemaVersions = new Set(reports.map((report) => report.schemaVersion));
  if (schemaVersions.size > 1) {
    throw new TypeError("Observation report schema versions must be analyzed separately.");
  }

  const runIds = new Set<string>();
  for (const report of reports) {
    if (runIds.has(report.run.id)) throw new TypeError(`Duplicate observation run id: ${report.run.id}`);
    runIds.add(report.run.id);
  }
  const groups = new Map<string, ObservationReport[]>();
  for (const report of reports) {
    const key = [report.mode, report.browser.name, report.browser.version, report.extension.version].join("|");
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }

  const summaries = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]): ObservationGroupSummary => {
      const pathTotals = new Map<
        string,
        {
          reportIds: Set<string>;
          requestCount: number;
          totalBytes: number;
          totalDurationMs: number;
          maxDurationMs: number;
          errors: number;
          methods: Set<string>;
          resourceTypes: Set<string>;
        }
      >();
      for (const report of group) {
        for (const path of report.requestPaths) {
          const totals = pathTotals.get(path.pathTemplate) ?? {
            reportIds: new Set<string>(),
            requestCount: 0,
            totalBytes: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            errors: 0,
            methods: new Set<string>(),
            resourceTypes: new Set<string>(),
          };
          totals.reportIds.add(report.run.id);
          totals.requestCount += path.count;
          totals.totalBytes += path.bytes;
          totals.totalDurationMs += path.durationMs;
          totals.maxDurationMs = Math.max(totals.maxDurationMs, path.maxDurationMs);
          totals.errors += path.errors;
          path.methods.forEach((method) => totals.methods.add(method));
          path.resourceTypes.forEach((resourceType) => totals.resourceTypes.add(resourceType));
          pathTotals.set(path.pathTemplate, totals);
        }
      }
      const first = group[0];
      if (!first) throw new Error("Observation group unexpectedly empty.");
      return {
        key,
        mode: "observe",
        browser: { name: first.browser.name, version: first.browser.version },
        extensionVersion: first.extension.version,
        reportCount: group.length,
        metrics: {
          requestCount: summarizeDistribution(group.map((report) => report.summary.requestCount)),
          totalBytesObserved: summarizeDistribution(group.map((report) => report.summary.totalBytesObserved)),
          totalRequestDurationMs: summarizeDistribution(group.map((report) => report.summary.totalRequestDurationMs)),
          requestErrorCount: summarizeDistribution(group.map((report) => report.summary.requestErrorCount)),
          domContentLoadedMs: optionalDistribution(group.map((report) => report.summary.domContentLoadedMs)),
          composerReadyMs: optionalDistribution(group.map((report) => report.summary.composerReadyMs)),
        },
        integrity: {
          totalsCompleteReportCount: group.filter((report) => report.integrity.totalsComplete).length,
          pathBreakdownCompleteReportCount: group.filter((report) => report.integrity.pathBreakdownComplete).length,
          overflowRequestCount: group.reduce((sum, report) => sum + report.integrity.overflowRequestCount, 0),
          persistenceErrorCount: group.reduce((sum, report) => sum + report.integrity.persistenceErrorCount, 0),
          captureInterruptionCount: group.reduce(
            (sum, report) => sum + report.integrity.captureInterruptionCount,
            0,
          ),
          activeRequestCount: group.reduce((sum, report) => sum + report.integrity.activeRequestCount, 0),
          unobservedRequestCount: group.reduce(
            (sum, report) => sum + report.integrity.unobservedRequestCount,
            0,
          ),
          oversizedResponseCount: group.reduce(
            (sum, report) => sum + report.integrity.oversizedResponseCount,
            0,
          ),
        },
        requestPaths: [...pathTotals.entries()]
          .map(([pathTemplate, totals]) => ({
            pathTemplate,
            reportCount: totals.reportIds.size,
            requestCount: totals.requestCount,
            totalBytes: totals.totalBytes,
            totalDurationMs: totals.totalDurationMs,
            maxDurationMs: totals.maxDurationMs,
            errors: totals.errors,
            methods: [...totals.methods].sort(),
            resourceTypes: [...totals.resourceTypes].sort(),
          }))
          .sort((left, right) => right.totalBytes - left.totalBytes || left.pathTemplate.localeCompare(right.pathTemplate)),
      };
    });

  return { schemaVersion: 2, reportCount: reports.length, groups: summaries };
}
