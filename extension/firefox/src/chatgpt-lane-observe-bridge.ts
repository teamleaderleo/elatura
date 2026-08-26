// SPDX-License-Identifier: MPL-2.0

import type {
  FirefoxChatGptActivityPanelBindingV1,
} from "./chatgpt-lane-activity-panel.js";

export const FIREFOX_CHATGPT_GENERIC_OBSERVE_BRIDGE_VERSION = 1 as const;
export const FIREFOX_CHATGPT_ACTIVITY_CONTENT_TYPE =
  "application/vnd.elatura.chatgpt-activity+json" as const;

export type FirefoxChatGptGenericObserveResponseV1 = Readonly<Record<string, unknown>>;

type ObserveRequest = Readonly<{
  requestId: string;
  laneRef: string;
  laneGeneration: number;
  maxItems: number;
  maxTextCodeUnits: number;
  maxSerializedBytes: number;
}>;

type ActivityObservation = Readonly<{
  observedAtMs: number;
  confidence: "exact" | "probable" | "unknown";
  generation: "active" | "inactive" | "unknown";
  composer: "clean" | "dirty" | "unknown";
  composition: "active" | "inactive" | "unknown";
  modal: "active" | "inactive" | "unknown";
  mediaOrDevice: "active" | "inactive" | "unknown";
  download: "active" | "inactive" | "unknown";
  otherTransient: "active" | "inactive" | "unknown";
}>;

const LANE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;
const CONFIDENCE = ["exact", "probable", "unknown"] as const;
const BINARY_ACTIVITY = ["active", "inactive", "unknown"] as const;
const COMPOSER = ["clean", "dirty", "unknown"] as const;

/**
 * Project one private Firefox ChatGPT activity sample into the consumer-neutral
 * application-lane observe envelope.
 *
 * `tabId` and `documentProjectionRef` are admitted only as private correlation
 * facts and never copied into the returned record. The canonical core parser
 * remains the final protocol authority; extension tests mechanically admit every
 * emitted response through that parser and the exact request matcher.
 */
export function bridgeFirefoxChatGptActivityToObserveResponseV1(
  requestValue: unknown,
  binding: FirefoxChatGptActivityPanelBindingV1,
  routeRequestRefValue: unknown,
  routeReceiptValue: unknown,
  failureObservedAtMsValue: unknown,
): FirefoxChatGptGenericObserveResponseV1 {
  const request = parseObserveRequest(requestValue);
  const routeRequestRef = boundedToken(routeRequestRefValue, "Firefox observe route request reference");
  const failureObservedAtMs = nonNegativeInteger(
    failureObservedAtMsValue,
    "Firefox observe failure observation time",
  );
  if (
    binding.laneRef !== request.laneRef ||
    binding.laneGeneration !== request.laneGeneration
  ) {
    throw new TypeError("Firefox observe private binding does not match the application lane request");
  }

  const receipt = strictRecord(routeReceiptValue, "Firefox activity route receipt", [
    "version",
    "requestRef",
    "tabId",
    "documentProjectionRef",
    "laneRef",
    "laneGeneration",
    "outcome",
    "reason",
    "observation",
    "grantsWorkAuthority",
    "authorizesWorkDispatch",
  ]);
  if (
    receipt.version !== 2 ||
    receipt.requestRef !== routeRequestRef ||
    receipt.tabId !== binding.tabId ||
    receipt.documentProjectionRef !== binding.documentProjectionRef ||
    receipt.laneRef !== binding.laneRef ||
    receipt.laneGeneration !== binding.laneGeneration ||
    receipt.grantsWorkAuthority !== false ||
    receipt.authorizesWorkDispatch !== false
  ) {
    throw new TypeError("Firefox activity route receipt does not match the private observe request");
  }

  const sourceRef = `firefox-chatgpt-activity:${routeRequestRef}`;
  if (receipt.outcome === "sampled" && receipt.reason === "sampled") {
    const observation = parseObservation(receipt.observation, request);
    const content = Object.freeze({
      confidence: observation.confidence,
      generation: observation.generation,
      composer: observation.composer,
      composition: observation.composition,
      modal: observation.modal,
      mediaOrDevice: observation.mediaOrDevice,
      download: observation.download,
      otherTransient: observation.otherTransient,
    });
    const fullFits = contentFitsBudget(
      content,
      request.maxTextCodeUnits,
      request.maxSerializedBytes,
    );
    const emittedContent = fullFits ? content : null;
    if (!fullFits && !contentFitsBudget(null, request.maxTextCodeUnits, request.maxSerializedBytes)) {
      throw new RangeError("Firefox observe budget cannot represent an omitted observation");
    }
    return response(
      request,
      "ok",
      "active",
      observation.observedAtMs,
      Object.freeze({
        observationRef: `observation:${routeRequestRef}`,
        freshness: "fresh",
        contentType: FIREFOX_CHATGPT_ACTIVITY_CONTENT_TYPE,
        content: emittedContent,
        omitted: !fullFits,
        sourceRefs: Object.freeze([sourceRef]),
      }),
      sourceRef,
    );
  }

  if (receipt.outcome === "stale_projection" && receipt.reason === "document_projection_mismatch") {
    return response(request, "drifted", "drifted", failureObservedAtMs, null, sourceRef);
  }
  if (receipt.outcome === "unavailable" && receipt.reason === "content_unavailable") {
    return response(request, "unavailable", "unavailable", failureObservedAtMs, null, sourceRef);
  }
  if (receipt.outcome === "browser_error" && receipt.reason === "operation_failed") {
    return response(
      request,
      "recovery_needed",
      "recovery_needed",
      failureObservedAtMs,
      null,
      sourceRef,
    );
  }
  throw new TypeError("Firefox activity route receipt cannot be projected as application state");
}

function parseObserveRequest(value: unknown): ObserveRequest {
  const input = strictRecord(value, "Application lane observe request", [
    "version",
    "requestId",
    "laneRef",
    "laneGeneration",
    "operation",
    "payload",
  ]);
  if (input.version !== 1 || input.operation !== "observe") {
    throw new TypeError("Application lane observe request identity is invalid");
  }
  const payload = strictRecord(input.payload, "Application lane observe budget", [
    "maxItems",
    "maxTextCodeUnits",
    "maxSerializedBytes",
  ]);
  return Object.freeze({
    requestId: exactText(input.requestId, REQUEST_ID, "Application lane request id"),
    laneRef: exactText(input.laneRef, LANE_REF, "Application lane reference"),
    laneGeneration: positiveInteger(input.laneGeneration, "Application lane generation"),
    maxItems: positiveInteger(payload.maxItems, "Application lane observation item budget"),
    maxTextCodeUnits: positiveInteger(
      payload.maxTextCodeUnits,
      "Application lane observation text budget",
    ),
    maxSerializedBytes: positiveInteger(
      payload.maxSerializedBytes,
      "Application lane observation byte budget",
    ),
  });
}

function parseObservation(value: unknown, request: ObserveRequest): ActivityObservation {
  const input = strictRecord(value, "Firefox activity observation", [
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
  ]);
  if (
    input.version !== 1 ||
    input.source !== "reviewed-live-sentinel" ||
    input.laneRef !== request.laneRef ||
    input.laneGeneration !== request.laneGeneration ||
    input.grantsWorkAuthority !== false ||
    input.authorizesWorkDispatch !== false
  ) {
    throw new TypeError("Firefox activity observation identity is invalid");
  }
  return Object.freeze({
    observedAtMs: nonNegativeInteger(input.observedAtMs, "Firefox activity observation time"),
    confidence: exactEnum(input.confidence, CONFIDENCE, "Firefox activity confidence"),
    generation: exactEnum(input.generation, BINARY_ACTIVITY, "Firefox generation activity"),
    composer: exactEnum(input.composer, COMPOSER, "Firefox composer state"),
    composition: exactEnum(input.composition, BINARY_ACTIVITY, "Firefox composition activity"),
    modal: exactEnum(input.modal, BINARY_ACTIVITY, "Firefox modal activity"),
    mediaOrDevice: exactEnum(input.mediaOrDevice, BINARY_ACTIVITY, "Firefox media/device activity"),
    download: exactEnum(input.download, BINARY_ACTIVITY, "Firefox download activity"),
    otherTransient: exactEnum(input.otherTransient, BINARY_ACTIVITY, "Firefox transient activity"),
  });
}

function response(
  request: ObserveRequest,
  outcome: "ok" | "unavailable" | "drifted" | "recovery_needed",
  state: "active" | "unavailable" | "drifted" | "recovery_needed",
  observedAtMs: number,
  payload: Readonly<Record<string, unknown>> | null,
  sourceRef: string,
): FirefoxChatGptGenericObserveResponseV1 {
  return Object.freeze({
    version: 1,
    requestId: request.requestId,
    laneRef: request.laneRef,
    laneGeneration: request.laneGeneration,
    operation: "observe",
    outcome,
    state,
    observedAt: new Date(observedAtMs).toISOString(),
    payload,
    sourceRefs: Object.freeze([sourceRef]),
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function contentFitsBudget(
  value: unknown,
  maxTextCodeUnits: number,
  maxSerializedBytes: number,
): boolean {
  const text = JSON.stringify(value);
  if (text === undefined) return false;
  return stringCodeUnits(value) <= maxTextCodeUnits && utf8Bytes(text) <= maxSerializedBytes;
}

function stringCodeUnits(value: unknown): number {
  if (value === null || typeof value === "boolean" || typeof value === "number") return 0;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + stringCodeUnits(child), 0);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .reduce((total, [key, child]) => total + key.length + stringCodeUnits(child), 0);
  }
  return Number.MAX_SAFE_INTEGER;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function strictRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object") throw new TypeError(`${label} must be an object`);
  let isArray: boolean;
  let prototype: object | null;
  let symbols: symbol[];
  let descriptors: PropertyDescriptorMap;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${label} inspection failed`);
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
    throw new TypeError(`${label} must be an undecorated plain object`);
  }
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} must contain enumerable data properties only`);
    }
    if (!keys.includes(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
    output[key] = descriptor.value;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) {
      throw new TypeError(`${label} is missing required field ${key}`);
    }
  }
  return output;
}

function exactText(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function boundedToken(value: unknown, label: string): string {
  return exactText(value, TOKEN, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
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
  if (typeof value !== "string" || !values.includes(value)) throw new TypeError(`${label} is invalid`);
  return value as Values[number];
}
