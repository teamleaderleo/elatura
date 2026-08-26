// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import { serializeBoundedJson } from "./resource-accounting.js";

export const APPLICATION_LANE_PROTOCOL_VERSION = 1 as const;

export const applicationLaneCapabilities = ["events", "observe", "activate", "screenshot"] as const;
export type ApplicationLaneCapability = typeof applicationLaneCapabilities[number];

export const applicationLaneStates = [
  "active",
  "parked",
  "unavailable",
  "drifted",
  "recovery_needed",
] as const;
export type ApplicationLaneState = typeof applicationLaneStates[number];

export const applicationLaneEventTypes = [
  "changed",
  "generating",
  "idle",
  "possible_completion",
  "error",
  "drifted",
  "discarded_or_unavailable",
  "recovery_needed",
  "available",
] as const;
export type ApplicationLaneEventType = typeof applicationLaneEventTypes[number];

export const applicationLaneOperations = ["status", "observe", "activate", "screenshot"] as const;
export type ApplicationLaneOperation = typeof applicationLaneOperations[number];

export const applicationLaneOutcomes = [
  "ok",
  "unavailable",
  "drifted",
  "recovery_needed",
  "unsupported",
] as const;
export type ApplicationLaneOutcome = typeof applicationLaneOutcomes[number];

export type ApplicationLaneDescriptorV1 = Readonly<{
  version: 1;
  laneRef: string;
  generation: number;
  adapter: AdapterIdentity;
  capabilities: readonly ApplicationLaneCapability[];
  state: ApplicationLaneState;
  observedAt: string;
}>;

export type ApplicationLaneEventV1 = Readonly<{
  version: 1;
  eventId: string;
  laneRef: string;
  laneGeneration: number;
  eventType: ApplicationLaneEventType;
  observedAt: string;
  confidence: "exact" | "probable" | "unknown";
  freshness: "fresh" | "stale" | "unknown";
  sourceRefs: readonly string[];
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type ApplicationLaneObservationBudgetV1 = Readonly<{
  maxItems: number;
  maxTextCodeUnits: number;
  maxSerializedBytes: number;
}>;

export type ApplicationLaneRequestV1 = Readonly<{
  version: 1;
  requestId: string;
  laneRef: string;
  laneGeneration: number;
  operation: ApplicationLaneOperation;
  payload: Readonly<Record<string, never>> | ApplicationLaneObservationBudgetV1;
}>;

export type ApplicationLaneObservationV1 = Readonly<{
  observationRef: string;
  freshness: "fresh" | "stale" | "unknown";
  contentType: string;
  content: unknown;
  omitted: boolean;
  sourceRefs: readonly string[];
}>;

export type ApplicationLaneActivationReceiptV1 = Readonly<{ receiptRef: string }>;
export type ApplicationLaneScreenshotReceiptV1 = Readonly<{
  screenshotRef: string;
  mediaType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}>;

export type ApplicationLaneResponsePayloadV1 =
  | ApplicationLaneDescriptorV1
  | ApplicationLaneObservationV1
  | ApplicationLaneActivationReceiptV1
  | ApplicationLaneScreenshotReceiptV1
  | null;

export type ApplicationLaneResponseV1 = Readonly<{
  version: 1;
  requestId: string;
  laneRef: string;
  laneGeneration: number;
  operation: ApplicationLaneOperation;
  outcome: ApplicationLaneOutcome;
  state: ApplicationLaneState;
  observedAt: string;
  payload: ApplicationLaneResponsePayloadV1;
  sourceRefs: readonly string[];
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

const MAX_IDENTIFIER = 240;
const MAX_ADAPTER_TOKEN = 128;
const MAX_SOURCE_REFS = 32;
const MAX_SOURCE_REF = 2_048;
const MAX_CONTENT_TYPE = 160;
const MAX_OBSERVATION_ITEMS = 256;
const MAX_OBSERVATION_TEXT_CODE_UNITS = 1_048_576;
const MAX_OBSERVATION_SERIALIZED_BYTES = 2_097_152;
const MAX_SCREENSHOT_DIMENSION = 16_384;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/u;
const ADAPTER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const CONTENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9.+/-]*$/u;
const unsafeTextPattern = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;
const credentialPattern = /(?:github_pat_|gh[pousr]_|sk-(?:proj-)?|Bearer\s+)[A-Za-z0-9._~+\/-]+/iu;

export function parseApplicationLaneDescriptorV1(value: unknown): ApplicationLaneDescriptorV1 {
  const input = record(value, "Application lane descriptor", [
    "version", "laneRef", "generation", "adapter", "capabilities", "state", "observedAt",
  ]);
  version(input.version);
  return freeze({
    version: 1 as const,
    laneRef: identifier(input.laneRef, "Lane reference"),
    generation: positiveInteger(input.generation, "Lane generation"),
    adapter: adapterIdentity(input.adapter),
    capabilities: enumList(input.capabilities, applicationLaneCapabilities, "Lane capability"),
    state: exactEnum(input.state, applicationLaneStates, "Lane state"),
    observedAt: timestamp(input.observedAt, "Lane observation time"),
  });
}

export function parseApplicationLaneEventV1(value: unknown): ApplicationLaneEventV1 {
  const input = record(value, "Application lane event", [
    "version", "eventId", "laneRef", "laneGeneration", "eventType", "observedAt",
    "confidence", "freshness", "sourceRefs", "grantsWorkAuthority", "authorizesWorkDispatch",
  ]);
  version(input.version);
  if (input.grantsWorkAuthority !== false) throw new TypeError("Application lane events must grant zero work authority");
  if (input.authorizesWorkDispatch !== false) throw new TypeError("Application lane events must authorize zero work dispatch");
  return freeze({
    version: 1 as const,
    eventId: identifier(input.eventId, "Lane event ID"),
    laneRef: identifier(input.laneRef, "Lane reference"),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    eventType: exactEnum(input.eventType, applicationLaneEventTypes, "Lane event type"),
    observedAt: timestamp(input.observedAt, "Lane event observation time"),
    confidence: exactEnum(input.confidence, ["exact", "probable", "unknown"] as const, "Lane event confidence"),
    freshness: exactEnum(input.freshness, ["fresh", "stale", "unknown"] as const, "Lane event freshness"),
    sourceRefs: references(input.sourceRefs),
    grantsWorkAuthority: false as const,
    authorizesWorkDispatch: false as const,
  });
}

export function parseApplicationLaneRequestV1(value: unknown): ApplicationLaneRequestV1 {
  const input = record(value, "Application lane request", [
    "version", "requestId", "laneRef", "laneGeneration", "operation", "payload",
  ]);
  version(input.version);
  const operation = exactEnum(input.operation, applicationLaneOperations, "Lane operation");
  return freeze({
    version: 1 as const,
    requestId: identifier(input.requestId, "Lane request ID"),
    laneRef: identifier(input.laneRef, "Lane reference"),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    operation,
    payload: operation === "observe" ? observationBudget(input.payload) : emptyPayload(input.payload, `${operation} request payload`),
  });
}

export function parseApplicationLaneResponseV1(value: unknown): ApplicationLaneResponseV1 {
  const input = record(value, "Application lane response", [
    "version", "requestId", "laneRef", "laneGeneration", "operation", "outcome", "state",
    "observedAt", "payload", "sourceRefs", "grantsWorkAuthority", "authorizesWorkDispatch",
  ]);
  version(input.version);
  if (input.grantsWorkAuthority !== false) throw new TypeError("Application lane responses must grant zero work authority");
  if (input.authorizesWorkDispatch !== false) throw new TypeError("Application lane responses must authorize zero work dispatch");
  const operation = exactEnum(input.operation, applicationLaneOperations, "Lane operation");
  const outcome = exactEnum(input.outcome, applicationLaneOutcomes, "Lane outcome");
  return freeze({
    version: 1 as const,
    requestId: identifier(input.requestId, "Lane request ID"),
    laneRef: identifier(input.laneRef, "Lane reference"),
    laneGeneration: positiveInteger(input.laneGeneration, "Lane generation"),
    operation,
    outcome,
    state: exactEnum(input.state, applicationLaneStates, "Lane state"),
    observedAt: timestamp(input.observedAt, "Lane response observation time"),
    payload: outcome === "ok" ? successPayload(operation, input.payload) : nullPayload(input.payload),
    sourceRefs: references(input.sourceRefs),
    grantsWorkAuthority: false as const,
    authorizesWorkDispatch: false as const,
  });
}

function successPayload(operation: ApplicationLaneOperation, value: unknown): ApplicationLaneResponsePayloadV1 {
  if (operation === "status") return parseApplicationLaneDescriptorV1(value);
  if (operation === "observe") return observation(value);
  if (operation === "activate") {
    const input = record(value, "Application lane activation receipt", ["receiptRef"]);
    return freeze({ receiptRef: identifier(input.receiptRef, "Activation receipt reference") });
  }
  const input = record(value, "Application lane screenshot receipt", ["screenshotRef", "mediaType", "width", "height"]);
  return freeze({
    screenshotRef: identifier(input.screenshotRef, "Screenshot reference"),
    mediaType: exactEnum(input.mediaType, ["image/png", "image/jpeg"] as const, "Screenshot media type"),
    width: boundedPositiveInteger(input.width, "Screenshot width", MAX_SCREENSHOT_DIMENSION),
    height: boundedPositiveInteger(input.height, "Screenshot height", MAX_SCREENSHOT_DIMENSION),
  });
}

function observation(value: unknown): ApplicationLaneObservationV1 {
  const input = record(value, "Application lane observation", [
    "observationRef", "freshness", "contentType", "content", "omitted", "sourceRefs",
  ]);
  const serialized = serializeBoundedJson(input.content, {
    maxDepth: 32,
    maxNodes: 10_000,
    maxStringCodeUnits: MAX_OBSERVATION_TEXT_CODE_UNITS,
    maxSerializedBytes: MAX_OBSERVATION_SERIALIZED_BYTES,
  });
  if (!serialized.ok) throw new TypeError(`Application lane observation content is invalid: ${serialized.issues[0]?.message ?? "bounded JSON rejected"}`);
  const content: unknown = JSON.parse(serialized.value.serialized);
  return freeze({
    observationRef: identifier(input.observationRef, "Observation reference"),
    freshness: exactEnum(input.freshness, ["fresh", "stale", "unknown"] as const, "Observation freshness"),
    contentType: patternText(input.contentType, "Observation content type", CONTENT_TYPE, MAX_CONTENT_TYPE),
    content,
    omitted: booleanValue(input.omitted, "Observation omitted flag"),
    sourceRefs: references(input.sourceRefs),
  });
}

function observationBudget(value: unknown): ApplicationLaneObservationBudgetV1 {
  const input = record(value, "Application lane observation budget", ["maxItems", "maxTextCodeUnits", "maxSerializedBytes"]);
  return freeze({
    maxItems: boundedPositiveInteger(input.maxItems, "Observation max items", MAX_OBSERVATION_ITEMS),
    maxTextCodeUnits: boundedPositiveInteger(input.maxTextCodeUnits, "Observation max text code units", MAX_OBSERVATION_TEXT_CODE_UNITS),
    maxSerializedBytes: boundedPositiveInteger(input.maxSerializedBytes, "Observation max serialized bytes", MAX_OBSERVATION_SERIALIZED_BYTES),
  });
}

function adapterIdentity(value: unknown): AdapterIdentity {
  const input = record(value, "Application adapter identity", ["id", "version"]);
  return freeze({
    id: patternText(input.id, "Adapter ID", ADAPTER_TOKEN, MAX_ADAPTER_TOKEN),
    version: patternText(input.version, "Adapter version", ADAPTER_TOKEN, MAX_ADAPTER_TOKEN),
  });
}

function references(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError("Lane source references must be an array");
  if (value.length > MAX_SOURCE_REFS) throw new RangeError(`Lane source references exceed ${MAX_SOURCE_REFS} entries`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("Lane source references must be dense data");
    output.push(identifier(descriptor.value, `Lane source reference ${index + 1}`, MAX_SOURCE_REF));
  }
  if (new Set(output).size !== output.length) throw new RangeError("Lane source references must not contain duplicates");
  output.sort(compareCodeUnits);
  return Object.freeze(output);
}

function enumList<const Values extends readonly string[]>(value: unknown, values: Values, label: string): readonly Values[number][] {
  if (!Array.isArray(value)) throw new TypeError(`${label} list must be an array`);
  if (value.length < 1 || value.length > values.length) throw new RangeError(`${label} list must contain between 1 and ${values.length} entries`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Values[number][] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} list must be dense data`);
    output.push(exactEnum(descriptor.value, values, `${label} ${index + 1}`));
  }
  if (new Set(output).size !== output.length) throw new RangeError(`${label} list must not contain duplicates`);
  output.sort(compareCodeUnits);
  return Object.freeze(output);
}

function record(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${label} contains symbol decoration`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label} must contain enumerable data properties`);
    if (!keys.includes(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
    output[key] = descriptor.value;
  }
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(output, key)) throw new TypeError(`${label} is missing required field ${key}`);
  return output;
}

function emptyPayload(value: unknown, label: string): Readonly<Record<string, never>> {
  record(value, label, []);
  return Object.freeze({});
}

function nullPayload(value: unknown): null {
  if (value !== null) throw new TypeError("Unsuccessful lane response payload must be null");
  return null;
}

function version(value: unknown): void {
  if (value !== APPLICATION_LANE_PROTOCOL_VERSION) throw new TypeError(`Application lane protocol version must be ${APPLICATION_LANE_PROTOCOL_VERSION}`);
}

function identifier(value: unknown, label: string, maximum = MAX_IDENTIFIER): string {
  return patternText(value, label, IDENTIFIER, maximum);
}

function patternText(value: unknown, label: string, pattern: RegExp, maximum: number): string {
  const text = boundedText(value, label, maximum);
  if (!pattern.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} is required`);
  if (text.length > maximum) throw new RangeError(`${label} exceeds ${maximum} characters`);
  if (unsafeTextPattern.test(text)) throw new TypeError(`${label} contains unsafe text`);
  if (credentialPattern.test(text)) throw new TypeError(`${label} must not contain credential-shaped text`);
  return text;
}

function positiveInteger(value: unknown, label: string): number {
  return boundedPositiveInteger(value, label, Number.MAX_SAFE_INTEGER);
}

function boundedPositiveInteger(value: unknown, label: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`${label} must be a positive safe integer at most ${maximum}`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const text = boundedText(value, label, 80);
  const millis = Date.parse(text);
  if (!Number.isFinite(millis)) throw new TypeError(`${label} must be a valid timestamp`);
  return new Date(millis).toISOString();
}

function exactEnum<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new TypeError(`${label} is invalid`);
  return value as Values[number];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child, seen);
  return Object.freeze(value);
}
