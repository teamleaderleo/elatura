// SPDX-License-Identifier: MPL-2.0

/**
 * Strict content-free run manifest for issue #116 live application-lane
 * experiments. The contract records logical lane identity separately from
 * replaceable browser projections and accounts for the observation ladder
 * without admitting page content, URLs, credentials, native browser ids, or
 * screenshot bytes.
 */

export const APPLICATION_LANE_RUN_MANIFEST_SCHEMA_VERSION = 1 as const;
export const MAX_APPLICATION_LANE_RESOURCE_SAMPLES = 64;

export const APPLICATION_LANE_TARGET_CLASSES = [
  "conversation",
  "document",
  "timeline",
  "console",
  "notebook",
  "other",
] as const;
export type ApplicationLaneTargetClass =
  (typeof APPLICATION_LANE_TARGET_CLASSES)[number];

export const APPLICATION_LANE_BROWSER_CLASSES = [
  "gecko",
  "chromium",
  "webkit",
] as const;
export type ApplicationLaneRunBrowserClass =
  (typeof APPLICATION_LANE_BROWSER_CLASSES)[number];

export const APPLICATION_LANE_COHORTS = ["stock", "elatura"] as const;
export type ApplicationLaneRunCohort = (typeof APPLICATION_LANE_COHORTS)[number];

export const APPLICATION_LANE_INTERVENTION_LEVELS = [
  "stock-observe",
  "lifecycle-managed",
  "render-suppression",
  "bounded-dom",
  "bounded-representation",
  "response-transform",
] as const;
export type ApplicationLaneInterventionLevel =
  (typeof APPLICATION_LANE_INTERVENTION_LEVELS)[number];

export const APPLICATION_LANE_RESOURCE_PHASES = [
  "idle",
  "streaming-or-editing",
  "switch",
  "inspection",
  "recovery",
] as const;
export type ApplicationLaneResourcePhase =
  (typeof APPLICATION_LANE_RESOURCE_PHASES)[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const OPAQUE_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._:-]{0,127}$/u;
const CLASS_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u;
const VERSION_TOKEN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;

export type ApplicationLaneResourceSampleInput = {
  phase: string;
  browserProcessBytes: number | null;
  rendererProcessBytes: number | null;
  cpuMillis: number | null;
  domElements: number | null;
  textNodes: number | null;
  mountedApplicationUnits: number | null;
  elaturaRetainedBytes: number;
};

export type ParsedApplicationLaneResourceSample = Readonly<{
  phase: ApplicationLaneResourcePhase;
  browserProcessBytes: number | null;
  rendererProcessBytes: number | null;
  cpuMillis: number | null;
  domElements: number | null;
  textNodes: number | null;
  mountedApplicationUnits: number | null;
  elaturaRetainedBytes: number;
}>;

export type ParsedApplicationLaneRunManifest = Readonly<{
  schemaVersion: typeof APPLICATION_LANE_RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  recordedAt: string;
  lane: Readonly<{
    laneKey: string;
    applicationClass: string;
    targetClass: ApplicationLaneTargetClass;
    targetTokenPresent: boolean;
  }>;
  environment: Readonly<{
    browserClass: ApplicationLaneRunBrowserClass;
    browserVersionToken: string;
    cohort: ApplicationLaneRunCohort;
    interventionLevel: ApplicationLaneInterventionLevel;
  }>;
  projection: Readonly<{
    bindings: number;
    replacements: number;
    losses: number;
    recoveries: number;
    unrecoveredLosses: number;
    maxConcurrentProjections: number;
  }>;
  attention: Readonly<{
    episodes: number;
    highestRung: Readonly<{
      signalOnly: number;
      boundedSemantic: number;
      screenshot: number;
      fullActivation: number;
    }>;
    operations: Readonly<{
      signals: number;
      boundedSemanticReads: number;
      screenshots: number;
      fullActivations: number;
    }>;
    falsePositiveSignals: number;
    missedChanges: number;
  }>;
  timingsMs: Readonly<{
    initialUsableMs: number | null;
    switchBackMs: number | null;
    recoveryMs: number | null;
    boundedReadMs: number | null;
    screenshotMs: number | null;
    activationMs: number | null;
  }>;
  resources: Readonly<{
    samples: readonly ParsedApplicationLaneResourceSample[];
  }>;
  fidelity: Readonly<{
    authoritativeApplicationPreserved: true;
    normalInteractionAvailable: boolean;
    currentWorkStatePreserved: boolean;
    recoveryFailures: number;
    driftFailOpenCount: number;
  }>;
  privacy: Readonly<{
    contentCaptured: false;
    urlsCaptured: false;
    credentialsCaptured: false;
    nativeBrowserIdsCaptured: false;
    screenshotBytesCaptured: false;
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
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
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

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative finite number or null.`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be boolean.`);
  }
  return value;
}

function fixedFalse(value: unknown, path: string): false {
  if (value !== false) {
    throw new TypeError(`${path} must be exactly false.`);
  }
  return false;
}

function fixedTrue(value: unknown, path: string): true {
  if (value !== true) {
    throw new TypeError(`${path} must be exactly true.`);
  }
  return true;
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

function token(value: unknown, pattern: RegExp, path: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${path} must be a bounded token.`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${path} must be a UUID.`);
  }
  return value.toLowerCase();
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !CANONICAL_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(
      `${path} must be a canonical ISO-8601 UTC timestamp with millisecond precision.`,
    );
  }
  return value;
}

function parseResourceSample(
  input: unknown,
  path: string,
): ParsedApplicationLaneResourceSample {
  const sample = record(input, path);
  exactKeys(
    sample,
    [
      "phase",
      "browserProcessBytes",
      "rendererProcessBytes",
      "cpuMillis",
      "domElements",
      "textNodes",
      "mountedApplicationUnits",
      "elaturaRetainedBytes",
    ],
    path,
  );
  return Object.freeze({
    phase: enumeration(sample.phase, APPLICATION_LANE_RESOURCE_PHASES, `${path}.phase`),
    browserProcessBytes: sample.browserProcessBytes === null
      ? null
      : integer(sample.browserProcessBytes, `${path}.browserProcessBytes`),
    rendererProcessBytes: sample.rendererProcessBytes === null
      ? null
      : integer(sample.rendererProcessBytes, `${path}.rendererProcessBytes`),
    cpuMillis: nullableNumber(sample.cpuMillis, `${path}.cpuMillis`),
    domElements: sample.domElements === null
      ? null
      : integer(sample.domElements, `${path}.domElements`),
    textNodes: sample.textNodes === null
      ? null
      : integer(sample.textNodes, `${path}.textNodes`),
    mountedApplicationUnits: sample.mountedApplicationUnits === null
      ? null
      : integer(sample.mountedApplicationUnits, `${path}.mountedApplicationUnits`),
    elaturaRetainedBytes: integer(
      sample.elaturaRetainedBytes,
      `${path}.elaturaRetainedBytes`,
    ),
  });
}

export function parseApplicationLaneRunManifest(
  input: unknown,
): ParsedApplicationLaneRunManifest {
  const root = record(input, "$");
  exactKeys(
    root,
    [
      "schemaVersion",
      "runId",
      "recordedAt",
      "lane",
      "environment",
      "projection",
      "attention",
      "timingsMs",
      "resources",
      "fidelity",
      "privacy",
    ],
    "$",
  );
  integer(root.schemaVersion, "$.schemaVersion", 1, 1);

  const lane = record(root.lane, "$.lane");
  exactKeys(
    lane,
    ["laneKey", "applicationClass", "targetClass", "targetTokenPresent"],
    "$.lane",
  );

  const environment = record(root.environment, "$.environment");
  exactKeys(
    environment,
    ["browserClass", "browserVersionToken", "cohort", "interventionLevel"],
    "$.environment",
  );
  const cohort = enumeration(
    environment.cohort,
    APPLICATION_LANE_COHORTS,
    "$.environment.cohort",
  );
  const interventionLevel = enumeration(
    environment.interventionLevel,
    APPLICATION_LANE_INTERVENTION_LEVELS,
    "$.environment.interventionLevel",
  );
  if (cohort === "stock" && interventionLevel !== "stock-observe") {
    throw new TypeError(
      "$.environment.interventionLevel must be stock-observe for the stock cohort.",
    );
  }
  if (cohort === "elatura" && interventionLevel === "stock-observe") {
    throw new TypeError(
      "$.environment.interventionLevel must identify an Elatura intervention for the elatura cohort.",
    );
  }

  const projection = record(root.projection, "$.projection");
  exactKeys(
    projection,
    [
      "bindings",
      "replacements",
      "losses",
      "recoveries",
      "unrecoveredLosses",
      "maxConcurrentProjections",
    ],
    "$.projection",
  );
  const bindings = integer(projection.bindings, "$.projection.bindings");
  const replacements = integer(projection.replacements, "$.projection.replacements");
  const losses = integer(projection.losses, "$.projection.losses");
  const recoveries = integer(projection.recoveries, "$.projection.recoveries");
  const unrecoveredLosses = integer(
    projection.unrecoveredLosses,
    "$.projection.unrecoveredLosses",
  );
  const maxConcurrentProjections = integer(
    projection.maxConcurrentProjections,
    "$.projection.maxConcurrentProjections",
    0,
    32,
  );
  if (bindings === 0 && replacements !== 0) {
    throw new TypeError("$.projection.replacements requires at least one binding.");
  }
  if (replacements > Math.max(0, bindings - 1)) {
    throw new TypeError("$.projection.replacements cannot exceed bindings minus one.");
  }
  if (recoveries + unrecoveredLosses > losses) {
    throw new TypeError(
      "$.projection recoveries plus unrecoveredLosses cannot exceed losses.",
    );
  }

  const attention = record(root.attention, "$.attention");
  exactKeys(
    attention,
    [
      "episodes",
      "highestRung",
      "operations",
      "falsePositiveSignals",
      "missedChanges",
    ],
    "$.attention",
  );
  const episodes = integer(attention.episodes, "$.attention.episodes");
  const highestRung = record(attention.highestRung, "$.attention.highestRung");
  exactKeys(
    highestRung,
    ["signalOnly", "boundedSemantic", "screenshot", "fullActivation"],
    "$.attention.highestRung",
  );
  const signalOnly = integer(
    highestRung.signalOnly,
    "$.attention.highestRung.signalOnly",
  );
  const boundedSemantic = integer(
    highestRung.boundedSemantic,
    "$.attention.highestRung.boundedSemantic",
  );
  const screenshot = integer(
    highestRung.screenshot,
    "$.attention.highestRung.screenshot",
  );
  const fullActivation = integer(
    highestRung.fullActivation,
    "$.attention.highestRung.fullActivation",
  );
  if (signalOnly + boundedSemantic + screenshot + fullActivation !== episodes) {
    throw new TypeError(
      "$.attention.highestRung counts must sum exactly to $.attention.episodes.",
    );
  }

  const operations = record(attention.operations, "$.attention.operations");
  exactKeys(
    operations,
    ["signals", "boundedSemanticReads", "screenshots", "fullActivations"],
    "$.attention.operations",
  );
  const signals = integer(operations.signals, "$.attention.operations.signals");
  const boundedSemanticReads = integer(
    operations.boundedSemanticReads,
    "$.attention.operations.boundedSemanticReads",
  );
  const screenshots = integer(
    operations.screenshots,
    "$.attention.operations.screenshots",
  );
  const fullActivations = integer(
    operations.fullActivations,
    "$.attention.operations.fullActivations",
  );
  if (
    signalOnly > signals ||
    boundedSemantic > boundedSemanticReads ||
    screenshot > screenshots ||
    fullActivation > fullActivations
  ) {
    throw new TypeError(
      "$.attention highest-rung episode counts cannot exceed matching operation counts.",
    );
  }

  const timingsMs = record(root.timingsMs, "$.timingsMs");
  exactKeys(
    timingsMs,
    [
      "initialUsableMs",
      "switchBackMs",
      "recoveryMs",
      "boundedReadMs",
      "screenshotMs",
      "activationMs",
    ],
    "$.timingsMs",
  );

  const resources = record(root.resources, "$.resources");
  exactKeys(resources, ["samples"], "$.resources");
  if (!Array.isArray(resources.samples)) {
    throw new TypeError("$.resources.samples must be an array.");
  }
  if (resources.samples.length > MAX_APPLICATION_LANE_RESOURCE_SAMPLES) {
    throw new TypeError(
      `$.resources.samples must contain at most ${MAX_APPLICATION_LANE_RESOURCE_SAMPLES} samples.`,
    );
  }
  const samples = resources.samples.map((sample, index) =>
    parseResourceSample(sample, `$.resources.samples[${index}]`),
  );

  const fidelity = record(root.fidelity, "$.fidelity");
  exactKeys(
    fidelity,
    [
      "authoritativeApplicationPreserved",
      "normalInteractionAvailable",
      "currentWorkStatePreserved",
      "recoveryFailures",
      "driftFailOpenCount",
    ],
    "$.fidelity",
  );

  const privacy = record(root.privacy, "$.privacy");
  exactKeys(
    privacy,
    [
      "contentCaptured",
      "urlsCaptured",
      "credentialsCaptured",
      "nativeBrowserIdsCaptured",
      "screenshotBytesCaptured",
    ],
    "$.privacy",
  );

  return Object.freeze({
    schemaVersion: APPLICATION_LANE_RUN_MANIFEST_SCHEMA_VERSION,
    runId: uuid(root.runId, "$.runId"),
    recordedAt: canonicalTimestamp(root.recordedAt, "$.recordedAt"),
    lane: Object.freeze({
      laneKey: token(lane.laneKey, OPAQUE_TOKEN, "$.lane.laneKey"),
      applicationClass: token(
        lane.applicationClass,
        CLASS_TOKEN,
        "$.lane.applicationClass",
      ),
      targetClass: enumeration(
        lane.targetClass,
        APPLICATION_LANE_TARGET_CLASSES,
        "$.lane.targetClass",
      ),
      targetTokenPresent: boolean(
        lane.targetTokenPresent,
        "$.lane.targetTokenPresent",
      ),
    }),
    environment: Object.freeze({
      browserClass: enumeration(
        environment.browserClass,
        APPLICATION_LANE_BROWSER_CLASSES,
        "$.environment.browserClass",
      ),
      browserVersionToken: token(
        environment.browserVersionToken,
        VERSION_TOKEN,
        "$.environment.browserVersionToken",
      ),
      cohort,
      interventionLevel,
    }),
    projection: Object.freeze({
      bindings,
      replacements,
      losses,
      recoveries,
      unrecoveredLosses,
      maxConcurrentProjections,
    }),
    attention: Object.freeze({
      episodes,
      highestRung: Object.freeze({
        signalOnly,
        boundedSemantic,
        screenshot,
        fullActivation,
      }),
      operations: Object.freeze({
        signals,
        boundedSemanticReads,
        screenshots,
        fullActivations,
      }),
      falsePositiveSignals: integer(
        attention.falsePositiveSignals,
        "$.attention.falsePositiveSignals",
      ),
      missedChanges: integer(attention.missedChanges, "$.attention.missedChanges"),
    }),
    timingsMs: Object.freeze({
      initialUsableMs: nullableNumber(
        timingsMs.initialUsableMs,
        "$.timingsMs.initialUsableMs",
      ),
      switchBackMs: nullableNumber(timingsMs.switchBackMs, "$.timingsMs.switchBackMs"),
      recoveryMs: nullableNumber(timingsMs.recoveryMs, "$.timingsMs.recoveryMs"),
      boundedReadMs: nullableNumber(
        timingsMs.boundedReadMs,
        "$.timingsMs.boundedReadMs",
      ),
      screenshotMs: nullableNumber(timingsMs.screenshotMs, "$.timingsMs.screenshotMs"),
      activationMs: nullableNumber(timingsMs.activationMs, "$.timingsMs.activationMs"),
    }),
    resources: Object.freeze({ samples: Object.freeze(samples) }),
    fidelity: Object.freeze({
      authoritativeApplicationPreserved: fixedTrue(
        fidelity.authoritativeApplicationPreserved,
        "$.fidelity.authoritativeApplicationPreserved",
      ),
      normalInteractionAvailable: boolean(
        fidelity.normalInteractionAvailable,
        "$.fidelity.normalInteractionAvailable",
      ),
      currentWorkStatePreserved: boolean(
        fidelity.currentWorkStatePreserved,
        "$.fidelity.currentWorkStatePreserved",
      ),
      recoveryFailures: integer(
        fidelity.recoveryFailures,
        "$.fidelity.recoveryFailures",
      ),
      driftFailOpenCount: integer(
        fidelity.driftFailOpenCount,
        "$.fidelity.driftFailOpenCount",
      ),
    }),
    privacy: Object.freeze({
      contentCaptured: fixedFalse(privacy.contentCaptured, "$.privacy.contentCaptured"),
      urlsCaptured: fixedFalse(privacy.urlsCaptured, "$.privacy.urlsCaptured"),
      credentialsCaptured: fixedFalse(
        privacy.credentialsCaptured,
        "$.privacy.credentialsCaptured",
      ),
      nativeBrowserIdsCaptured: fixedFalse(
        privacy.nativeBrowserIdsCaptured,
        "$.privacy.nativeBrowserIdsCaptured",
      ),
      screenshotBytesCaptured: fixedFalse(
        privacy.screenshotBytesCaptured,
        "$.privacy.screenshotBytesCaptured",
      ),
    }),
  });
}
