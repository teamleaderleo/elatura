// SPDX-License-Identifier: MPL-2.0
import {
  parseFirefoxChatGptLaneActivityTargetV1,
  type FirefoxChatGptLaneActivityObservationV1,
  type FirefoxChatGptLaneActivityTargetV1,
} from "./chatgpt-lane-activity-producer.js";

export const FIREFOX_CHATGPT_ACTIVITY_BINDING_VERSION = 1 as const;
export const DEFAULT_FIREFOX_ACTIVITY_BINDING_LIMIT = 64;
const MAX_BINDINGS = 256;
const PROJECTION_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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

export type FirefoxChatGptActivityBindingStatus =
  | "bound"
  | "observed"
  | "unbound"
  | "stale_generation"
  | "stale_projection"
  | "projection_in_use"
  | "response_mismatch"
  | "browser_error"
  | "capacity_exceeded";

export type FirefoxChatGptActivityBindingReceiptV1 = Readonly<{
  version: 1;
  laneRef: string;
  laneGeneration: number;
  status: FirefoxChatGptActivityBindingStatus;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptBoundActivityObservationV1 = Readonly<{
  receipt: FirefoxChatGptActivityBindingReceiptV1;
  observation: FirefoxChatGptLaneActivityObservationV1 | null;
}>;

export type FirefoxChatGptActivityResponseEnvelopeV1 = Readonly<{
  projectionRef: string;
  observation: FirefoxChatGptLaneActivityObservationV1;
}>;

type Binding = Readonly<{
  laneRef: string;
  laneGeneration: number;
  tabId: number;
  projectionRef: string;
}>;

function tabId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Firefox activity tab id is invalid");
  }
  return value;
}

export function parseFirefoxChatGptProjectionRefV1(value: unknown): string {
  if (typeof value !== "string" || !PROJECTION_REF.test(value)) {
    throw new TypeError("Firefox activity projection ref is invalid");
  }
  return value;
}

function receipt(
  target: FirefoxChatGptLaneActivityTargetV1,
  status: FirefoxChatGptActivityBindingStatus,
): FirefoxChatGptActivityBindingReceiptV1 {
  return Object.freeze({
    version: FIREFOX_CHATGPT_ACTIVITY_BINDING_VERSION,
    laneRef: target.laneRef,
    laneGeneration: target.laneGeneration,
    status,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function projectionKey(tab: number, ref: string): string {
  return `${tab}:${ref}`;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  const record = plainRecord(value);
  if (!record) return null;
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(record);
  } catch {
    return null;
  }
  const expected = new Set(expectedKeys);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    return null;
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
  }
  return record;
}

function data(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function exactObservation(value: unknown): FirefoxChatGptLaneActivityObservationV1 | null {
  const record = exactDataRecord(value, OBSERVATION_KEYS);
  if (!record) return null;
  const laneRef = data(record, "laneRef");
  const laneGeneration = data(record, "laneGeneration");
  let target: FirefoxChatGptLaneActivityTargetV1;
  try {
    target = parseFirefoxChatGptLaneActivityTargetV1({ laneRef, laneGeneration });
  } catch {
    return null;
  }
  const observedAtMs = data(record, "observedAtMs");
  const confidence = data(record, "confidence");
  const generation = data(record, "generation");
  const composer = data(record, "composer");
  const composition = data(record, "composition");
  const modal = data(record, "modal");
  const mediaOrDevice = data(record, "mediaOrDevice");
  if (
    data(record, "version") !== 1 ||
    typeof observedAtMs !== "number" ||
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs < 0 ||
    data(record, "source") !== "reviewed-live-sentinel" ||
    !oneOf(confidence, ["exact", "probable"] as const) ||
    !oneOf(generation, ["active", "inactive", "unknown"] as const) ||
    !oneOf(composer, ["clean", "dirty", "unknown"] as const) ||
    !oneOf(composition, ["active", "inactive"] as const) ||
    !oneOf(modal, ["active", "inactive"] as const) ||
    !oneOf(mediaOrDevice, ["active", "unknown"] as const) ||
    data(record, "download") !== "unknown" ||
    data(record, "otherTransient") !== "unknown" ||
    data(record, "grantsWorkAuthority") !== false ||
    data(record, "authorizesWorkDispatch") !== false
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    laneRef: target.laneRef,
    laneGeneration: target.laneGeneration,
    observedAtMs,
    source: "reviewed-live-sentinel",
    confidence,
    generation,
    composer,
    composition,
    modal,
    mediaOrDevice,
    download: "unknown",
    otherTransient: "unknown",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function exactEnvelope(value: unknown): FirefoxChatGptActivityResponseEnvelopeV1 | null {
  const record = exactDataRecord(value, ["projectionRef", "observation"]);
  if (!record) return null;
  let projectionRef: string;
  try {
    projectionRef = parseFirefoxChatGptProjectionRefV1(data(record, "projectionRef"));
  } catch {
    return null;
  }
  const observation = exactObservation(data(record, "observation"));
  return observation === null ? null : Object.freeze({ projectionRef, observation });
}

export class FirefoxChatGptActivityBindingRuntimeV1 {
  readonly #maxBindings: number;
  readonly #generationByLane = new Map<string, number>();
  readonly #bindingByLane = new Map<string, Binding>();
  readonly #projectionByTab = new Map<number, string>();
  readonly #laneByProjection = new Map<string, string>();

  constructor(maxBindings = DEFAULT_FIREFOX_ACTIVITY_BINDING_LIMIT) {
    if (!Number.isSafeInteger(maxBindings) || maxBindings < 1 || maxBindings > MAX_BINDINGS) {
      throw new RangeError("Firefox activity binding limit is invalid");
    }
    this.#maxBindings = maxBindings;
  }

  registerProjection(tabIdInput: unknown, projectionRefInput: unknown): void {
    const tab = tabId(tabIdInput);
    const ref = parseFirefoxChatGptProjectionRefV1(projectionRefInput);
    const prior = this.#projectionByTab.get(tab);
    if (prior === ref) return;
    if (prior !== undefined) {
      const owner = this.#laneByProjection.get(projectionKey(tab, prior));
      if (owner !== undefined) this.#dropBinding(owner);
    }
    this.#projectionByTab.set(tab, ref);
  }

  clearProjection(tabIdInput: unknown, projectionRefInput?: unknown): void {
    const tab = tabId(tabIdInput);
    const current = this.#projectionByTab.get(tab);
    if (current === undefined) return;
    if (projectionRefInput !== undefined) {
      const expected = parseFirefoxChatGptProjectionRefV1(projectionRefInput);
      if (current !== expected) return;
    }
    const owner = this.#laneByProjection.get(projectionKey(tab, current));
    if (owner !== undefined) this.#dropBinding(owner);
    this.#projectionByTab.delete(tab);
  }

  observeTarget(targetInput: unknown): FirefoxChatGptActivityBindingReceiptV1 {
    const target = parseFirefoxChatGptLaneActivityTargetV1(targetInput);
    const current = this.#generationByLane.get(target.laneRef);
    if (current !== undefined && target.laneGeneration < current) {
      return receipt(target, "stale_generation");
    }
    if (current === undefined && this.#generationByLane.size >= this.#maxBindings) {
      return receipt(target, "capacity_exceeded");
    }
    if (current === undefined || target.laneGeneration > current) {
      this.#dropBinding(target.laneRef);
      this.#generationByLane.set(target.laneRef, target.laneGeneration);
    }
    return receipt(target, "unbound");
  }

  bind(
    targetInput: unknown,
    tabIdInput: unknown,
    projectionRefInput: unknown,
  ): FirefoxChatGptActivityBindingReceiptV1 {
    const target = parseFirefoxChatGptLaneActivityTargetV1(targetInput);
    const tab = tabId(tabIdInput);
    const ref = parseFirefoxChatGptProjectionRefV1(projectionRefInput);
    const observed = this.observeTarget(target);
    if (observed.status === "stale_generation" || observed.status === "capacity_exceeded") {
      return observed;
    }
    if (this.#projectionByTab.get(tab) !== ref) return receipt(target, "stale_projection");
    const key = projectionKey(tab, ref);
    const projectionOwner = this.#laneByProjection.get(key);
    if (projectionOwner !== undefined && projectionOwner !== target.laneRef) {
      return receipt(target, "projection_in_use");
    }
    this.#dropBinding(target.laneRef);
    const binding = Object.freeze({
      laneRef: target.laneRef,
      laneGeneration: target.laneGeneration,
      tabId: tab,
      projectionRef: ref,
    });
    this.#bindingByLane.set(target.laneRef, binding);
    this.#laneByProjection.set(key, target.laneRef);
    return receipt(target, "bound");
  }

  currentProjection(tabIdInput: unknown): string | null {
    return this.#projectionByTab.get(tabId(tabIdInput)) ?? null;
  }

  async sample(
    targetInput: unknown,
    send: (
      tabId: number,
      projectionRef: string,
      target: FirefoxChatGptLaneActivityTargetV1,
    ) => Promise<unknown>,
  ): Promise<FirefoxChatGptBoundActivityObservationV1> {
    const target = parseFirefoxChatGptLaneActivityTargetV1(targetInput);
    const currentGeneration = this.#generationByLane.get(target.laneRef);
    if (currentGeneration !== target.laneGeneration) {
      return Object.freeze({ receipt: receipt(target, "stale_generation"), observation: null });
    }
    const binding = this.#bindingByLane.get(target.laneRef);
    if (!binding || binding.laneGeneration !== target.laneGeneration) {
      return Object.freeze({ receipt: receipt(target, "unbound"), observation: null });
    }
    if (this.#projectionByTab.get(binding.tabId) !== binding.projectionRef) {
      this.#dropBinding(target.laneRef);
      return Object.freeze({ receipt: receipt(target, "stale_projection"), observation: null });
    }
    let response: unknown;
    try {
      response = await send(binding.tabId, binding.projectionRef, target);
    } catch {
      return Object.freeze({ receipt: receipt(target, "browser_error"), observation: null });
    }
    const stillCurrent = this.#bindingByLane.get(target.laneRef);
    if (
      stillCurrent !== binding ||
      this.#generationByLane.get(target.laneRef) !== target.laneGeneration ||
      this.#projectionByTab.get(binding.tabId) !== binding.projectionRef
    ) {
      return Object.freeze({ receipt: receipt(target, "stale_projection"), observation: null });
    }
    const envelope = exactEnvelope(response);
    if (
      envelope === null ||
      envelope.projectionRef !== binding.projectionRef ||
      envelope.observation.laneRef !== target.laneRef ||
      envelope.observation.laneGeneration !== target.laneGeneration
    ) {
      return Object.freeze({ receipt: receipt(target, "response_mismatch"), observation: null });
    }
    return Object.freeze({
      receipt: receipt(target, "observed"),
      observation: envelope.observation,
    });
  }

  clear(): void {
    this.#generationByLane.clear();
    this.#bindingByLane.clear();
    this.#projectionByTab.clear();
    this.#laneByProjection.clear();
  }

  #dropBinding(laneRef: string): void {
    const prior = this.#bindingByLane.get(laneRef);
    if (!prior) return;
    this.#laneByProjection.delete(projectionKey(prior.tabId, prior.projectionRef));
    this.#bindingByLane.delete(laneRef);
  }
}
