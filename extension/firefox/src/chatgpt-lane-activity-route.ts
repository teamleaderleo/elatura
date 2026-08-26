// SPDX-License-Identifier: MPL-2.0

export const FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION = 1 as const;
export const FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE =
  "elatura:sample-chatgpt-lane-activity-on-tab" as const;
export const FIREFOX_CHATGPT_ACTIVITY_CONTENT_MESSAGE_TYPE =
  "elatura:sample-chatgpt-lane-activity" as const;

export type FirefoxChatGptActivityRouteRequestV1 = Readonly<{
  version: typeof FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION;
  requestRef: string;
  tabId: number;
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

export const firefoxChatGptActivityRouteOutcomes = [
  "sampled",
  "unavailable",
  "invalid_response",
  "mismatched_response",
  "browser_error",
] as const;
export type FirefoxChatGptActivityRouteOutcome =
  (typeof firefoxChatGptActivityRouteOutcomes)[number];

export const firefoxChatGptActivityRouteReasons = [
  "sampled",
  "content_unavailable",
  "invalid_observation",
  "lane_mismatch",
  "generation_mismatch",
  "operation_failed",
] as const;
export type FirefoxChatGptActivityRouteReason =
  (typeof firefoxChatGptActivityRouteReasons)[number];

export type FirefoxChatGptActivityRouteReceiptV1 = Readonly<{
  version: typeof FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION;
  requestRef: string;
  tabId: number;
  laneRef: string;
  laneGeneration: number;
  outcome: FirefoxChatGptActivityRouteOutcome;
  reason: FirefoxChatGptActivityRouteReason;
  observation: FirefoxChatGptActivityWireObservationV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptActivityRouteReceiptMatchV1 = Readonly<{
  matched: boolean;
  reason: "matched" | "request_mismatch";
}>;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LANE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;
const BINARY_ACTIVITY = ["active", "inactive", "unknown"] as const;
const CONFIDENCE = ["exact", "probable", "unknown"] as const;
const COMPOSER = ["clean", "dirty", "unknown"] as const;
const REQUEST_KEYS = ["version", "requestRef", "tabId", "laneRef", "laneGeneration"] as const;
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
const RECEIPT_KEYS = [
  "version",
  "requestRef",
  "tabId",
  "laneRef",
  "laneGeneration",
  "outcome",
  "reason",
  "observation",
  "grantsWorkAuthority",
  "authorizesWorkDispatch",
] as const;

export function parseFirefoxChatGptActivityRouteRequestV1(
  value: unknown,
): FirefoxChatGptActivityRouteRequestV1 {
  const input = ownDataRecord(value, "Firefox ChatGPT activity route request", REQUEST_KEYS);
  if (input.version !== FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION) {
    throw new TypeError("Firefox ChatGPT activity route request version is invalid");
  }
  return Object.freeze({
    version: FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION,
    requestRef: boundedToken(input.requestRef, "Firefox activity request reference"),
    tabId: nonNegativeInteger(input.tabId, "Firefox activity tab id"),
    laneRef: boundedLaneRef(input.laneRef),
    laneGeneration: positiveInteger(input.laneGeneration, "Firefox activity lane generation"),
  });
}

export function parseFirefoxChatGptActivityRouteMessageV1(
  value: unknown,
): FirefoxChatGptActivityRouteRequestV1 | null {
  let input: Readonly<Record<string, unknown>>;
  try {
    input = ownDataRecord(value, "Firefox ChatGPT activity route message", ["type", "request"]);
  } catch {
    return null;
  }
  if (input.type !== FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE) return null;
  try {
    return parseFirefoxChatGptActivityRouteRequestV1(input.request);
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

export function admitFirefoxChatGptActivityRouteResponseV1(
  request: FirefoxChatGptActivityRouteRequestV1,
  value: unknown,
): FirefoxChatGptActivityRouteReceiptV1 {
  let observation: FirefoxChatGptActivityWireObservationV1;
  try {
    observation = parseFirefoxChatGptActivityWireObservationV1(value);
  } catch {
    return routeReceipt(request, "invalid_response", "invalid_observation", null);
  }
  if (observation.laneRef !== request.laneRef) {
    return routeReceipt(request, "mismatched_response", "lane_mismatch", null);
  }
  if (observation.laneGeneration !== request.laneGeneration) {
    return routeReceipt(request, "mismatched_response", "generation_mismatch", null);
  }
  return routeReceipt(request, "sampled", "sampled", observation);
}

export function createFirefoxChatGptActivityRouteFailureV1(
  request: FirefoxChatGptActivityRouteRequestV1,
  outcome: "unavailable" | "browser_error",
  reason: "content_unavailable" | "operation_failed",
): FirefoxChatGptActivityRouteReceiptV1 {
  return routeReceipt(request, outcome, reason, null);
}

export function parseFirefoxChatGptActivityRouteReceiptV1(
  value: unknown,
): FirefoxChatGptActivityRouteReceiptV1 {
  const input = ownDataRecord(value, "Firefox ChatGPT activity route receipt", RECEIPT_KEYS);
  if (input.version !== FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION) {
    throw new TypeError("Firefox ChatGPT activity route receipt version is invalid");
  }
  if (input.grantsWorkAuthority !== false || input.authorizesWorkDispatch !== false) {
    throw new TypeError("Firefox ChatGPT activity route receipt authority is invalid");
  }
  const request: FirefoxChatGptActivityRouteRequestV1 = Object.freeze({
    version: FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION,
    requestRef: boundedToken(input.requestRef, "Firefox activity request reference"),
    tabId: nonNegativeInteger(input.tabId, "Firefox activity tab id"),
    laneRef: boundedLaneRef(input.laneRef),
    laneGeneration: positiveInteger(input.laneGeneration, "Firefox activity lane generation"),
  });
  const outcome = exactEnum(
    input.outcome,
    firefoxChatGptActivityRouteOutcomes,
    "Firefox activity route outcome",
  );
  const reason = exactEnum(
    input.reason,
    firefoxChatGptActivityRouteReasons,
    "Firefox activity route reason",
  );
  const observation = input.observation === null
    ? null
    : parseFirefoxChatGptActivityWireObservationV1(input.observation);

  if (!receiptCoherent(request, outcome, reason, observation)) {
    throw new TypeError("Firefox ChatGPT activity route receipt is incoherent");
  }

  return Object.freeze({
    ...request,
    outcome,
    reason,
    observation,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

export function matchFirefoxChatGptActivityRouteReceiptV1(
  request: FirefoxChatGptActivityRouteRequestV1,
  receipt: FirefoxChatGptActivityRouteReceiptV1,
): FirefoxChatGptActivityRouteReceiptMatchV1 {
  const matched =
    request.version === receipt.version &&
    request.requestRef === receipt.requestRef &&
    request.tabId === receipt.tabId &&
    request.laneRef === receipt.laneRef &&
    request.laneGeneration === receipt.laneGeneration;
  return Object.freeze({
    matched,
    reason: matched ? "matched" : "request_mismatch",
  });
}

function routeReceipt(
  request: FirefoxChatGptActivityRouteRequestV1,
  outcome: FirefoxChatGptActivityRouteOutcome,
  reason: FirefoxChatGptActivityRouteReason,
  observation: FirefoxChatGptActivityWireObservationV1 | null,
): FirefoxChatGptActivityRouteReceiptV1 {
  if (!receiptCoherent(request, outcome, reason, observation)) {
    throw new TypeError("Firefox ChatGPT activity route receipt is incoherent");
  }
  return Object.freeze({
    version: FIREFOX_CHATGPT_ACTIVITY_ROUTE_VERSION,
    requestRef: request.requestRef,
    tabId: request.tabId,
    laneRef: request.laneRef,
    laneGeneration: request.laneGeneration,
    outcome,
    reason,
    observation,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function receiptCoherent(
  request: FirefoxChatGptActivityRouteRequestV1,
  outcome: FirefoxChatGptActivityRouteOutcome,
  reason: FirefoxChatGptActivityRouteReason,
  observation: FirefoxChatGptActivityWireObservationV1 | null,
): boolean {
  switch (outcome) {
    case "sampled":
      return (
        reason === "sampled" &&
        observation !== null &&
        observation.laneRef === request.laneRef &&
        observation.laneGeneration === request.laneGeneration
      );
    case "unavailable":
      return reason === "content_unavailable" && observation === null;
    case "invalid_response":
      return reason === "invalid_observation" && observation === null;
    case "mismatched_response":
      return (
        (reason === "lane_mismatch" || reason === "generation_mismatch") &&
        observation === null
      );
    case "browser_error":
      return reason === "operation_failed" && observation === null;
  }
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
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
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
