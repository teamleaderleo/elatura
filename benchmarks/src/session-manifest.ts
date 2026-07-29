// SPDX-License-Identifier: MPL-2.0
import {
  parseBenchmarkRunManifest as parseLegacyBenchmarkRunManifest,
  type BenchmarkRunManifest,
} from "./benchmark-legacy.js";

export const BENCHMARK_SESSION_RUN_MANIFEST_SCHEMA_VERSION = 3 as const;

export type BenchmarkSessionManifestBinding = {
  planSchemaVersion: number;
  sessionId: string;
  planGeneratedAt: string;
  slotOrdinal: number;
  slotKey: string;
};

export type SessionBoundBenchmarkRunManifest = Omit<BenchmarkRunManifest, "schemaVersion"> & {
  schemaVersion: typeof BENCHMARK_SESSION_RUN_MANIFEST_SCHEMA_VERSION;
  session: BenchmarkSessionManifestBinding;
};

export type ParsedSessionBoundBenchmarkRunManifest = {
  manifest: BenchmarkRunManifest;
  binding: BenchmarkSessionManifestBinding;
};

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const ROOT_KEYS = [
  "schemaVersion",
  "session",
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
] as const;

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

function canonicalDate(value: unknown, path: string): string {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(
      `${path} must be a canonical ISO-8601 UTC timestamp with millisecond precision.`,
    );
  }
  if (new Date(value).toISOString() !== value) {
    throw new TypeError(
      `${path} must be a canonical ISO-8601 UTC timestamp with millisecond precision.`,
    );
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError(`${path} must be a UUID.`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return value;
}

function legacyInput(root: JsonRecord): JsonRecord {
  return {
    schemaVersion: 2,
    runId: root.runId,
    recordedAt: root.recordedAt,
    mode: root.mode,
    navigation: root.navigation,
    sequence: root.sequence,
    browser: root.browser,
    timings: root.timings,
    memory: root.memory,
    outcome: root.outcome,
    observerReportRunId: root.observerReportRunId,
    privacy: root.privacy,
  };
}

function parseCanonicalLegacyBenchmarkRunManifest(input: unknown): BenchmarkRunManifest {
  const parsed = parseLegacyBenchmarkRunManifest(input);
  canonicalDate(parsed.recordedAt, "$manifest.recordedAt");
  return parsed;
}

export function parseSessionBoundBenchmarkRunManifest(
  input: unknown,
): ParsedSessionBoundBenchmarkRunManifest {
  const root = record(input, "$manifest");
  if (root.schemaVersion !== BENCHMARK_SESSION_RUN_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(
      `$manifest.schemaVersion must be ${BENCHMARK_SESSION_RUN_MANIFEST_SCHEMA_VERSION} for session readiness.`,
    );
  }
  exactKeys(root, ROOT_KEYS, "$manifest");

  const session = record(root.session, "$manifest.session");
  exactKeys(
    session,
    ["planSchemaVersion", "sessionId", "planGeneratedAt", "slotOrdinal", "slotKey"],
    "$manifest.session",
  );
  const binding: BenchmarkSessionManifestBinding = {
    planSchemaVersion: positiveInteger(
      session.planSchemaVersion,
      "$manifest.session.planSchemaVersion",
    ),
    sessionId: uuid(session.sessionId, "$manifest.session.sessionId"),
    planGeneratedAt: canonicalDate(
      session.planGeneratedAt,
      "$manifest.session.planGeneratedAt",
    ),
    slotOrdinal: positiveInteger(session.slotOrdinal, "$manifest.session.slotOrdinal"),
    slotKey:
      typeof session.slotKey === "string" && session.slotKey.length > 0 && session.slotKey.length <= 128
        ? session.slotKey
        : (() => {
            throw new TypeError("$manifest.session.slotKey must be a bounded non-empty string.");
          })(),
  };

  const manifest = parseCanonicalLegacyBenchmarkRunManifest(legacyInput(root));
  const expectedSlotKey = `${manifest.mode}|${manifest.navigation}|${manifest.sequence}`;
  if (binding.slotKey !== expectedSlotKey) {
    throw new TypeError("$manifest.session.slotKey does not match mode, navigation, and sequence.");
  }
  return { manifest, binding };
}

export function parseAnyBenchmarkRunManifest(input: unknown): BenchmarkRunManifest {
  const root = record(input, "$manifest");
  if (root.schemaVersion === BENCHMARK_SESSION_RUN_MANIFEST_SCHEMA_VERSION) {
    return parseSessionBoundBenchmarkRunManifest(input).manifest;
  }
  return parseCanonicalLegacyBenchmarkRunManifest(input);
}
