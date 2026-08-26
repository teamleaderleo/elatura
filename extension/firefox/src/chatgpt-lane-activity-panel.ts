// SPDX-License-Identifier: MPL-2.0

import {
  FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
  FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_MESSAGE_TYPE,
} from "./chatgpt-lane-activity-route.js";

export const FIREFOX_CHATGPT_ACTIVITY_PANEL_VERSION = 1 as const;

export type FirefoxChatGptActivityPanelTargetV1 = Readonly<{
  laneRef: string;
  laneGeneration: number;
}>;

export type FirefoxChatGptActivityPanelBindingV1 = Readonly<{
  tabId: number;
  documentProjectionRef: string;
  laneRef: string;
  laneGeneration: number;
}>;

export type FirefoxChatGptActivityPanelObservationV1 = Readonly<{
  confidence: "exact" | "probable" | "unknown";
  generation: "active" | "inactive" | "unknown";
  composer: "clean" | "dirty" | "unknown";
  composition: "active" | "inactive" | "unknown";
  modal: "active" | "inactive" | "unknown";
  mediaOrDevice: "active" | "inactive" | "unknown";
  download: "active" | "inactive" | "unknown";
  otherTransient: "active" | "inactive" | "unknown";
}>;

export type FirefoxChatGptActivityPanelBindingResultV1 = Readonly<{
  status: "bound" | "unavailable" | "invalid";
  binding: FirefoxChatGptActivityPanelBindingV1 | null;
}>;

export type FirefoxChatGptActivityPanelSampleResultV1 = Readonly<{
  status: "sampled" | "stale" | "unavailable" | "invalid";
  binding: FirefoxChatGptActivityPanelBindingV1 | null;
  observation: FirefoxChatGptActivityPanelObservationV1 | null;
}>;

const LANE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONFIDENCE = ["exact", "probable", "unknown"] as const;
const BINARY_ACTIVITY = ["active", "inactive", "unknown"] as const;
const COMPOSER = ["clean", "dirty", "unknown"] as const;

export function parseFirefoxChatGptActivityPanelTargetV1(
  laneRefInput: unknown,
  laneGenerationInput: unknown,
): FirefoxChatGptActivityPanelTargetV1 {
  if (typeof laneRefInput !== "string") {
    throw new TypeError("Firefox ChatGPT panel lane reference is invalid");
  }
  const laneRef = laneRefInput.trim();
  if (!LANE_REF.test(laneRef)) {
    throw new TypeError("Firefox ChatGPT panel lane reference is invalid");
  }

  const text = typeof laneGenerationInput === "number"
    ? String(laneGenerationInput)
    : typeof laneGenerationInput === "string"
      ? laneGenerationInput.trim()
      : "";
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new TypeError("Firefox ChatGPT panel lane generation is invalid");
  }
  const laneGeneration = Number(text);
  if (!Number.isSafeInteger(laneGeneration)) {
    throw new TypeError("Firefox ChatGPT panel lane generation is invalid");
  }
  return Object.freeze({ laneRef, laneGeneration });
}

export function createFirefoxChatGptActivityPanelDiscoveryMessageV1(
  tabIdInput: unknown,
  requestRefInput: unknown,
): Readonly<Record<string, unknown>> {
  const tabId = nonNegativeInteger(tabIdInput, "Firefox ChatGPT panel tab id");
  const requestRef = boundedToken(requestRefInput, "Firefox ChatGPT panel request reference");
  return Object.freeze({
    type: FIREFOX_CHATGPT_DOCUMENT_PROJECTION_ROUTE_MESSAGE_TYPE,
    request: Object.freeze({
      version: 1,
      requestRef,
      tabId,
    }),
  });
}

export function acceptFirefoxChatGptActivityPanelDiscoveryV1(
  target: FirefoxChatGptActivityPanelTargetV1,
  tabIdInput: unknown,
  requestRefInput: unknown,
  response: unknown,
): FirefoxChatGptActivityPanelBindingResultV1 {
  const tabId = nonNegativeInteger(tabIdInput, "Firefox ChatGPT panel tab id");
  const requestRef = boundedToken(requestRefInput, "Firefox ChatGPT panel request reference");
  if (!isRecord(response)) return bindingResult("invalid", null);

  const version = data(response, "version");
  const responseRequestRef = data(response, "requestRef");
  const responseTabId = data(response, "tabId");
  const outcome = data(response, "outcome");
  const documentProjectionRef = data(response, "documentProjectionRef");
  const grantsWorkAuthority = data(response, "grantsWorkAuthority");
  const authorizesWorkDispatch = data(response, "authorizesWorkDispatch");
  if (
    version !== 1 ||
    responseRequestRef !== requestRef ||
    responseTabId !== tabId ||
    grantsWorkAuthority !== false ||
    authorizesWorkDispatch !== false
  ) {
    return bindingResult("invalid", null);
  }
  if (outcome !== "resolved") return bindingResult("unavailable", null);
  try {
    const projectionRef = boundedToken(
      documentProjectionRef,
      "Firefox ChatGPT panel document projection",
    );
    return bindingResult(
      "bound",
      Object.freeze({
        tabId,
        documentProjectionRef: projectionRef,
        laneRef: target.laneRef,
        laneGeneration: target.laneGeneration,
      }),
    );
  } catch {
    return bindingResult("invalid", null);
  }
}

export function createFirefoxChatGptActivityPanelSampleMessageV1(
  binding: FirefoxChatGptActivityPanelBindingV1,
  requestRefInput: unknown,
): Readonly<Record<string, unknown>> {
  const requestRef = boundedToken(requestRefInput, "Firefox ChatGPT panel request reference");
  return Object.freeze({
    type: FIREFOX_CHATGPT_ACTIVITY_ROUTE_MESSAGE_TYPE,
    request: Object.freeze({
      version: 2,
      requestRef,
      tabId: binding.tabId,
      documentProjectionRef: binding.documentProjectionRef,
      laneRef: binding.laneRef,
      laneGeneration: binding.laneGeneration,
    }),
  });
}

export function acceptFirefoxChatGptActivityPanelSampleV1(
  binding: FirefoxChatGptActivityPanelBindingV1,
  requestRefInput: unknown,
  response: unknown,
): FirefoxChatGptActivityPanelSampleResultV1 {
  const requestRef = boundedToken(requestRefInput, "Firefox ChatGPT panel request reference");
  if (!isRecord(response)) return sampleResult("invalid", null, null);

  if (
    data(response, "version") !== 2 ||
    data(response, "requestRef") !== requestRef ||
    data(response, "tabId") !== binding.tabId ||
    data(response, "documentProjectionRef") !== binding.documentProjectionRef ||
    data(response, "laneRef") !== binding.laneRef ||
    data(response, "laneGeneration") !== binding.laneGeneration ||
    data(response, "grantsWorkAuthority") !== false ||
    data(response, "authorizesWorkDispatch") !== false
  ) {
    return sampleResult("invalid", null, null);
  }

  const outcome = data(response, "outcome");
  if (outcome === "stale_projection") return sampleResult("stale", null, null);
  if (outcome !== "sampled") return sampleResult("unavailable", null, null);

  const observationValue = data(response, "observation");
  if (!isRecord(observationValue)) return sampleResult("invalid", null, null);
  if (
    data(observationValue, "laneRef") !== binding.laneRef ||
    data(observationValue, "laneGeneration") !== binding.laneGeneration ||
    data(observationValue, "grantsWorkAuthority") !== false ||
    data(observationValue, "authorizesWorkDispatch") !== false
  ) {
    return sampleResult("invalid", null, null);
  }

  try {
    const observation: FirefoxChatGptActivityPanelObservationV1 = Object.freeze({
      confidence: exactEnum(
        data(observationValue, "confidence"),
        CONFIDENCE,
        "Firefox ChatGPT panel activity confidence",
      ),
      generation: exactEnum(
        data(observationValue, "generation"),
        BINARY_ACTIVITY,
        "Firefox ChatGPT panel generation activity",
      ),
      composer: exactEnum(
        data(observationValue, "composer"),
        COMPOSER,
        "Firefox ChatGPT panel composer state",
      ),
      composition: exactEnum(
        data(observationValue, "composition"),
        BINARY_ACTIVITY,
        "Firefox ChatGPT panel composition activity",
      ),
      modal: exactEnum(
        data(observationValue, "modal"),
        BINARY_ACTIVITY,
        "Firefox ChatGPT panel modal activity",
      ),
      mediaOrDevice: exactEnum(
        data(observationValue, "mediaOrDevice"),
        BINARY_ACTIVITY,
        "Firefox ChatGPT panel media/device activity",
      ),
      download: exactEnum(
        data(observationValue, "download"),
        BINARY_ACTIVITY,
        "Firefox ChatGPT panel download activity",
      ),
      otherTransient: exactEnum(
        data(observationValue, "otherTransient"),
        BINARY_ACTIVITY,
        "Firefox ChatGPT panel transient activity",
      ),
    });
    return sampleResult("sampled", binding, observation);
  } catch {
    return sampleResult("invalid", null, null);
  }
}

function bindingResult(
  status: FirefoxChatGptActivityPanelBindingResultV1["status"],
  binding: FirefoxChatGptActivityPanelBindingV1 | null,
): FirefoxChatGptActivityPanelBindingResultV1 {
  return Object.freeze({ status, binding });
}

function sampleResult(
  status: FirefoxChatGptActivityPanelSampleResultV1["status"],
  binding: FirefoxChatGptActivityPanelBindingV1 | null,
  observation: FirefoxChatGptActivityPanelObservationV1 | null,
): FirefoxChatGptActivityPanelSampleResultV1 {
  return Object.freeze({ status, binding, observation });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function data(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function boundedToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
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
