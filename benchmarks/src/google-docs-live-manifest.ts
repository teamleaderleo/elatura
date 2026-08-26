// SPDX-License-Identifier: MPL-2.0
import {
  applicationLaneEventTypes,
  type ApplicationLaneEventType,
} from "@elatura/core/application-lane";
import {
  applicationLaneBrowserResidencies,
  applicationLaneEligibilityStates,
  applicationLaneLifecycleActions,
  applicationLaneLifecycleBlockers,
  applicationLaneLifecycleReasons,
  applicationLaneRecoveryStates,
  applicationLaneResidencyIntents,
  type ApplicationLaneBrowserResidency,
  type ApplicationLaneEligibilityState,
  type ApplicationLaneLifecycleAction,
  type ApplicationLaneLifecycleBlocker,
  type ApplicationLaneLifecycleReason,
  type ApplicationLaneRecoveryState,
  type ApplicationLaneResidencyIntent,
} from "@elatura/core/application-lane-lifecycle";

/**
 * Strict content-free evidence parser for the Google Docs human-first workload
 * (#118). Browser memory remains raw physical evidence; this parser enforces
 * fixed vocabulary, privacy boundaries, generation-bound lane identity, and
 * coherence with the merged application-lane lifecycle contract.
 */

export const GOOGLE_DOCS_LIVE_RUN_SCHEMA_VERSION = 1 as const;

export const GOOGLE_DOCS_WORKLOADS = [
  "docs-large-text-v1",
  "docs-switch-8-v1",
  "docs-switch-capacity-v1",
] as const;
export type GoogleDocsWorkload = (typeof GOOGLE_DOCS_WORKLOADS)[number];

export const GOOGLE_DOCS_VARIANTS = [
  "stock-resident",
  "stock-memory-saver",
  "stock-explicit-discard",
  "elatura-observe",
  "elatura-suspended",
  "elatura-reclaimable",
] as const;
export type GoogleDocsVariant = (typeof GOOGLE_DOCS_VARIANTS)[number];

export const GOOGLE_DOCS_LANE_EVENT_TYPES = ["none", ...applicationLaneEventTypes] as const;
export type GoogleDocsLaneEventType = "none" | ApplicationLaneEventType;

export const EVENT_CONFIDENCE = ["exact", "probable", "unknown"] as const;
export type EventConfidence = (typeof EVENT_CONFIDENCE)[number];
export const EVENT_FRESHNESS = ["fresh", "stale", "unknown"] as const;
export type EventFreshness = (typeof EVENT_FRESHNESS)[number];

export const AUTOSAVE_STATES = ["saved", "saving", "offline", "unknown"] as const;
export type AutosaveState = (typeof AUTOSAVE_STATES)[number];
export const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];
export const VERDICTS = ["pass", "fail", "unmeasured"] as const;
export type GoogleDocsVerdict = (typeof VERDICTS)[number];
export const REVISIT_INTERVALS = ["rotation", "30s", "2m", "10m", "60m", "unknown"] as const;
export type RevisitInterval = (typeof REVISIT_INTERVALS)[number];
export const BROWSER_ACTIONS = [
  "none",
  "natural-lifecycle",
  "wake",
  "freeze",
  "discard",
  "activate",
  "recover_projection",
] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];
export const PROBE_CLASSES = ["routine", "adversarial"] as const;
export type ProbeClass = (typeof PROBE_CLASSES)[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const VERSION_TOKEN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const LANE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;

const FIDELITY_FIELDS = [
  "documentIdentityContinuity",
  "authenticationContinuity",
  "editCanarySaved",
  "editingModeContinuity",
  "undoRedo",
  "caretContinuity",
  "selectionContinuity",
  "viewportContinuity",
  "autosaveContinuity",
  "commentSuggestionContinuity",
  "collaborationContinuity",
  "permissionsContinuity",
  "findNavigationContinuity",
  "offlineStateTruthful",
] as const;
export type FidelityField = (typeof FIDELITY_FIELDS)[number];

const PRIVACY_FIELDS = [
  "documentTextCaptured",
  "documentTitlesCaptured",
  "urlsCaptured",
  "accountIdsCaptured",
  "collaboratorIdsCaptured",
  "screenshotsCaptured",
  "clipboardCaptured",
  "freeFormNotesCaptured",
] as const;

export type ParsedGoogleDocsLaneState = Readonly<{
  ordinal: number;
  laneRef: string;
  laneGeneration: number;
  requestedIntent: ApplicationLaneResidencyIntent | null;
  browserResidency: ApplicationLaneBrowserResidency;
  recovery: ApplicationLaneRecoveryState;
  freezeEligibility: ApplicationLaneEligibilityState;
  discardEligibility: ApplicationLaneEligibilityState;
  blockers: readonly ApplicationLaneLifecycleBlocker[];
  plannerAction: ApplicationLaneLifecycleAction | null;
  plannerReason: ApplicationLaneLifecycleReason | null;
  latestEventType: GoogleDocsLaneEventType;
  latestEventConfidence: EventConfidence;
  latestEventFreshness: EventFreshness;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
  autosaveState: AutosaveState;
  localEditPending: YesNoUnknown;
  compositionActive: YesNoUnknown;
  selectionPresent: YesNoUnknown;
  transientEditorActive: YesNoUnknown;
  collaborationActive: YesNoUnknown;
  viewportAnchorAvailable: YesNoUnknown;
}>;

export type ParsedGoogleDocsSample = Readonly<{
  sequence: number;
  phase: "initial" | "active" | "background" | "reactivated" | "idle" | "recovery";
  probeClass: ProbeClass;
  revisitIntervalClass: RevisitInterval;
  browserAction: BrowserAction;
  activeDocumentOrdinal: number | null;
  openDocumentTabs: number;
  frozenDocumentTabs: number;
  discardedDocumentTabs: number;
  usefulDocumentCount: number;
  attentionRequiredDocumentCount: number;
  pageTargetCount: number;
  rendererProcessCount: number;
  serviceWorkerProcessCount: number | null;
  browserTreeResidentBytes: number | null;
  docsRendererResidentBytes: number | null;
  gpuResidentBytes: number | null;
  systemAvailableMemoryBytes: number | null;
  swapUsedBytes: number | null;
  majorPageFaultsDelta: number | null;
  jsHeapUsedBytes: number | null;
  domNodes: number | null;
  jsEventListeners: number | null;
  browserTreeCpuSecondsDelta: number | null;
  rendererCpuSecondsDelta: number | null;
  backgroundNetworkBytesDelta: number | null;
  activationToVisibleMs: number | null;
  activationToEditableMs: number | null;
  editEchoMs: number | null;
  saveSettledMs: number | null;
  reloadTransferredBytes: number | null;
  reloadRequestCount: number | null;
  laneStates: readonly ParsedGoogleDocsLaneState[];
}>;

export type ParsedGoogleDocsLiveRunManifest = Readonly<{
  schemaVersion: typeof GOOGLE_DOCS_LIVE_RUN_SCHEMA_VERSION;
  runId: string;
  recordedAt: string;
  workload: GoogleDocsWorkload;
  variant: GoogleDocsVariant;
  requestedDocumentCount: number;
  fixture: Readonly<{
    generator: "google-docs-workload-v1";
    documentCount: number;
    totalTextCodeUnits: number;
    perDocumentTextCodeUnits: readonly number[];
    manifestSha256: string;
  }>;
  environment: Readonly<{
    osClass: "macos" | "windows" | "linux" | "chromeos";
    browserVersionToken: string;
    profileClass: "dedicated-signed-in";
    memorySaver: "off" | "moderate" | "balanced" | "maximum" | "unknown";
    energySaver: "off" | "on" | "unknown";
    instrumentation:
      | "none"
      | "extension-only"
      | "bounded-cdp-lease"
      | "extension-plus-bounded-cdp-lease";
    persistentDebuggerAttached: false;
    hardwareMemoryBytes: number | null;
  }>;
  samples: readonly ParsedGoogleDocsSample[];
  fidelity: Readonly<Record<FidelityField, GoogleDocsVerdict>> & Readonly<{
    unexpectedReloadCount: number;
    operatorVisibleFailureCount: number;
  }>;
  privacy: Readonly<Record<(typeof PRIVACY_FIELDS)[number], false>>;
}>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must use a plain object prototype.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: readonly string[], path: string): void {
  const keys = Object.keys(value);
  const extras = keys.filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new TypeError(`${path} contains unsupported fields: ${extras.sort().join(", ")}.`);
  }
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length > 0) {
    throw new TypeError(`${path} is missing fields: ${missing.join(", ")}.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError(`${path}.${key} must be a data property.`);
    }
  }
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
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

function nullableInteger(value: unknown, path: string, minimum = 0): number | null {
  if (value === null) return null;
  return integer(value, path, minimum, Number.MAX_SAFE_INTEGER);
}

function nullableFinite(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative finite number or null.`);
  }
  return value;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function nullableEnumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T | null {
  if (value === null) return null;
  return enumeration(value, allowed, path);
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !CANONICAL_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${path} must be a canonical UTC timestamp with millisecond precision.`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${path} must be a UUID.`);
  }
  return value.toLowerCase();
}

function laneRef(value: unknown, path: string): string {
  if (typeof value !== "string" || !LANE_REF.test(value)) {
    throw new TypeError(`${path} must be a bounded opaque application-lane reference.`);
  }
  return value;
}

function blockers(value: unknown, path: string): readonly ApplicationLaneLifecycleBlocker[] {
  if (!Array.isArray(value) || value.length > applicationLaneLifecycleBlockers.length) {
    throw new TypeError(`${path} must be a bounded blocker array.`);
  }
  const output = value.map((item, index) =>
    enumeration(item, applicationLaneLifecycleBlockers, `${path}[${index}]`),
  );
  if (new Set(output).size !== output.length) {
    throw new TypeError(`${path} must not contain duplicate blockers.`);
  }
  return Object.freeze(output.slice().sort());
}

function parseLaneState(
  input: unknown,
  path: string,
  requestedDocumentCount: number,
): ParsedGoogleDocsLaneState {
  const lane = record(input, path);
  exactKeys(
    lane,
    [
      "ordinal",
      "laneRef",
      "laneGeneration",
      "requestedIntent",
      "browserResidency",
      "recovery",
      "freezeEligibility",
      "discardEligibility",
      "blockers",
      "plannerAction",
      "plannerReason",
      "latestEventType",
      "latestEventConfidence",
      "latestEventFreshness",
      "grantsWorkAuthority",
      "authorizesWorkDispatch",
      "autosaveState",
      "localEditPending",
      "compositionActive",
      "selectionPresent",
      "transientEditorActive",
      "collaborationActive",
      "viewportAnchorAvailable",
    ],
    path,
  );
  const ordinal = integer(lane.ordinal, `${path}.ordinal`, 0, 9);
  if (ordinal >= requestedDocumentCount) {
    throw new TypeError(`${path}.ordinal must name one of the requested documents.`);
  }
  if (lane.grantsWorkAuthority !== false || lane.authorizesWorkDispatch !== false) {
    throw new TypeError(`${path} must carry zero work authority and zero dispatch authority.`);
  }
  const plannerAction = nullableEnumeration(
    lane.plannerAction,
    applicationLaneLifecycleActions,
    `${path}.plannerAction`,
  );
  const plannerReason = nullableEnumeration(
    lane.plannerReason,
    applicationLaneLifecycleReasons,
    `${path}.plannerReason`,
  );
  if ((plannerAction === null) !== (plannerReason === null)) {
    throw new TypeError(`${path} plannerAction and plannerReason must both be null or both be present.`);
  }

  return Object.freeze({
    ordinal,
    laneRef: laneRef(lane.laneRef, `${path}.laneRef`),
    laneGeneration: integer(lane.laneGeneration, `${path}.laneGeneration`, 1, 100_000),
    requestedIntent: nullableEnumeration(
      lane.requestedIntent,
      applicationLaneResidencyIntents,
      `${path}.requestedIntent`,
    ),
    browserResidency: enumeration(
      lane.browserResidency,
      applicationLaneBrowserResidencies,
      `${path}.browserResidency`,
    ),
    recovery: enumeration(lane.recovery, applicationLaneRecoveryStates, `${path}.recovery`),
    freezeEligibility: enumeration(
      lane.freezeEligibility,
      applicationLaneEligibilityStates,
      `${path}.freezeEligibility`,
    ),
    discardEligibility: enumeration(
      lane.discardEligibility,
      applicationLaneEligibilityStates,
      `${path}.discardEligibility`,
    ),
    blockers: blockers(lane.blockers, `${path}.blockers`),
    plannerAction,
    plannerReason,
    latestEventType: enumeration(
      lane.latestEventType,
      GOOGLE_DOCS_LANE_EVENT_TYPES,
      `${path}.latestEventType`,
    ),
    latestEventConfidence: enumeration(
      lane.latestEventConfidence,
      EVENT_CONFIDENCE,
      `${path}.latestEventConfidence`,
    ),
    latestEventFreshness: enumeration(
      lane.latestEventFreshness,
      EVENT_FRESHNESS,
      `${path}.latestEventFreshness`,
    ),
    grantsWorkAuthority: false as const,
    authorizesWorkDispatch: false as const,
    autosaveState: enumeration(lane.autosaveState, AUTOSAVE_STATES, `${path}.autosaveState`),
    localEditPending: enumeration(lane.localEditPending, YES_NO_UNKNOWN, `${path}.localEditPending`),
    compositionActive: enumeration(lane.compositionActive, YES_NO_UNKNOWN, `${path}.compositionActive`),
    selectionPresent: enumeration(lane.selectionPresent, YES_NO_UNKNOWN, `${path}.selectionPresent`),
    transientEditorActive: enumeration(
      lane.transientEditorActive,
      YES_NO_UNKNOWN,
      `${path}.transientEditorActive`,
    ),
    collaborationActive: enumeration(
      lane.collaborationActive,
      YES_NO_UNKNOWN,
      `${path}.collaborationActive`,
    ),
    viewportAnchorAvailable: enumeration(
      lane.viewportAnchorAvailable,
      YES_NO_UNKNOWN,
      `${path}.viewportAnchorAvailable`,
    ),
  });
}

function parseSample(
  input: unknown,
  index: number,
  requestedDocumentCount: number,
): ParsedGoogleDocsSample {
  const path = `$.samples[${index}]`;
  const sample = record(input, path);
  exactKeys(
    sample,
    [
      "sequence",
      "phase",
      "probeClass",
      "revisitIntervalClass",
      "browserAction",
      "activeDocumentOrdinal",
      "openDocumentTabs",
      "frozenDocumentTabs",
      "discardedDocumentTabs",
      "usefulDocumentCount",
      "attentionRequiredDocumentCount",
      "pageTargetCount",
      "rendererProcessCount",
      "serviceWorkerProcessCount",
      "browserTreeResidentBytes",
      "docsRendererResidentBytes",
      "gpuResidentBytes",
      "systemAvailableMemoryBytes",
      "swapUsedBytes",
      "majorPageFaultsDelta",
      "jsHeapUsedBytes",
      "domNodes",
      "jsEventListeners",
      "browserTreeCpuSecondsDelta",
      "rendererCpuSecondsDelta",
      "backgroundNetworkBytesDelta",
      "activationToVisibleMs",
      "activationToEditableMs",
      "editEchoMs",
      "saveSettledMs",
      "reloadTransferredBytes",
      "reloadRequestCount",
      "laneStates",
    ],
    path,
  );

  const activeDocumentOrdinal = nullableInteger(sample.activeDocumentOrdinal, `${path}.activeDocumentOrdinal`);
  if (activeDocumentOrdinal !== null && activeDocumentOrdinal >= requestedDocumentCount) {
    throw new TypeError(`${path}.activeDocumentOrdinal must name one of the requested documents.`);
  }
  const openDocumentTabs = integer(sample.openDocumentTabs, `${path}.openDocumentTabs`, 0, 10);
  if (openDocumentTabs !== requestedDocumentCount) {
    throw new TypeError(`${path}.openDocumentTabs must equal requestedDocumentCount.`);
  }
  const frozenDocumentTabs = integer(sample.frozenDocumentTabs, `${path}.frozenDocumentTabs`, 0, 10);
  const discardedDocumentTabs = integer(sample.discardedDocumentTabs, `${path}.discardedDocumentTabs`, 0, 10);
  if (frozenDocumentTabs + discardedDocumentTabs > requestedDocumentCount) {
    throw new TypeError(`${path} cannot report more frozen/discarded tabs than requested documents.`);
  }
  const usefulDocumentCount = integer(sample.usefulDocumentCount, `${path}.usefulDocumentCount`, 0, 10);
  const attentionRequiredDocumentCount = integer(
    sample.attentionRequiredDocumentCount,
    `${path}.attentionRequiredDocumentCount`,
    0,
    10,
  );
  if (usefulDocumentCount + attentionRequiredDocumentCount > requestedDocumentCount) {
    throw new TypeError(`${path} useful plus attention-required documents exceed the requested count.`);
  }

  if (!Array.isArray(sample.laneStates)) {
    throw new TypeError(`${path}.laneStates must be an array.`);
  }
  if (sample.laneStates.length !== requestedDocumentCount) {
    throw new TypeError(`${path}.laneStates must contain one state per requested document.`);
  }
  const laneStates = sample.laneStates.map((lane, laneIndex) =>
    parseLaneState(lane, `${path}.laneStates[${laneIndex}]`, requestedDocumentCount),
  );
  const ordinals = laneStates.map((lane) => lane.ordinal);
  if (new Set(ordinals).size !== ordinals.length) {
    throw new TypeError(`${path}.laneStates contains duplicate document ordinals.`);
  }
  const sortedOrdinals = ordinals.slice().sort((left, right) => left - right);
  if (sortedOrdinals.some((value, ordinal) => value !== ordinal)) {
    throw new TypeError(`${path}.laneStates must cover every requested document ordinal exactly once.`);
  }
  const refs = laneStates.map((lane) => lane.laneRef);
  if (new Set(refs).size !== refs.length) {
    throw new TypeError(`${path}.laneStates contains duplicate laneRef values.`);
  }
  const observedFrozen = laneStates.filter((lane) => lane.browserResidency === "frozen").length;
  const observedDiscarded = laneStates.filter((lane) => lane.browserResidency === "discarded").length;
  if (observedFrozen !== frozenDocumentTabs || observedDiscarded !== discardedDocumentTabs) {
    throw new TypeError(`${path} lifecycle counts must match laneStates.`);
  }

  return Object.freeze({
    sequence: integer(sample.sequence, `${path}.sequence`, 0, 100_000),
    phase: enumeration(
      sample.phase,
      ["initial", "active", "background", "reactivated", "idle", "recovery"] as const,
      `${path}.phase`,
    ),
    probeClass: enumeration(sample.probeClass, PROBE_CLASSES, `${path}.probeClass`),
    revisitIntervalClass: enumeration(
      sample.revisitIntervalClass,
      REVISIT_INTERVALS,
      `${path}.revisitIntervalClass`,
    ),
    browserAction: enumeration(sample.browserAction, BROWSER_ACTIONS, `${path}.browserAction`),
    activeDocumentOrdinal,
    openDocumentTabs,
    frozenDocumentTabs,
    discardedDocumentTabs,
    usefulDocumentCount,
    attentionRequiredDocumentCount,
    pageTargetCount: integer(sample.pageTargetCount, `${path}.pageTargetCount`, 0, 1_000),
    rendererProcessCount: integer(sample.rendererProcessCount, `${path}.rendererProcessCount`, 0, 1_000),
    serviceWorkerProcessCount: nullableInteger(sample.serviceWorkerProcessCount, `${path}.serviceWorkerProcessCount`),
    browserTreeResidentBytes: nullableInteger(sample.browserTreeResidentBytes, `${path}.browserTreeResidentBytes`, 1),
    docsRendererResidentBytes: nullableInteger(sample.docsRendererResidentBytes, `${path}.docsRendererResidentBytes`, 1),
    gpuResidentBytes: nullableInteger(sample.gpuResidentBytes, `${path}.gpuResidentBytes`, 1),
    systemAvailableMemoryBytes: nullableInteger(sample.systemAvailableMemoryBytes, `${path}.systemAvailableMemoryBytes`),
    swapUsedBytes: nullableInteger(sample.swapUsedBytes, `${path}.swapUsedBytes`),
    majorPageFaultsDelta: nullableInteger(sample.majorPageFaultsDelta, `${path}.majorPageFaultsDelta`),
    jsHeapUsedBytes: nullableInteger(sample.jsHeapUsedBytes, `${path}.jsHeapUsedBytes`),
    domNodes: nullableInteger(sample.domNodes, `${path}.domNodes`),
    jsEventListeners: nullableInteger(sample.jsEventListeners, `${path}.jsEventListeners`),
    browserTreeCpuSecondsDelta: nullableFinite(sample.browserTreeCpuSecondsDelta, `${path}.browserTreeCpuSecondsDelta`),
    rendererCpuSecondsDelta: nullableFinite(sample.rendererCpuSecondsDelta, `${path}.rendererCpuSecondsDelta`),
    backgroundNetworkBytesDelta: nullableInteger(sample.backgroundNetworkBytesDelta, `${path}.backgroundNetworkBytesDelta`),
    activationToVisibleMs: nullableFinite(sample.activationToVisibleMs, `${path}.activationToVisibleMs`),
    activationToEditableMs: nullableFinite(sample.activationToEditableMs, `${path}.activationToEditableMs`),
    editEchoMs: nullableFinite(sample.editEchoMs, `${path}.editEchoMs`),
    saveSettledMs: nullableFinite(sample.saveSettledMs, `${path}.saveSettledMs`),
    reloadTransferredBytes: nullableInteger(sample.reloadTransferredBytes, `${path}.reloadTransferredBytes`),
    reloadRequestCount: nullableInteger(sample.reloadRequestCount, `${path}.reloadRequestCount`),
    laneStates: Object.freeze(laneStates),
  });
}

function assertLaneIdentityContinuity(
  samples: readonly ParsedGoogleDocsSample[],
  requestedDocumentCount: number,
): void {
  const lastGeneration = new Map<number, number>();
  const refs = new Map<number, string>();
  for (const sample of samples) {
    for (const lane of sample.laneStates) {
      const priorRef = refs.get(lane.ordinal);
      if (priorRef !== undefined && priorRef !== lane.laneRef) {
        throw new TypeError(`Lane reference changed for document ordinal ${lane.ordinal}.`);
      }
      refs.set(lane.ordinal, lane.laneRef);
      const priorGeneration = lastGeneration.get(lane.ordinal);
      if (priorGeneration !== undefined && lane.laneGeneration < priorGeneration) {
        throw new TypeError(`Lane generation regressed for document ordinal ${lane.ordinal}.`);
      }
      lastGeneration.set(lane.ordinal, lane.laneGeneration);
    }
  }
  if (refs.size !== requestedDocumentCount) {
    throw new TypeError("Lane identity coverage does not match requestedDocumentCount.");
  }
}

function assertVariantCoherence(
  variant: GoogleDocsVariant,
  environment: ParsedGoogleDocsLiveRunManifest["environment"],
  samples: readonly ParsedGoogleDocsSample[],
  requestedDocumentCount: number,
): void {
  const stock = variant.startsWith("stock-");
  if (stock && environment.instrumentation !== "none") {
    throw new TypeError("Stock variants must use instrumentation=none.");
  }
  if (variant === "stock-memory-saver") {
    if (!["moderate", "balanced", "maximum"].includes(environment.memorySaver)) {
      throw new TypeError("stock-memory-saver requires an enabled Memory Saver level.");
    }
  } else if (environment.memorySaver !== "off") {
    throw new TypeError("All non-Memory-Saver variants require memorySaver=off.");
  }
  if (
    variant === "elatura-suspended" &&
    !["bounded-cdp-lease", "extension-plus-bounded-cdp-lease"].includes(environment.instrumentation)
  ) {
    throw new TypeError("elatura-suspended requires short-lived CDP instrumentation.");
  }
  if (
    variant === "elatura-observe" &&
    !["extension-only", "bounded-cdp-lease", "extension-plus-bounded-cdp-lease"].includes(environment.instrumentation)
  ) {
    throw new TypeError("elatura-observe requires bounded Elatura instrumentation.");
  }
  if (
    variant === "elatura-reclaimable" &&
    !["extension-only", "extension-plus-bounded-cdp-lease"].includes(environment.instrumentation)
  ) {
    throw new TypeError("elatura-reclaimable requires extension-backed lifecycle facts.");
  }

  for (const sample of samples) {
    for (const lane of sample.laneStates) {
      const plannerPresent = lane.plannerAction !== null;
      if (stock || variant === "elatura-observe") {
        if (lane.requestedIntent !== null || plannerPresent || lane.plannerReason !== null) {
          throw new TypeError(`${variant} must not contain lifecycle planner requests or decisions.`);
        }
      }
    }
  }

  if (requestedDocumentCount === 0) return;

  const browserActions = new Set(samples.map((sample) => sample.browserAction));
  if (variant === "stock-explicit-discard" && !browserActions.has("discard")) {
    throw new TypeError("stock-explicit-discard must contain a discard browser action.");
  }
  if (variant === "elatura-suspended") {
    const decisions = samples.flatMap((sample) => sample.laneStates).filter(
      (lane) => lane.requestedIntent === "suspended" && lane.plannerAction === "freeze",
    );
    if (decisions.length === 0 || !browserActions.has("freeze")) {
      throw new TypeError("elatura-suspended must record a suspended/freeze decision and freeze browser action.");
    }
  }
  if (variant === "elatura-reclaimable") {
    const decisions = samples.flatMap((sample) => sample.laneStates).filter(
      (lane) => lane.requestedIntent === "reclaimable" && lane.plannerAction === "discard",
    );
    if (decisions.length === 0 || !browserActions.has("discard")) {
      throw new TypeError("elatura-reclaimable must record a reclaimable/discard decision and discard browser action.");
    }
  }
  if (
    ["stock-resident", "elatura-observe"].includes(variant) &&
    samples.some((sample) => ["freeze", "discard"].includes(sample.browserAction))
  ) {
    throw new TypeError(`${variant} cannot contain a forced freeze/discard browser action.`);
  }
}

export function parseGoogleDocsLiveRunManifest(input: unknown): ParsedGoogleDocsLiveRunManifest {
  const root = record(input, "$");
  exactKeys(
    root,
    [
      "schemaVersion",
      "runId",
      "recordedAt",
      "workload",
      "variant",
      "requestedDocumentCount",
      "fixture",
      "environment",
      "samples",
      "fidelity",
      "privacy",
    ],
    "$",
  );

  integer(root.schemaVersion, "$.schemaVersion", 1, 1);
  const runId = uuid(root.runId, "$.runId");
  const recordedAt = canonicalTimestamp(root.recordedAt, "$.recordedAt");
  const workload = enumeration(root.workload, GOOGLE_DOCS_WORKLOADS, "$.workload");
  const variant = enumeration(root.variant, GOOGLE_DOCS_VARIANTS, "$.variant");
  const requestedDocumentCount = integer(root.requestedDocumentCount, "$.requestedDocumentCount", 0, 8);

  const fixture = record(root.fixture, "$.fixture");
  exactKeys(
    fixture,
    ["generator", "documentCount", "totalTextCodeUnits", "perDocumentTextCodeUnits", "manifestSha256"],
    "$.fixture",
  );
  if (fixture.generator !== "google-docs-workload-v1") {
    throw new TypeError("$.fixture.generator must be google-docs-workload-v1.");
  }
  const fixtureDocumentCount = integer(fixture.documentCount, "$.fixture.documentCount", 1, 10);
  if (requestedDocumentCount > fixtureDocumentCount) {
    throw new TypeError("$.requestedDocumentCount cannot exceed the generated fixture document count.");
  }
  if (!Array.isArray(fixture.perDocumentTextCodeUnits)) {
    throw new TypeError("$.fixture.perDocumentTextCodeUnits must be an array.");
  }
  if (fixture.perDocumentTextCodeUnits.length !== fixtureDocumentCount) {
    throw new TypeError("$.fixture.perDocumentTextCodeUnits must contain one value per fixture document.");
  }
  const perDocumentTextCodeUnits = fixture.perDocumentTextCodeUnits.map((value, index) =>
    integer(value, `$.fixture.perDocumentTextCodeUnits[${index}]`, 1, 1_000_000),
  );
  if (typeof fixture.manifestSha256 !== "string" || !SHA256.test(fixture.manifestSha256)) {
    throw new TypeError("$.fixture.manifestSha256 must be a sha256:<lowercase-hex> token.");
  }

  const environment = record(root.environment, "$.environment");
  exactKeys(
    environment,
    [
      "osClass",
      "browserVersionToken",
      "profileClass",
      "memorySaver",
      "energySaver",
      "instrumentation",
      "persistentDebuggerAttached",
      "hardwareMemoryBytes",
    ],
    "$.environment",
  );
  if (environment.profileClass !== "dedicated-signed-in") {
    throw new TypeError("$.environment.profileClass must be dedicated-signed-in.");
  }
  if (
    typeof environment.browserVersionToken !== "string" ||
    !VERSION_TOKEN.test(environment.browserVersionToken)
  ) {
    throw new TypeError("$.environment.browserVersionToken must be a bounded version token.");
  }
  if (environment.persistentDebuggerAttached !== false) {
    throw new TypeError("$.environment.persistentDebuggerAttached must be exactly false.");
  }
  const parsedEnvironment = Object.freeze({
    osClass: enumeration(
      environment.osClass,
      ["macos", "windows", "linux", "chromeos"] as const,
      "$.environment.osClass",
    ),
    browserVersionToken: environment.browserVersionToken,
    profileClass: "dedicated-signed-in" as const,
    memorySaver: enumeration(
      environment.memorySaver,
      ["off", "moderate", "balanced", "maximum", "unknown"] as const,
      "$.environment.memorySaver",
    ),
    energySaver: enumeration(
      environment.energySaver,
      ["off", "on", "unknown"] as const,
      "$.environment.energySaver",
    ),
    instrumentation: enumeration(
      environment.instrumentation,
      ["none", "extension-only", "bounded-cdp-lease", "extension-plus-bounded-cdp-lease"] as const,
      "$.environment.instrumentation",
    ),
    persistentDebuggerAttached: false as const,
    hardwareMemoryBytes: nullableInteger(
      environment.hardwareMemoryBytes,
      "$.environment.hardwareMemoryBytes",
      1,
    ),
  });

  if (!Array.isArray(root.samples) || root.samples.length < 6 || root.samples.length > 64) {
    throw new TypeError("$.samples must contain between 6 and 64 raw samples.");
  }
  if (workload === "docs-large-text-v1" && requestedDocumentCount !== 1) {
    throw new TypeError("docs-large-text-v1 requires requestedDocumentCount=1.");
  }
  if (workload === "docs-switch-8-v1") {
    if (requestedDocumentCount !== 8) {
      throw new TypeError("docs-switch-8-v1 requires requestedDocumentCount=8.");
    }
    if (root.samples.length !== 64) {
      throw new TypeError("docs-switch-8-v1 requires exactly 64 recorded samples.");
    }
  }
  if (
    workload === "docs-switch-capacity-v1" &&
    ![0, 1, 2, 4, 8].includes(requestedDocumentCount)
  ) {
    throw new TypeError("docs-switch-capacity-v1 requestedDocumentCount must be 0, 1, 2, 4, or 8.");
  }

  const samples = root.samples.map((sample, index) =>
    parseSample(sample, index, requestedDocumentCount),
  );
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index]!.sequence <= samples[index - 1]!.sequence) {
      throw new TypeError("$.samples sequence values must be strictly increasing.");
    }
  }
  assertLaneIdentityContinuity(samples, requestedDocumentCount);

  const fidelity = record(root.fidelity, "$.fidelity");
  exactKeys(
    fidelity,
    [...FIDELITY_FIELDS, "unexpectedReloadCount", "operatorVisibleFailureCount"],
    "$.fidelity",
  );
  const parsedFidelity = {} as Record<FidelityField, GoogleDocsVerdict>;
  for (const field of FIDELITY_FIELDS) {
    parsedFidelity[field] = enumeration(fidelity[field], VERDICTS, `$.fidelity.${field}`);
  }
  const normalizedFidelity = Object.freeze({
    ...parsedFidelity,
    unexpectedReloadCount: integer(
      fidelity.unexpectedReloadCount,
      "$.fidelity.unexpectedReloadCount",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    operatorVisibleFailureCount: integer(
      fidelity.operatorVisibleFailureCount,
      "$.fidelity.operatorVisibleFailureCount",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  });

  const privacy = record(root.privacy, "$.privacy");
  exactKeys(privacy, PRIVACY_FIELDS, "$.privacy");
  const normalizedPrivacy = {} as Record<(typeof PRIVACY_FIELDS)[number], false>;
  for (const field of PRIVACY_FIELDS) {
    if (privacy[field] !== false) {
      throw new TypeError(`$.privacy.${field} must be exactly false.`);
    }
    normalizedPrivacy[field] = false;
  }

  assertVariantCoherence(variant, parsedEnvironment, samples, requestedDocumentCount);

  return Object.freeze({
    schemaVersion: 1 as const,
    runId,
    recordedAt,
    workload,
    variant,
    requestedDocumentCount,
    fixture: Object.freeze({
      generator: "google-docs-workload-v1" as const,
      documentCount: fixtureDocumentCount,
      totalTextCodeUnits: integer(
        fixture.totalTextCodeUnits,
        "$.fixture.totalTextCodeUnits",
        1,
        10_000_000,
      ),
      perDocumentTextCodeUnits: Object.freeze(perDocumentTextCodeUnits),
      manifestSha256: fixture.manifestSha256,
    }),
    environment: parsedEnvironment,
    samples: Object.freeze(samples),
    fidelity: normalizedFidelity,
    privacy: Object.freeze(normalizedPrivacy),
  });
}
