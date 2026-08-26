// SPDX-License-Identifier: MPL-2.0

export const FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION = 2 as const;
export const FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_VERSION = 1 as const;
export const FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE =
  "elatura:sample-chatgpt-lane-activity-on-tab" as const;
export const FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_MESSAGE_TYPE =
  "elatura:get-chatgpt-document-projection-on-tab" as const;
export const FIREFOX_CHATGPT_ACTIVITY_CONTENT_MESSAGE_TYPE =
  "elatura:sample-chatgpt-lane-activity" as const;
export const FIREFOX_CHATGPT_DOCUMENT_PROJECTION_CONTENT_MESSAGE_TYPE =
  "elatura:get-chatgpt-document-projection" as const;

export type FirefoxChatGptDocumentProjectionRouteRequestV1 = Readonly<{
  version: typeof FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_VERSION;
  requestRef: string;
  tabId: number;
}>;

export type FirefoxChatGptDocumentProjectionRouteReceiptV1 = Readonly<{
  version: typeof FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_VERSION;
  requestRef: string;
  tabId: number;
  outcome: "resolved" | "unavailable" | "invalid_response" | "browser_error";
  reason: "resolved" | "content_unavailable" | "invalid_projection" | "operation_failed";
  documentProjectionRef: string | null;
  observedAtMs: number | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptActivityRouteRequestV2 = Readonly<{
  version: typeof FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION;
  requestRef: string;
  tabId: number;
  documentProjectionRef: string;
  laneRef: string;
  laneGeneration: number;
}>;

export type FirefoxChatGptActivityWireObservationV1 = Readonly<{
  version: 1;
  laneRef: string;
  laneGeneration: number;
  observedAtMs: number;
  source: "reviewed-live-sentinel";
  confidence: "exact" | "probable" | "unknown";
  generation: "active" | "inactive" | "unknown";
  composer: "clean" | "dirty" | "unknown";
  composition: "active" | "inactive" | "unknown";
  modal: "active" | "inactive" | "unknown";
  mediaOrDevice: "active" | "inactive" | "unknown";
  download: "active" | "inactive" | "unknown";
  otherTransient: "active" | "inactive" | "unknown";
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptActivityContentResponseV2 = Readonly<{
  version: 2;
  documentProjectionRef: string;
  status: "sampled" | "projection_mismatch";
  observation: FirefoxChatGptActivityWireObservationV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export const firefoxChatGptActivityRouteOutcomes = [
  "sampled",
  "stale_projection",
  "unavailable",
  "invalid_response",
  "mismatched_response",
  "browser_error",
] as const;
export type FirefoxChatGptActivityRouteOutcome =
  (typeof firefoxChatGptActivityRouteOutcomes)[number];

export const firefoxChatGptActivityRouteReasons = [
  "sampled",
  "document_projection_mismatch",
  "content_unavailable",
  "invalid_observation",
  "lane_mismatch",
  "generation_mismatch",
  "operation_failed",
] as const;
export type FirefoxChatGptActivityRouteReason =
  (typeof firefoxChatGptActivityRouteReasons)[number];

export type FirefoxChatGptActivityRouteReceiptV2 = Readonly<{
  version: typeof FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION;
  requestRef: string;
  tabId: number;
  documentProjectionRef: string;
  laneRef: string;
  laneGeneration: number;
  outcome: FirefoxChatGptActivityRouteOutcome;
  reason: FirefoxChatGptActivityRouteReason;
  observation: FirefoxChatGptActivityWireObservationV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptActivityRouteReceiptMatchV2 = Readonly<{
  matched: boolean;
  reason: "matched" | "request_mismatch";
}>;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LANE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;
const BINARY_ACTIVITY = ["active", "inactive", "unknown"] as const;
const CONFIDENCE = ["exact", "probable", "unknown"] as const;
const COMPOSER = ["clean", "dirty", "unknown"] as const;
const OBSERVATION_KEYS = [
  "version",
  "laneRef",
  "laneGeneration",
  "observedAtMs",
  "source",
  "confidence",
  "generation",
  "composer",
  "composition",
  "modal",
  "mediaOrDevice",
  "download",
  "otherTransient",
  "grantsWorkAuthority",
  "authorizesWorkDispatch",
] as const;

export function parseFirefoxChatGptDocumentProjectionRouteRequestV1(
  value: unknown,
): FirefoxChatGptDocumentProjectionRouteRequestV1 {
  const input = ownDataRecord(value, "Firefox ChatGPT document projection request", [
    "version",
    "requestRef",
    "tabId",
  ]);
  if (input.version !== FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_VERSION) {
    throw new TypeError("Firefox ChatGPT document projection request version is invalid");
  }
  return Object.freeze({
    version: FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_VERSION,
    requestRef: boundedToken(input.requestRef, "Firefox document projection request reference"),
    tabId: nonNegativeInteger(input.tabId, "Firefox document projection tab id"),
  });
}

export function parseFirefoxChatGptDocumentProjectionRouteMessageV1(
  value: unknown,
): FirefoxChatGptDocumentProjectionRouteRequestV1 | null {
  const input = parseRouteMessage(value, FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_MESSAGE_TYPE);
  if (input === null) return null;
  try {
    return parseFirefoxChatGptDocumentProjectionRouteRequestV1(input);
  } catch {
    return null;
  }
}

export function admitFirefoxChatGptDocumentProjectionResponseV1(
  request: FirefoxChatGptDocumentProjectionRouteRequestV1,
  value: unknown,
): FirefoxChatGptDocumentProjectionRouteReceiptV1 {
  try {
    const input = ownDataRecord(value, "Firefox ChatGPT document projection response", [
      "version",
      "documentProjectionRef",
      "observedAtMs",
      "grantsWorkAuthority",
      "authorizesWorkDispatch",
    ]);
    if (
      input.version !== 1 ||
      input.grantsWorkAuthority !== false ||
      input.authorizesWorkDispatch !== false
    ) {
      throw new TypeError();
    }
    return documentProjectionReceipt(
      request,
      "resolved",
      "resolved",
      boundedToken(input.documentProjectionRef, "Firefox document projection reference"),
      nonNegativeInteger(input.observedAtMs, "Firefox document projection observation time"),
    );
  } catch {
    return documentProjectionReceipt(request, "invalid_response", "invalid_projection", null, null);
  }
}

export function createFirefoxChatGptDocumentProjectionFailureV1(
  request: FirefoxChatGptDocumentProjectionRouteRequestV1,
  outcome: "unavailable" | "browser_error",
  reason: "content_unavailable" | "operation_failed",
): FirefoxChatGptDocumentProjectionRouteReceiptV1 {
  return documentProjectionReceipt(request, outcome, reason, null, null);
}

export function parseFirefoxChatGptActivityRouteRequestV2(
  value: unknown,
): FirefoxChatGptActivityRouteRequestV2 {
  const input = ownDataRecord(value, "Firefox ChatGPT activity route request", [
    "version",
    "requestRef",
    "tabId",
    "documentProjectionRef",
    "laneRef",
    "laneGeneration",
  ]);
  if (input.version !== FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION) {
    throw new TypeError("Firefox ChatGPT activity route request version is invalid");
  }
  return Object.freeze({
    version: FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION,
    requestRef: boundedToken(input.requestRef, "Firefox activity request reference"),
    tabId: nonNegativeInteger(input.tabId, "Firefox activity tab id"),
    documentProjectionRef: boundedToken(
      input.documentProjectionRef,
      "Firefox document projection reference",
    ),
    laneRef: boundedLaneRef(input.laneRef),
    laneGeneration: positiveInteger(input.laneGeneration, "Firefox activity lane generation"),
  });
}

export function parseFirefoxChatGptActivityRouteMessageV2(
  value: unknown,
): FirefoxChatGptActivityRouteRequestV2 | null {
  const input = parseRouteMessage(value, FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE);
  if (input === null) return null;
  try {
    return parseFirefoxChatGptActivityRouteRequestV2(input);
  } catch {
    return null;
  }
}

export function parseFirefoxChatGptActivityWireObservationV1(
  value: unknown,
): FirefoxChatGptActivityWireObservationV1 {
  const input = ownDataRecord(value, "Firefox ChatGPT activity observation", OBSERVATION_KEYS);
  if (input.version !== 1 || input.source !== "reviewed-live-sentinel") {
    throw new TypeError("Firefox ChatGPT activity observation identity is invalid");
  }
  if (input.grantsWorkAuthority !== false || input.authorizesWorkDispatch !== false) {
    throw new TypeError("Firefox ChatGPT activity observation authority is invalid");
  }
  return Object.freeze({
    version: 1,
    laneRef: boundedLaneRef(input.laneRef),
    laneGeneration: positiveInteger(input.laneGeneration, "Firefox activity lane generation"),
    observedAtMs: nonNegativeInteger(input.observedAtMs, "Firefox activity observation time"),
    source: "reviewed-live-sentinel",
    confidence: exactEnum(input.confidence, CONFIDENCE, "Firefox activity confidence"),
    generation: exactEnum(input.generation, BINARY_ACTIVITY, "Firefox generation activity"),
    composer: exactEnum(input.composer, COMPOSER, "Firefox composer state"),
    composition: exactEnum(input.composition, BINARY_ACTIVITY, "Firefox composition activity"),
    modal: exactEnum(input.modal, BINARY_ACTIVITY, "Firefox modal activity"),
    mediaOrDevice: exactEnum(input.mediaOrDevice, BINARY_ACTIVITY, "Firefox media/device activity"),
    download: exactEnum(input.download, BINARY_ACTIVITY, "Firefox download activity"),
    otherTransient: exactEnum(input.otherTransient, BINARY_ACTIVITY, "Firefox other transient activity"),
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

export function parseFirefoxChatGptActivityContentResponseV2(
  value: unknown,
): FirefoxChatGptActivityContentResponseV2 {
  const input = ownDataRecord(value, "Firefox ChatGPT activity content response", [
    "version",
    "documentProjectionRef",
    "status",
    "observation",
    "grantsWorkAuthority",
    "authorizesWorkDispatch",
  ]);
  if (
    input.version !== 2 ||
    input.grantsWorkAuthority !== false ||
    input.authorizesWorkDispatch !== false
  ) {
    throw new TypeError("Firefox ChatGPT activity content response identity is invalid");
  }
  const status = exactEnum(
    input.status,
    ["sampled", "projection_mismatch"] as const,
    "Firefox activity content response status",
  );
  const observation = input.observation === null
    ? null
    : parseFirefoxChatGptActivityWireObservationV1(input.observation);
  if (
    (status === "sampled" && observation === null) ||
    (status === "projection_mismatch" && observation !== null)
  ) {
    throw new TypeError("Firefox ChatGPT activity content response is incoherent");
  }
  return Object.freeze({
    version: 2,
    documentProjectionRef: boundedToken(
      input.documentProjectionRef,
      "Firefox document projection reference",
    ),
    status,
    observation,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

export function admitFirefoxChatGptActivityRouteResponseV2(
  request: FirefoxChatGptActivityRouteRequestV2,
  value: unknown,
): FirefoxChatGptActivityRouteReceiptV2 {
  let response: FirefoxChatGptActivityContentResponseV2;
  try {
    response = parseFirefoxChatGptActivityContentResponseV2(value);
  } catch {
    return activityReceipt(request, "invalid_response", "invalid_observation", null);
  }
  if (
    response.status === "projection_mismatch" ||
    response.documentProjectionRef !== request.documentProjectionRef
  ) {
    return activityReceipt(
      request,
      "stale_projection",
      "document_projection_mismatch",
      null,
    );
  }
  const observation = response.observation;
  if (observation === null) {
    return activityReceipt(request, "invalid_response", "invalid_observation", null);
  }
  if (observation.laneRef !== request.laneRef) {
    return activityReceipt(request, "mismatched_response", "lane_mismatch", null);
  }
  if (observation.laneGeneration !== request.laneGeneration) {
    return activityReceipt(request, "mismatched_response", "generation_mismatch", null);
  }
  return activityReceipt(request, "sampled", "sampled", observation);
}

export function createFirefoxChatGptActivityRouteFailureV2(
  request: FirefoxChatGptActivityRouteRequestV2,
  outcome: "unavailable" | "browser_error",
  reason: "content_unavailable" | "operation_failed",
): FirefoxChatGptActivityRouteReceiptV2 {
  return activityReceipt(request, outcome, reason, null);
}

export function matchFirefoxChatGptActivityRouteReceiptV2(
  request: FirefoxChatGptActivityRouteRequestV2,
  receipt: FirefoxChatGptActivityRouteReceiptV2,
): FirefoxChatGptActivityRouteReceiptMatchV2 {
  const matched =
    request.version === receipt.version &&
    request.requestRef === receipt.requestRef &&
    request.tabId === receipt.tabId &&
    request.documentProjectionRef === receipt.documentProjectionRef &&
    request.laneRef === receipt.laneRef &&
    request.laneGeneration === receipt.laneGeneration;
  return Object.freeze({
    matched,
    reason: matched ? "matched" : "request_mismatch",
  });
}

function parseRouteMessage(value: unknown, type: string): unknown | null {
  let input: Readonly<Record<string, unknown>>;
  try {
    input = ownDataRecord(value, "Firefox ChatGPT route message", ["type", "request"]);
  } catch {
    return null;
  }
  return input.type === type ? input.request : null;
}

function documentProjectionReceipt(
  request: FirefoxChatGptDocumentProjectionRouteRequestV1,
  outcome: FirefoxChatGptDocumentProjectionRouteReceiptV1["outcome"],
  reason: FirefoxChatGptDocumentProjectionRouteReceiptV1["reason"],
  documentProjectionRef: string | null,
  observedAtMs: number | null,
): FirefoxChatGptDocumentProjectionRouteReceiptV1 {
  const coherent =
    (outcome === "resolved" && reason === "resolved" && documentProjectionRef !== null && observedAtMs !== null) ||
    (outcome === "unavailable" && reason === "content_unavailable" && documentProjectionRef === null && observedAtMs === null) ||
    (outcome === "invalid_response" && reason === "invalid_projection" && documentProjectionRef === null && observedAtMs === null) ||
    (outcome === "browser_error" && reason === "operation_failed" && documentProjectionRef === null && observedAtMs === null);
  if (!coherent) throw new TypeError("Firefox ChatGPT document projection receipt is incoherent");
  return Object.freeze({
    version: 1,
    requestRef: request.requestRef,
    tabId: request.tabId,
    outcome,
    reason,
    documentProjectionRef,
    observedAtMs,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function activityReceipt(
  request: FirefoxChatGptActivityRouteRequestV2,
  outcome: FirefoxChatGptActivityRouteOutcome,
  reason: FirefoxChatGptActivityRouteReason,
  observation: FirefoxChatGptActivityWireObservationV1 | null,
): FirefoxChatGptActivityRouteReceiptV2 {
  const coherent =
    (outcome === "sampled" && reason === "sampled" && observation !== null) ||
    (outcome === "stale_projection" && reason === "document_projection_mismatch" && observation === null) ||
    (outcome === "unavailable" && reason === "content_unavailable" && observation === null) ||
    (outcome === "invalid_response" && reason === "invalid_observation" && observation === null) ||
    (outcome === "mismatched_response" && (reason === "lane_mismatch" || reason === "generation_mismatch") && observation === null) ||
    (outcome === "browser_error" && reason === "operation_failed" && observation === null);
  if (!coherent) throw new TypeError("Firefox ChatGPT activity route receipt is incoherent");
  return Object.freeze({
    version: 2,
    requestRef: request.requestRef,
    tabId: request.tabId,
    documentProjectionRef: request.documentProjectionRef,
    laneRef: request.laneRef,
    laneGeneration: request.laneGeneration,
    outcome,
    reason,
    observation,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function ownDataRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new TypeError();
    }
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError();
      }
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
}

function boundedToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function boundedLaneRef(value: unknown): string {
  if (typeof value !== "string" || !LANE_REF.test(value)) {
    throw new TypeError("Firefox activity lane reference is invalid");
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function exactEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Values[number];
}
