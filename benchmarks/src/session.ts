// SPDX-License-Identifier: MPL-2.0
import {
  parseBenchmarkRunManifest,
  summarizeBenchmarkMatrix,
  type BenchmarkMemoryMethod,
  type BenchmarkMode,
  type BenchmarkNavigation,
  type BenchmarkRunManifest,
} from "./benchmark.js";
import {
  parseObservationReport,
  type ObservationReportSchemaVersion,
} from "./observation.js";

export const BENCHMARK_SESSION_PLAN_SCHEMA_VERSION = 1 as const;
export const BENCHMARK_SESSION_READINESS_SCHEMA_VERSION = 1 as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MODES = ["edge-stock", "firefox-stock", "firefox-observe"] as const;
const NAVIGATIONS = ["cold-open", "hard-reload", "client-navigation"] as const;
const MEMORY_METHODS = ["activity-monitor", "task-manager", "ps"] as const;

export type BenchmarkSessionSlot = {
  ordinal: number;
  key: string;
  mode: BenchmarkMode;
  navigation: BenchmarkNavigation;
  sequence: number;
  browserName: "Edge" | "Firefox";
  browserVersion: string;
  timingSource: "manual" | "observer-report";
  observerReportRequired: boolean;
};

export type BenchmarkSessionPlan = {
  schemaVersion: typeof BENCHMARK_SESSION_PLAN_SCHEMA_VERSION;
  sessionId: string;
  generatedAt: string;
  browserVersions: { edge: string; firefox: string };
  observer: {
    extensionVersion: string;
    reportSchemaVersion: ObservationReportSchemaVersion;
  };
  memoryMethod: BenchmarkMemoryMethod;
  sampleCounts: Record<BenchmarkNavigation, number>;
  privacy: {
    contentCaptured: false;
    urlsCaptured: false;
    notesCaptured: false;
    processCommandLinesCaptured: false;
  };
  slots: BenchmarkSessionSlot[];
};

export type BenchmarkSessionPlanOptions = {
  sessionId: string;
  generatedAt: string;
  edgeVersion: string;
  firefoxVersion: string;
  observerExtensionVersion: string;
  observerReportSchemaVersion: ObservationReportSchemaVersion;
  memoryMethod: BenchmarkMemoryMethod;
  includeClientNavigation?: boolean;
};

export type BenchmarkSessionIssueCode =
  | "missing-run"
  | "unexpected-run"
  | "browser-version-mismatch"
  | "memory-method-mismatch"
  | "observer-report-missing"
  | "observer-extension-version-mismatch"
  | "observer-report-schema-mismatch"
  | "matrix-warning"
  | "comparison-ineligible";

export type BenchmarkSessionIssue = {
  code: BenchmarkSessionIssueCode;
  slotKey: string | null;
  cohortKey: string | null;
  warningCode: string | null;
};

export type BenchmarkSessionReadiness = {
  schemaVersion: typeof BENCHMARK_SESSION_READINESS_SCHEMA_VERSION;
  sessionId: string;
  plannedRunCount: number;
  manifestCount: number;
  observationReportCount: number;
  presentPlannedRunCount: number;
  missingRunCount: number;
  unexpectedRunCount: number;
  ready: boolean;
  issues: BenchmarkSessionIssue[];
};

type JsonRecord = Record<string, unknown>;

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

function token(value: unknown, path: string): string {
  if (typeof value !== "string" || !VERSION.test(value)) {
    throw new TypeError(`${path} must be a bounded version token.`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError(`${path} must be a UUID.`);
  return value;
}

function canonicalDate(value: unknown, path: string): string {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be canonical millisecond-precision UTC.`);
  }
  if (new Date(value).toISOString() !== value) throw new TypeError(`${path} must round-trip canonically.`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return value;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${path} has an unsupported value.`);
  }
  return value as T;
}

function observationSchemaVersion(value: unknown, path: string): ObservationReportSchemaVersion {
  if (value !== 2 && value !== 3) throw new TypeError(`${path} must be 2 or 3.`);
  return value;
}

function exactFalse(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false.`);
  return false;
}

function expectedCount(navigation: BenchmarkNavigation, includeClientNavigation: boolean): number {
  if (navigation === "cold-open") return 5;
  if (navigation === "hard-reload") return 10;
  return includeClientNavigation ? 5 : 0;
}

function slotKey(mode: BenchmarkMode, navigation: BenchmarkNavigation, sequence: number): string {
  return `${mode}|${navigation}|${sequence}`;
}

function cohortKey(mode: BenchmarkMode, navigation: BenchmarkNavigation): string {
  return `${mode}|${navigation}`;
}

export function createBenchmarkSessionPlan(options: BenchmarkSessionPlanOptions): BenchmarkSessionPlan {
  const sessionId = uuid(options.sessionId, "$options.sessionId");
  const generatedAt = canonicalDate(options.generatedAt, "$options.generatedAt");
  const edgeVersion = token(options.edgeVersion, "$options.edgeVersion");
  const firefoxVersion = token(options.firefoxVersion, "$options.firefoxVersion");
  const observerExtensionVersion = token(
    options.observerExtensionVersion,
    "$options.observerExtensionVersion",
  );
  const observerReportSchemaVersion = observationSchemaVersion(
    options.observerReportSchemaVersion,
    "$options.observerReportSchemaVersion",
  );
  const memoryMethod = enumeration(options.memoryMethod, MEMORY_METHODS, "$options.memoryMethod");
  const includeClientNavigation = options.includeClientNavigation === true;
  const sampleCounts: Record<BenchmarkNavigation, number> = {
    "cold-open": expectedCount("cold-open", includeClientNavigation),
    "hard-reload": expectedCount("hard-reload", includeClientNavigation),
    "client-navigation": expectedCount("client-navigation", includeClientNavigation),
  };

  const slots: BenchmarkSessionSlot[] = [];
  for (const [navigationIndex, navigation] of NAVIGATIONS.entries()) {
    const count = sampleCounts[navigation];
    for (let sequence = 1; sequence <= count; sequence += 1) {
      const rotation = (navigationIndex + sequence - 1) % MODES.length;
      for (let offset = 0; offset < MODES.length; offset += 1) {
        const mode = MODES[(rotation + offset) % MODES.length]!;
        const observe = mode === "firefox-observe";
        slots.push({
          ordinal: slots.length + 1,
          key: slotKey(mode, navigation, sequence),
          mode,
          navigation,
          sequence,
          browserName: mode === "edge-stock" ? "Edge" : "Firefox",
          browserVersion: mode === "edge-stock" ? edgeVersion : firefoxVersion,
          timingSource: observe ? "observer-report" : "manual",
          observerReportRequired: observe,
        });
      }
    }
  }

  return {
    schemaVersion: BENCHMARK_SESSION_PLAN_SCHEMA_VERSION,
    sessionId,
    generatedAt,
    browserVersions: { edge: edgeVersion, firefox: firefoxVersion },
    observer: {
      extensionVersion: observerExtensionVersion,
      reportSchemaVersion: observerReportSchemaVersion,
    },
    memoryMethod,
    sampleCounts,
    privacy: {
      contentCaptured: false,
      urlsCaptured: false,
      notesCaptured: false,
      processCommandLinesCaptured: false,
    },
    slots,
  };
}

export function parseBenchmarkSessionPlan(input: unknown): BenchmarkSessionPlan {
  const root = record(input, "$plan");
  exactKeys(
    root,
    [
      "schemaVersion",
      "sessionId",
      "generatedAt",
      "browserVersions",
      "observer",
      "memoryMethod",
      "sampleCounts",
      "privacy",
      "slots",
    ],
    "$plan",
  );
  if (root.schemaVersion !== BENCHMARK_SESSION_PLAN_SCHEMA_VERSION) {
    throw new TypeError(`$plan.schemaVersion must be ${BENCHMARK_SESSION_PLAN_SCHEMA_VERSION}.`);
  }

  const browserVersions = record(root.browserVersions, "$plan.browserVersions");
  exactKeys(browserVersions, ["edge", "firefox"], "$plan.browserVersions");
  const observer = record(root.observer, "$plan.observer");
  exactKeys(observer, ["extensionVersion", "reportSchemaVersion"], "$plan.observer");
  const sampleCounts = record(root.sampleCounts, "$plan.sampleCounts");
  exactKeys(sampleCounts, NAVIGATIONS, "$plan.sampleCounts");
  const privacy = record(root.privacy, "$plan.privacy");
  exactKeys(
    privacy,
    ["contentCaptured", "urlsCaptured", "notesCaptured", "processCommandLinesCaptured"],
    "$plan.privacy",
  );

  const coldCount = nonNegativeInteger(sampleCounts["cold-open"], "$plan.sampleCounts.cold-open");
  const hardCount = nonNegativeInteger(sampleCounts["hard-reload"], "$plan.sampleCounts.hard-reload");
  const clientCount = nonNegativeInteger(
    sampleCounts["client-navigation"],
    "$plan.sampleCounts.client-navigation",
  );
  if (coldCount !== 5 || hardCount !== 10 || (clientCount !== 0 && clientCount !== 5)) {
    throw new TypeError("$plan.sampleCounts must be 5 cold, 10 hard reload, and 0 or 5 client navigation runs.");
  }

  exactFalse(privacy.contentCaptured, "$plan.privacy.contentCaptured");
  exactFalse(privacy.urlsCaptured, "$plan.privacy.urlsCaptured");
  exactFalse(privacy.notesCaptured, "$plan.privacy.notesCaptured");
  exactFalse(privacy.processCommandLinesCaptured, "$plan.privacy.processCommandLinesCaptured");

  const canonical = createBenchmarkSessionPlan({
    sessionId: uuid(root.sessionId, "$plan.sessionId"),
    generatedAt: canonicalDate(root.generatedAt, "$plan.generatedAt"),
    edgeVersion: token(browserVersions.edge, "$plan.browserVersions.edge"),
    firefoxVersion: token(browserVersions.firefox, "$plan.browserVersions.firefox"),
    observerExtensionVersion: token(observer.extensionVersion, "$plan.observer.extensionVersion"),
    observerReportSchemaVersion: observationSchemaVersion(
      observer.reportSchemaVersion,
      "$plan.observer.reportSchemaVersion",
    ),
    memoryMethod: enumeration(root.memoryMethod, MEMORY_METHODS, "$plan.memoryMethod"),
    includeClientNavigation: clientCount === 5,
  });

  if (!Array.isArray(root.slots) || root.slots.length !== canonical.slots.length) {
    throw new TypeError(`$plan.slots must contain exactly ${canonical.slots.length} entries.`);
  }
  for (let index = 0; index < canonical.slots.length; index += 1) {
    const actual = record(root.slots[index], `$plan.slots[${index}]`);
    exactKeys(
      actual,
      [
        "ordinal",
        "key",
        "mode",
        "navigation",
        "sequence",
        "browserName",
        "browserVersion",
        "timingSource",
        "observerReportRequired",
      ],
      `$plan.slots[${index}]`,
    );
    const expected = canonical.slots[index]!;
    for (const field of Object.keys(expected) as Array<keyof BenchmarkSessionSlot>) {
      if (actual[field] !== expected[field]) {
        throw new TypeError(`$plan.slots[${index}].${field} does not match the canonical plan.`);
      }
    }
  }
  return canonical;
}

function issueKey(issue: BenchmarkSessionIssue): string {
  return [issue.code, issue.slotKey ?? "", issue.cohortKey ?? "", issue.warningCode ?? ""].join("|");
}

function sortedIssues(issues: readonly BenchmarkSessionIssue[]): BenchmarkSessionIssue[] {
  return [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()].sort((left, right) =>
    issueKey(left).localeCompare(issueKey(right)),
  );
}

function manifestSlotKey(manifest: BenchmarkRunManifest): string {
  return slotKey(manifest.mode, manifest.navigation, manifest.sequence);
}

export function checkBenchmarkSession(
  planInput: unknown,
  manifestInputs: readonly unknown[],
  observationInputs: readonly unknown[],
): BenchmarkSessionReadiness {
  const plan = parseBenchmarkSessionPlan(planInput);
  const manifests = manifestInputs.map(parseBenchmarkRunManifest);
  const observations = observationInputs.map(parseObservationReport);
  const summary = summarizeBenchmarkMatrix(manifestInputs, observationInputs, "firefox-stock");
  const issues: BenchmarkSessionIssue[] = [];
  const expectedByKey = new Map(plan.slots.map((slot) => [slot.key, slot]));
  const manifestByKey = new Map(manifests.map((manifest) => [manifestSlotKey(manifest), manifest]));
  const observationByRunId = new Map(observations.map((report) => [report.run.id, report]));

  for (const slot of plan.slots) {
    const manifest = manifestByKey.get(slot.key);
    if (!manifest) {
      issues.push({ code: "missing-run", slotKey: slot.key, cohortKey: cohortKey(slot.mode, slot.navigation), warningCode: null });
      continue;
    }
    if (manifest.browser.version !== slot.browserVersion) {
      issues.push({ code: "browser-version-mismatch", slotKey: slot.key, cohortKey: cohortKey(slot.mode, slot.navigation), warningCode: null });
    }
    if (manifest.memory?.method !== plan.memoryMethod) {
      issues.push({ code: "memory-method-mismatch", slotKey: slot.key, cohortKey: cohortKey(slot.mode, slot.navigation), warningCode: null });
    }
    if (slot.observerReportRequired) {
      const report = observationByRunId.get(manifest.runId);
      if (!report) {
        issues.push({ code: "observer-report-missing", slotKey: slot.key, cohortKey: cohortKey(slot.mode, slot.navigation), warningCode: null });
      } else {
        if (report.extension.version !== plan.observer.extensionVersion) {
          issues.push({ code: "observer-extension-version-mismatch", slotKey: slot.key, cohortKey: cohortKey(slot.mode, slot.navigation), warningCode: null });
        }
        if (report.schemaVersion !== plan.observer.reportSchemaVersion) {
          issues.push({ code: "observer-report-schema-mismatch", slotKey: slot.key, cohortKey: cohortKey(slot.mode, slot.navigation), warningCode: null });
        }
      }
    }
  }

  for (const manifest of manifests) {
    const key = manifestSlotKey(manifest);
    if (!expectedByKey.has(key)) {
      issues.push({ code: "unexpected-run", slotKey: key, cohortKey: cohortKey(manifest.mode, manifest.navigation), warningCode: null });
    }
  }

  for (const warning of summary.warnings) {
    issues.push({
      code: "matrix-warning",
      slotKey: null,
      cohortKey: warning.cohortKey,
      warningCode: warning.code,
    });
  }

  const plannedCohorts = new Set(plan.slots.map((slot) => cohortKey(slot.mode, slot.navigation)));
  for (const cohort of summary.cohorts) {
    if (plannedCohorts.has(cohort.key) && !cohort.comparisonEligible) {
      issues.push({ code: "comparison-ineligible", slotKey: null, cohortKey: cohort.key, warningCode: null });
    }
  }

  const normalizedIssues = sortedIssues(issues);
  const missingRunCount = normalizedIssues.filter((issue) => issue.code === "missing-run").length;
  const unexpectedRunCount = normalizedIssues.filter((issue) => issue.code === "unexpected-run").length;
  return {
    schemaVersion: BENCHMARK_SESSION_READINESS_SCHEMA_VERSION,
    sessionId: plan.sessionId,
    plannedRunCount: plan.slots.length,
    manifestCount: manifests.length,
    observationReportCount: observations.length,
    presentPlannedRunCount: plan.slots.length - missingRunCount,
    missingRunCount,
    unexpectedRunCount,
    ready: normalizedIssues.length === 0,
    issues: normalizedIssues,
  };
}
