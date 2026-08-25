// SPDX-License-Identifier: MPL-2.0

/**
 * Fixed-schema parser, validator, and plateau evaluator for content-free
 * synthetic companion browser run manifests (schema version 1).
 *
 * The module is deliberately self-contained: it accepts bounded numbers,
 * fixed enums/tokens, UUIDs, and canonical UTC timestamps only. Any field
 * that could carry conversation content — ids beyond the fixed fixture enum,
 * URLs, snippets, titles, notes — has no place in the schema and therefore
 * cannot pass validation.
 *
 * The plateau rule matches `evaluateWorkingSetPlateau` in
 * packages/companion-web/src/plateau.ts: both share the canonical
 * `MINIMUM_PLATEAU_SAMPLES` (6) sample floor, every tracked counter must stay
 * within its hard bound, and the second half of each probe's samples must
 * never exceed the first half. Monotonic retained-state trends fail with a
 * fixed code instead of being narrated away.
 *
 * `probes.*.cycles` records the number of completed probe repetitions that
 * produced the attached samples. One cycle yields at most two samples (the
 * working set before and after one repeated action), so the parser refuses a
 * sample array longer than twice the declared cycles: such a manifest would
 * misattest its own provenance.
 *
 * The prescribed browser probes in packages/companion-web/src/probes.ts bind
 * their exact round/cycle counts to this admission window: a switch probe
 * emits `SWITCH_PROBE_ROUNDS × served conversations` samples (8 for the
 * runbook's single-conversation server) and an open/close probe emits
 * exactly `OPEN_CLOSE_PROBE_CYCLES × 2 = MAX_PROBE_SAMPLES` samples, so the
 * documented procedure is schema-admissible by construction.
 */

export const COMPANION_BROWSER_RUN_MANIFEST_SCHEMA_VERSION = 1 as const;

export const FIXTURE_IDS = [
  "synthetic-100",
  "synthetic-10000",
  "synthetic-100000",
  "branch-heavy",
  "large-code",
] as const;

export type CompanionBrowserFixtureId = (typeof FIXTURE_IDS)[number];

export const OBSERVED_STATE_TOKENS = [
  "fresh",
  "stale",
  "expired",
  "corrupt",
  "drifted",
  "cancelled",
  "over-limit",
] as const;

export type CompanionBrowserObservedState = (typeof OBSERVED_STATE_TOKENS)[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const BOUNDED_REVISION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u;
const BOUNDED_VERSION_TOKEN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;

/**
 * Upper bound on recorded samples per probe, mirrored by the schema's
 * `samples.maxItems` and by MAXIMUM_PROBE_SAMPLES in
 * packages/companion-web/src/probes.ts (the prescribed browser probes derive
 * their emissions from that constant; parity is asserted by test).
 */
export const MAX_PROBE_SAMPLES = 32;
/**
 * Mirrors MINIMUM_PLATEAU_SAMPLES from
 * packages/companion-web/src/plateau.ts (the canonical plateau sample floor).
 * A test in packages/companion-web asserts both constants stay identical.
 */
export const MINIMUM_PROBE_SAMPLES = 6;
/** One probe cycle yields at most two samples (before and after one action). */
const MAX_SAMPLES_PER_CYCLE = 2;
export const MINIMUM_PROBE_CYCLES = 2;

/**
 * Mirrors DEFAULT_PLATEAU_HARD_BOUNDS from
 * packages/companion-web/src/plateau.ts (merged companion defaults). A test in
 * packages/companion-web asserts both tables stay identical.
 */
export const PLATEAU_SAMPLE_FIELDS = [
  "residentConversations",
  "residentRecords",
  "residentEntries",
  "renderedRows",
  "retainedClientRecords",
  "cacheEntries",
  "cacheBytes",
  "artifactBytes",
] as const;

export type PlateauSampleField = (typeof PLATEAU_SAMPLE_FIELDS)[number];

export const PLATEAU_HARD_BOUNDS: Readonly<Record<PlateauSampleField, number>> =
  Object.freeze({
    residentConversations: 3,
    residentRecords: 8,
    residentEntries: 256,
    renderedRows: 50,
    retainedClientRecords: 209,
    cacheEntries: 64,
    cacheBytes: 4_194_304,
    artifactBytes: 2_097_152,
  });

export type CompanionPlateauSampleInput = Readonly<
  Record<PlateauSampleField, number>
>;

export type CompanionBrowserProbe = Readonly<{
  cycles: number;
  samples: readonly CompanionPlateauSampleInput[];
}>;

export type CompanionBrowserRunManifestInput = {
  schemaVersion: number;
  runId: string;
  recordedAt: string;
  fixture: {
    id: string;
    entryCount: number;
    textCodeUnits: number;
    codeBlockCount: number;
  };
  client: { revision: string; protocolVersion: number };
  environment: {
    platformClass: string;
    browserClass: string;
    versionToken: string;
  };
  timingsMs: {
    initialUsableMs: number | null;
    pageOlderMs: number | null;
    pageNewerMs: number | null;
    searchMs: number | null;
  };
  peakProcessBytes: number | null;
  residentCompanion: {
    conversations: number;
    records: number;
    entries: number;
    textCodeUnits: number;
    serializedBytes: number;
  };
  retainedClient: {
    metadataRecords: number;
    timelineEntries: number;
    searchResults: number;
    codeBlocks: number;
    pendingRequests: number;
  };
  renderedSurface: {
    timelineRows: number;
    domNodes: number | null;
    estimatedArtifactBytes: number;
  };
  requestCacheLedger: {
    dispatchedRequests: number;
    completedRequests: number;
    cancelledRequests: number;
    failedRequests: number;
    refusedOverLimitRequests: number;
    cacheEntries: number;
    cacheTotalBytes: number;
  };
  probes: { switchProbe: unknown; openCloseProbe: unknown };
  integrity: {
    observedStates: readonly string[];
    truncatedResponseCount: number;
    overLimitRefusalCount: number;
  };
  privacy: {
    contentCaptured: boolean;
    urlsCaptured: boolean;
    transcriptTextCaptured: boolean;
    screenshotsCaptured: boolean;
  };
};

export type ParsedCompanionProbe = Readonly<{
  cycles: number;
  samples: readonly CompanionPlateauSampleInput[];
}>;

export type ParsedCompanionBrowserRunManifest = Readonly<{
  schemaVersion: typeof COMPANION_BROWSER_RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  recordedAt: string;
  fixture: Readonly<{
    id: CompanionBrowserFixtureId;
    entryCount: number;
    textCodeUnits: number;
    codeBlockCount: number;
  }>;
  client: Readonly<{ revision: string; protocolVersion: 1 }>;
  environment: Readonly<{
    platformClass: "desktop" | "mobile";
    browserClass: "chromium" | "gecko" | "webkit";
    versionToken: string;
  }>;
  timingsMs: Readonly<{
    initialUsableMs: number | null;
    pageOlderMs: number | null;
    pageNewerMs: number | null;
    searchMs: number | null;
  }>;
  peakProcessBytes: number | null;
  residentCompanion: Readonly<{
    conversations: number;
    records: number;
    entries: number;
    textCodeUnits: number;
    serializedBytes: number;
  }>;
  retainedClient: Readonly<{
    metadataRecords: number;
    timelineEntries: number;
    searchResults: number;
    codeBlocks: number;
    pendingRequests: number;
  }>;
  renderedSurface: Readonly<{
    timelineRows: number;
    domNodes: number | null;
    estimatedArtifactBytes: number;
  }>;
  requestCacheLedger: Readonly<{
    dispatchedRequests: number;
    completedRequests: number;
    cancelledRequests: number;
    failedRequests: number;
    refusedOverLimitRequests: number;
    cacheEntries: number;
    cacheTotalBytes: number;
  }>;
  probes: Readonly<{ switchProbe: ParsedCompanionProbe; openCloseProbe: ParsedCompanionProbe }>;
  integrity: Readonly<{
    observedStates: readonly CompanionBrowserObservedState[];
    truncatedResponseCount: number;
    overLimitRefusalCount: number;
  }>;
  privacy: Readonly<{
    contentCaptured: false;
    urlsCaptured: false;
    transcriptTextCaptured: false;
    screenshotsCaptured: false;
  }>;
}>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new TypeError(`${path} contains unsupported fields: ${extras.sort().join(", ")}.`);
  }
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${path} is missing fields: ${missing.join(", ")}.`);
  }
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${path} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  return integer(value, path, 0, Number.MAX_SAFE_INTEGER);
}

function nullableNonNegativeInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return nonNegativeInteger(value, path);
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return integer(value, path, 1, Number.MAX_SAFE_INTEGER);
}

function nullableLatency(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative finite number or null.`);
  }
  return value;
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !CANONICAL_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${path} must be a canonical ISO-8601 UTC timestamp with millisecond precision.`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${path} must be a UUID.`);
  }
  return value.toLowerCase();
}

function parseProbe(input: unknown, path: string): ParsedCompanionProbe {
  const probe = record(input, path);
  exactKeys(probe, ["cycles", "samples"], path);
  const cycles = integer(probe.cycles, `${path}.cycles`, MINIMUM_PROBE_CYCLES, 100_000);
  if (!Array.isArray(probe.samples)) {
    throw new TypeError(`${path}.samples must be an array.`);
  }
  if (probe.samples.length > MAX_PROBE_SAMPLES) {
    throw new TypeError(
      `${path}.samples must contain at most ${MAX_PROBE_SAMPLES} samples.`,
    );
  }
  if (probe.samples.length > cycles * MAX_SAMPLES_PER_CYCLE) {
    throw new TypeError(
      `${path} declares ${cycles} cycles, which cannot have produced ${probe.samples.length} samples (at most ${MAX_SAMPLES_PER_CYCLE} per cycle).`,
    );
  }
  const samples = probe.samples.map((candidate, index) => {
    const sample = record(candidate, `${path}.samples[${index}]`);
    exactKeys(sample, PLATEAU_SAMPLE_FIELDS, `${path}.samples[${index}]`);
    const parsed = {} as Record<PlateauSampleField, number>;
    for (const field of PLATEAU_SAMPLE_FIELDS) {
      parsed[field] = nonNegativeInteger(sample[field], `${path}.samples[${index}].${field}`);
    }
    return Object.freeze(parsed);
  });
  return Object.freeze({ cycles, samples: Object.freeze(samples) });
}

export function parseCompanionBrowserRunManifest(
  input: unknown,
): ParsedCompanionBrowserRunManifest {
  const root = record(input, "$");
  exactKeys(
    root,
    [
      "schemaVersion", "runId", "recordedAt", "fixture", "client", "environment",
      "timingsMs", "peakProcessBytes", "residentCompanion", "retainedClient",
      "renderedSurface", "requestCacheLedger", "probes", "integrity", "privacy",
    ],
    "$",
  );
  integer(root.schemaVersion, "$.schemaVersion", 1, 1);
  const runId = uuid(root.runId, "$.runId");
  const recordedAt = canonicalTimestamp(root.recordedAt, "$.recordedAt");

  const fixture = record(root.fixture, "$.fixture");
  exactKeys(fixture, ["id", "entryCount", "textCodeUnits", "codeBlockCount"], "$.fixture");
  const fixtureId = enumeration(fixture.id, FIXTURE_IDS, "$.fixture.id");
  const fixtureEntryCount = integer(fixture.entryCount, "$.fixture.entryCount", 1, 1_000_000);
  const fixtureTextCodeUnits = integer(fixture.textCodeUnits, "$.fixture.textCodeUnits", 0, 100_000_000);
  const fixtureCodeBlockCount = integer(fixture.codeBlockCount, "$.fixture.codeBlockCount", 0, 10_000);

  const client = record(root.client, "$.client");
  exactKeys(client, ["revision", "protocolVersion"], "$.client");
  if (typeof client.revision !== "string" || !BOUNDED_REVISION.test(client.revision)) {
    throw new TypeError("$.client.revision must be a bounded revision token.");
  }
  integer(client.protocolVersion, "$.client.protocolVersion", 1, 1);

  const environment = record(root.environment, "$.environment");
  exactKeys(environment, ["platformClass", "browserClass", "versionToken"], "$.environment");
  const platformClass = enumeration(environment.platformClass, ["desktop", "mobile"] as const, "$.environment.platformClass");
  const browserClass = enumeration(environment.browserClass, ["chromium", "gecko", "webkit"] as const, "$.environment.browserClass");
  if (
    typeof environment.versionToken !== "string" ||
    !BOUNDED_VERSION_TOKEN.test(environment.versionToken)
  ) {
    throw new TypeError("$.environment.versionToken must be a bounded version token.");
  }

  const timingsMs = record(root.timingsMs, "$.timingsMs");
  exactKeys(timingsMs, ["initialUsableMs", "pageOlderMs", "pageNewerMs", "searchMs"], "$.timingsMs");

  const residentCompanion = record(root.residentCompanion, "$.residentCompanion");
  exactKeys(
    residentCompanion,
    ["conversations", "records", "entries", "textCodeUnits", "serializedBytes"],
    "$.residentCompanion",
  );

  const retainedClient = record(root.retainedClient, "$.retainedClient");
  exactKeys(
    retainedClient,
    ["metadataRecords", "timelineEntries", "searchResults", "codeBlocks", "pendingRequests"],
    "$.retainedClient",
  );

  const renderedSurface = record(root.renderedSurface, "$.renderedSurface");
  exactKeys(renderedSurface, ["timelineRows", "domNodes", "estimatedArtifactBytes"], "$.renderedSurface");

  const requestCacheLedger = record(root.requestCacheLedger, "$.requestCacheLedger");
  exactKeys(
    requestCacheLedger,
    [
      "dispatchedRequests", "completedRequests", "cancelledRequests",
      "failedRequests", "refusedOverLimitRequests", "cacheEntries", "cacheTotalBytes",
    ],
    "$.requestCacheLedger",
  );

  const probes = record(root.probes, "$.probes");
  exactKeys(probes, ["switchProbe", "openCloseProbe"], "$.probes");

  const integrity = record(root.integrity, "$.integrity");
  exactKeys(integrity, ["observedStates", "truncatedResponseCount", "overLimitRefusalCount"], "$.integrity");
  if (!Array.isArray(integrity.observedStates) || integrity.observedStates.length > OBSERVED_STATE_TOKENS.length) {
    throw new TypeError("$.integrity.observedStates must be an array of at most 7 fixed tokens.");
  }
  const observedStates = [...new Set(integrity.observedStates)].map((token, index) =>
    enumeration(token, OBSERVED_STATE_TOKENS, `$.integrity.observedStates[${index}]`),
  );

  const privacy = record(root.privacy, "$.privacy");
  exactKeys(privacy, ["contentCaptured", "urlsCaptured", "transcriptTextCaptured", "screenshotsCaptured"], "$.privacy");
  for (const flag of ["contentCaptured", "urlsCaptured", "transcriptTextCaptured", "screenshotsCaptured"]) {
    if (privacy[flag] !== false) {
      throw new TypeError(`$.privacy.${flag} must be exactly false.`);
    }
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    runId,
    recordedAt,
    fixture: Object.freeze({
      id: fixtureId,
      entryCount: fixtureEntryCount,
      textCodeUnits: fixtureTextCodeUnits,
      codeBlockCount: fixtureCodeBlockCount,
    }),
    client: Object.freeze({
      revision: client.revision,
      protocolVersion: 1 as const,
    }),
    environment: Object.freeze({
      platformClass,
      browserClass,
      versionToken: environment.versionToken,
    }),
    timingsMs: Object.freeze({
      initialUsableMs: nullableLatency(timingsMs.initialUsableMs, "$.timingsMs.initialUsableMs"),
      pageOlderMs: nullableLatency(timingsMs.pageOlderMs, "$.timingsMs.pageOlderMs"),
      pageNewerMs: nullableLatency(timingsMs.pageNewerMs, "$.timingsMs.pageNewerMs"),
      searchMs: nullableLatency(timingsMs.searchMs, "$.timingsMs.searchMs"),
    }),
    peakProcessBytes: nullablePositiveInteger(root.peakProcessBytes, "$.peakProcessBytes"),
    residentCompanion: Object.freeze({
      conversations: nonNegativeInteger(residentCompanion.conversations, "$.residentCompanion.conversations"),
      records: nonNegativeInteger(residentCompanion.records, "$.residentCompanion.records"),
      entries: nonNegativeInteger(residentCompanion.entries, "$.residentCompanion.entries"),
      textCodeUnits: nonNegativeInteger(residentCompanion.textCodeUnits, "$.residentCompanion.textCodeUnits"),
      serializedBytes: nonNegativeInteger(residentCompanion.serializedBytes, "$.residentCompanion.serializedBytes"),
    }),
    retainedClient: Object.freeze({
      metadataRecords: nonNegativeInteger(retainedClient.metadataRecords, "$.retainedClient.metadataRecords"),
      timelineEntries: nonNegativeInteger(retainedClient.timelineEntries, "$.retainedClient.timelineEntries"),
      searchResults: nonNegativeInteger(retainedClient.searchResults, "$.retainedClient.searchResults"),
      codeBlocks: nonNegativeInteger(retainedClient.codeBlocks, "$.retainedClient.codeBlocks"),
      pendingRequests: nonNegativeInteger(retainedClient.pendingRequests, "$.retainedClient.pendingRequests"),
    }),
    renderedSurface: Object.freeze({
      timelineRows: nonNegativeInteger(renderedSurface.timelineRows, "$.renderedSurface.timelineRows"),
      domNodes: nullableNonNegativeInteger(renderedSurface.domNodes, "$.renderedSurface.domNodes"),
      estimatedArtifactBytes: nonNegativeInteger(renderedSurface.estimatedArtifactBytes, "$.renderedSurface.estimatedArtifactBytes"),
    }),
    requestCacheLedger: Object.freeze({
      dispatchedRequests: nonNegativeInteger(requestCacheLedger.dispatchedRequests, "$.requestCacheLedger.dispatchedRequests"),
      completedRequests: nonNegativeInteger(requestCacheLedger.completedRequests, "$.requestCacheLedger.completedRequests"),
      cancelledRequests: nonNegativeInteger(requestCacheLedger.cancelledRequests, "$.requestCacheLedger.cancelledRequests"),
      failedRequests: nonNegativeInteger(requestCacheLedger.failedRequests, "$.requestCacheLedger.failedRequests"),
      refusedOverLimitRequests: nonNegativeInteger(requestCacheLedger.refusedOverLimitRequests, "$.requestCacheLedger.refusedOverLimitRequests"),
      cacheEntries: nonNegativeInteger(requestCacheLedger.cacheEntries, "$.requestCacheLedger.cacheEntries"),
      cacheTotalBytes: nonNegativeInteger(requestCacheLedger.cacheTotalBytes, "$.requestCacheLedger.cacheTotalBytes"),
    }),
    probes: Object.freeze({
      switchProbe: parseProbe(probes.switchProbe, "$.probes.switchProbe"),
      openCloseProbe: parseProbe(probes.openCloseProbe, "$.probes.openCloseProbe"),
    }),
    integrity: Object.freeze({
      observedStates: Object.freeze(observedStates),
      truncatedResponseCount: nonNegativeInteger(integrity.truncatedResponseCount, "$.integrity.truncatedResponseCount"),
      overLimitRefusalCount: nonNegativeInteger(integrity.overLimitRefusalCount, "$.integrity.overLimitRefusalCount"),
    }),
    privacy: Object.freeze({
      contentCaptured: false as const,
      urlsCaptured: false as const,
      transcriptTextCaptured: false as const,
      screenshotsCaptured: false as const,
    }),
  });
}

export type CompanionPlateauVerdictCode =
  | "insufficient-samples"
  | "over-hard-bound"
  | "monotonic-growth";

export type CompanionProbePlateauFailure = Readonly<{
  code: CompanionPlateauVerdictCode;
  probe: "switchProbe" | "openCloseProbe";
  field: string;
}>;

export type CompanionBrowserPlateauVerdict = Readonly<{
  ok: boolean;
  failures: readonly CompanionProbePlateauFailure[];
  firstHalfMaxima: Readonly<Record<PlateauSampleField, number>>;
  secondHalfMaxima: Readonly<Record<PlateauSampleField, number>>;
}>;

function zeroMaxima(): Record<PlateauSampleField, number> {
  return {
    residentConversations: 0,
    residentRecords: 0,
    residentEntries: 0,
    renderedRows: 0,
    retainedClientRecords: 0,
    cacheEntries: 0,
    cacheBytes: 0,
    artifactBytes: 0,
  };
}

function evaluateProbe(
  probeName: "switchProbe" | "openCloseProbe",
  probe: ParsedCompanionProbe,
): { failures: CompanionProbePlateauFailure[]; first: Record<PlateauSampleField, number>; second: Record<PlateauSampleField, number> } {
  const failures: CompanionProbePlateauFailure[] = [];
  if (probe.samples.length < MINIMUM_PROBE_SAMPLES) {
    failures.push(Object.freeze({
      code: "insufficient-samples" as const,
      probe: probeName,
      field: `samples:${probe.samples.length}`,
    }));
    return { failures, first: zeroMaxima(), second: zeroMaxima() };
  }
  const half = Math.floor(probe.samples.length / 2);
  const first = zeroMaxima();
  const second = zeroMaxima();
  for (const sample of probe.samples.slice(0, half)) {
    for (const field of PLATEAU_SAMPLE_FIELDS) {
      if (sample[field] > first[field]) first[field] = sample[field];
    }
  }
  for (const sample of probe.samples.slice(half)) {
    for (const field of PLATEAU_SAMPLE_FIELDS) {
      if (sample[field] > second[field]) second[field] = sample[field];
    }
  }
  for (const sample of probe.samples) {
    for (const field of PLATEAU_SAMPLE_FIELDS) {
      if (sample[field] > PLATEAU_HARD_BOUNDS[field]) {
        failures.push(Object.freeze({
          code: "over-hard-bound" as const,
          probe: probeName,
          field,
        }));
        break;
      }
    }
  }
  for (const field of PLATEAU_SAMPLE_FIELDS) {
    if (second[field] > first[field]) {
      failures.push(Object.freeze({
        code: "monotonic-growth" as const,
        probe: probeName,
        field,
      }));
    }
  }
  return { failures, first, second };
}

/**
 * Evaluates both required probes. A packet passes only when repeated
 * switching AND repeated open/close cycles reach a bounded plateau.
 */
export function evaluateCompanionBrowserPlateau(
  manifest: ParsedCompanionBrowserRunManifest,
): CompanionBrowserPlateauVerdict {
  const switchResult = evaluateProbe("switchProbe", manifest.probes.switchProbe);
  const openCloseResult = evaluateProbe("openCloseProbe", manifest.probes.openCloseProbe);
  const failures = [...switchResult.failures, ...openCloseResult.failures];

  const combinedFirst = zeroMaxima();
  const combinedSecond = zeroMaxima();
  for (const field of PLATEAU_SAMPLE_FIELDS) {
    combinedFirst[field] = Math.max(switchResult.first[field], openCloseResult.first[field]);
    combinedSecond[field] = Math.max(switchResult.second[field], openCloseResult.second[field]);
  }

  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures),
    firstHalfMaxima: Object.freeze(combinedFirst),
    secondHalfMaxima: Object.freeze(combinedSecond),
  });
}
