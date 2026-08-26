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

function exactEnvelope(value: unknown): FirefoxChatGptActivityResponseEnvelopeV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  let keys: (string | symbol)[];
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== 2 || !keys.includes("projectionRef") || !keys.includes("observation")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const projectionDescriptor = Object.getOwnPropertyDescriptor(record, "projectionRef");
  const observationDescriptor = Object.getOwnPropertyDescriptor(record, "observation");
  if (
    !projectionDescriptor || !("value" in projectionDescriptor) || !projectionDescriptor.enumerable ||
    !observationDescriptor || !("value" in observationDescriptor) || !observationDescriptor.enumerable
  ) {
    return null;
  }
  let projectionRef: string;
  try {
    projectionRef = parseFirefoxChatGptProjectionRefV1(projectionDescriptor.value);
  } catch {
    return null;
  }
  if (typeof observationDescriptor.value !== "object" || observationDescriptor.value === null) return null;
  return Object.freeze({
    projectionRef,
    observation: observationDescriptor.value as FirefoxChatGptLaneActivityObservationV1,
  });
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
    const tab = tabId(tabIdInput);
    return this.#projectionByTab.get(tab) ?? null;
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
