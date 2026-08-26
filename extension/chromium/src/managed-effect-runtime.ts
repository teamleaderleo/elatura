// SPDX-License-Identifier: MPL-2.0
import {
  parseApplicationLaneDescriptorV1,
  type ApplicationLaneDescriptorV1,
} from "@elatura/core/application-lane";
import type { ApplicationLaneResidencyRequestV1 } from "@elatura/core/application-lane-lifecycle";
import type {
  BoundChromiumResidencyPlanV1,
  ChromiumBoundApplicationFactsV1,
} from "./binding.js";
import { ChromiumBindingRuntime } from "./binding-runtime.js";
import {
  createChromiumEffectRequestV1,
  matchChromiumEffectReceiptV1,
  parseChromiumEffectReceiptV1,
  type ChromiumEffectReceiptV1,
  type ChromiumEffectRequestV1,
} from "./effect.js";
import type { ChromiumProjection } from "./projection.js";

export const CHROMIUM_MANAGED_EFFECT_RUNTIME_VERSION = 1 as const;
export const DEFAULT_MAX_PENDING_CHROMIUM_MANAGED_EFFECTS = 64;
export const DEFAULT_MAX_CLAIMED_CHROMIUM_EFFECT_REFS = 4_096;
const MAX_PENDING_CHROMIUM_MANAGED_EFFECTS = 256;
const MAX_CLAIMED_CHROMIUM_EFFECT_REFS = 65_536;
const REQUEST_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const chromiumManagedEffectStatuses = [
  "issued",
  "accepted",
  "refused",
  "cancelled",
  "stale",
] as const;
export type ChromiumManagedEffectStatus =
  (typeof chromiumManagedEffectStatuses)[number];

export const chromiumManagedEffectReasons = [
  "effect-issued",
  "no-executable-effect",
  "request-ref-reused",
  "request-history-capacity",
  "lane-effect-in-flight",
  "pending-effect-capacity",
  "binding-not-current",
  "pending-effect-missing",
  "descriptor-mismatch",
  "receipt-mismatch",
  "stale-generation",
  "stale-projection",
  "receipt-accepted",
  "effect-cancelled",
] as const;
export type ChromiumManagedEffectReason =
  (typeof chromiumManagedEffectReasons)[number];

export type ChromiumManagedEffectResultV1 = Readonly<{
  version: typeof CHROMIUM_MANAGED_EFFECT_RUNTIME_VERSION;
  status: ChromiumManagedEffectStatus;
  reason: ChromiumManagedEffectReason;
  laneRef: string | null;
  laneGeneration: number | null;
  plan: BoundChromiumResidencyPlanV1 | null;
  request: ChromiumEffectRequestV1 | null;
  receipt: ChromiumEffectReceiptV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

type PendingEffect = Readonly<{
  laneRef: string;
  laneGeneration: number;
  projectionRef: string;
  tabId: number;
  plan: BoundChromiumResidencyPlanV1;
  request: ChromiumEffectRequestV1;
}>;

/**
 * Volatile owner of in-flight managed Chromium residency effects.
 *
 * The binding runtime owns which lane/projection association is current. This
 * runtime owns only effect issuance/correlation across that currentness window.
 * Browser execution remains in #147's service-worker path.
 */
export class ChromiumManagedEffectRuntime {
  readonly maxPendingEffects: number;
  readonly maxClaimedRequestRefs: number;

  #bindings: ChromiumBindingRuntime;
  #pendingByRequest = new Map<string, PendingEffect>();
  #requestByLane = new Map<string, string>();
  #claimedRequestRefs = new Set<string>();

  constructor(
    bindings: ChromiumBindingRuntime,
    maxPendingEffectsInput: unknown = DEFAULT_MAX_PENDING_CHROMIUM_MANAGED_EFFECTS,
    maxClaimedRequestRefsInput: unknown = DEFAULT_MAX_CLAIMED_CHROMIUM_EFFECT_REFS,
  ) {
    if (!(bindings instanceof ChromiumBindingRuntime)) {
      throw new TypeError("Chromium managed effect runtime requires a binding runtime");
    }
    const maxPendingEffects = boundedPositiveInteger(
      maxPendingEffectsInput,
      "Maximum pending Chromium managed effects",
      MAX_PENDING_CHROMIUM_MANAGED_EFFECTS,
    );
    const maxClaimedRequestRefs = boundedPositiveInteger(
      maxClaimedRequestRefsInput,
      "Maximum claimed Chromium effect request references",
      MAX_CLAIMED_CHROMIUM_EFFECT_REFS,
    );
    if (maxClaimedRequestRefs < maxPendingEffects) {
      throw new RangeError(
        "Claimed Chromium effect request-reference capacity must cover pending-effect capacity",
      );
    }
    this.#bindings = bindings;
    this.maxPendingEffects = maxPendingEffects;
    this.maxClaimedRequestRefs = maxClaimedRequestRefs;
  }

  get pendingEffectCount(): number {
    return this.#pendingByRequest.size;
  }

  get claimedRequestRefCount(): number {
    return this.#claimedRequestRefs.size;
  }

  /**
   * Issue one browser-local effect request only from #148's retained current
   * binding and #144's executable generation-bound plan.
   */
  begin(
    descriptorInput: unknown,
    projection: ChromiumProjection,
    residencyRequest: ApplicationLaneResidencyRequestV1,
    applicationFacts: ChromiumBoundApplicationFactsV1,
    requestRefInput: unknown,
  ): ChromiumManagedEffectResultV1 {
    const descriptor = canonicalDescriptor(descriptorInput);
    const requestRef = requestReference(requestRefInput);
    if (this.#claimedRequestRefs.has(requestRef)) {
      return result(
        "refused",
        "request-ref-reused",
        descriptor,
        null,
        null,
        null,
      );
    }

    const planned = this.#bindings.planCurrent(
      descriptor,
      projection,
      residencyRequest,
      applicationFacts,
    );
    if (planned.status !== "planned" || planned.plan === null || planned.binding === null) {
      if (
        planned.reason === "generation-advanced-unbound" ||
        planned.reason === "binding-missing"
      ) {
        this.#dropPendingForLane(descriptor.laneRef);
      }
      return result(
        planned.reason === "stale-generation" ? "stale" : "refused",
        planned.reason === "stale-generation"
          ? "stale-generation"
          : "binding-not-current",
        descriptor,
        null,
        null,
        null,
      );
    }

    const previousRequestRef = this.#requestByLane.get(descriptor.laneRef);
    if (previousRequestRef !== undefined) {
      const previous = this.#pendingByRequest.get(previousRequestRef);
      if (
        previous !== undefined &&
        previous.laneGeneration === descriptor.generation &&
        previous.projectionRef === planned.binding.projectionRef &&
        previous.tabId === planned.binding.tabId
      ) {
        return result(
          "refused",
          "lane-effect-in-flight",
          descriptor,
          previous.plan,
          previous.request,
          null,
        );
      }
      this.#dropPending(previousRequestRef);
    }

    const effectRequest = createChromiumEffectRequestV1(
      planned.plan,
      projection,
      requestRef,
    );
    if (effectRequest === null) {
      return result(
        "refused",
        "no-executable-effect",
        descriptor,
        planned.plan,
        null,
        null,
      );
    }
    if (this.#pendingByRequest.size >= this.maxPendingEffects) {
      return result(
        "refused",
        "pending-effect-capacity",
        descriptor,
        planned.plan,
        null,
        null,
      );
    }
    if (this.#claimedRequestRefs.size >= this.maxClaimedRequestRefs) {
      return result(
        "refused",
        "request-history-capacity",
        descriptor,
        planned.plan,
        null,
        null,
      );
    }

    const pending: PendingEffect = Object.freeze({
      laneRef: descriptor.laneRef,
      laneGeneration: descriptor.generation,
      projectionRef: effectRequest.projectionRef,
      tabId: effectRequest.tabId,
      plan: planned.plan,
      request: effectRequest,
    });
    this.#pendingByRequest.set(requestRef, pending);
    this.#requestByLane.set(descriptor.laneRef, requestRef);
    this.#claimedRequestRefs.add(requestRef);
    return result(
      "issued",
      "effect-issued",
      descriptor,
      pending.plan,
      pending.request,
      null,
    );
  }

  /**
   * Admit one untrusted browser receipt only while the issued lane generation
   * and projection remain current in #148.
   */
  acceptReceipt(
    descriptorInput: unknown,
    receiptInput: unknown,
  ): ChromiumManagedEffectResultV1 {
    const descriptor = canonicalDescriptor(descriptorInput);
    const receipt = safeReceipt(receiptInput);
    const pending = this.#pendingByRequest.get(receipt.requestRef);
    if (pending === undefined) {
      return result(
        "refused",
        "pending-effect-missing",
        descriptor,
        null,
        null,
        null,
      );
    }

    if (!matchChromiumEffectReceiptV1(pending.request, receipt).matched) {
      return result(
        "refused",
        "receipt-mismatch",
        descriptor,
        pending.plan,
        pending.request,
        null,
      );
    }
    if (descriptor.laneRef !== pending.laneRef) {
      return result(
        "refused",
        "descriptor-mismatch",
        descriptor,
        pending.plan,
        pending.request,
        null,
      );
    }
    if (descriptor.generation < pending.laneGeneration) {
      return result(
        "refused",
        "descriptor-mismatch",
        descriptor,
        pending.plan,
        pending.request,
        null,
      );
    }
    if (descriptor.generation > pending.laneGeneration) {
      this.#bindings.observeDescriptor(descriptor);
      this.#dropPending(receipt.requestRef);
      return result(
        "stale",
        "stale-generation",
        descriptor,
        pending.plan,
        pending.request,
        null,
      );
    }

    const observed = this.#bindings.observeDescriptor(descriptor);
    if (observed.reason === "stale-generation") {
      this.#dropPending(receipt.requestRef);
      return result(
        "stale",
        "stale-generation",
        descriptor,
        pending.plan,
        pending.request,
        null,
      );
    }
    const current = this.#bindings.currentBinding(descriptor);
    if (
      current === null ||
      current.projectionRef !== pending.projectionRef ||
      current.tabId !== pending.tabId
    ) {
      this.#dropPending(receipt.requestRef);
      return result(
        "stale",
        "stale-projection",
        descriptor,
        pending.plan,
        pending.request,
        null,
      );
    }

    this.#dropPending(receipt.requestRef);
    return result(
      "accepted",
      "receipt-accepted",
      descriptor,
      pending.plan,
      pending.request,
      receipt,
    );
  }

  cancel(requestRefInput: unknown): ChromiumManagedEffectResultV1 {
    const requestRef = requestReference(requestRefInput);
    const pending = this.#pendingByRequest.get(requestRef);
    if (pending === undefined) {
      return Object.freeze({
        version: CHROMIUM_MANAGED_EFFECT_RUNTIME_VERSION,
        status: "refused",
        reason: "pending-effect-missing",
        laneRef: null,
        laneGeneration: null,
        plan: null,
        request: null,
        receipt: null,
        grantsWorkAuthority: false,
        authorizesWorkDispatch: false,
      });
    }
    this.#dropPending(requestRef);
    return Object.freeze({
      version: CHROMIUM_MANAGED_EFFECT_RUNTIME_VERSION,
      status: "cancelled",
      reason: "effect-cancelled",
      laneRef: pending.laneRef,
      laneGeneration: pending.laneGeneration,
      plan: pending.plan,
      request: pending.request,
      receipt: null,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  }

  /**
   * Cancel every in-flight effect. Claimed request refs remain reserved for the
   * lifetime of this runtime so a late old receipt cannot match a reused ref.
   */
  clear(): void {
    this.#pendingByRequest.clear();
    this.#requestByLane.clear();
  }

  #dropPendingForLane(laneRef: string): void {
    const requestRef = this.#requestByLane.get(laneRef);
    if (requestRef !== undefined) this.#dropPending(requestRef);
  }

  #dropPending(requestRef: string): void {
    const pending = this.#pendingByRequest.get(requestRef);
    if (pending === undefined) return;
    this.#pendingByRequest.delete(requestRef);
    if (this.#requestByLane.get(pending.laneRef) === requestRef) {
      this.#requestByLane.delete(pending.laneRef);
    }
  }
}

function result(
  status: ChromiumManagedEffectStatus,
  reason: ChromiumManagedEffectReason,
  descriptor: ApplicationLaneDescriptorV1,
  plan: BoundChromiumResidencyPlanV1 | null,
  request: ChromiumEffectRequestV1 | null,
  receipt: ChromiumEffectReceiptV1 | null,
): ChromiumManagedEffectResultV1 {
  return Object.freeze({
    version: CHROMIUM_MANAGED_EFFECT_RUNTIME_VERSION,
    status,
    reason,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    plan,
    request,
    receipt,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function canonicalDescriptor(value: unknown): ApplicationLaneDescriptorV1 {
  try {
    return parseApplicationLaneDescriptorV1(value);
  } catch {
    throw new TypeError("Chromium managed effect descriptor is invalid");
  }
}

function safeReceipt(value: unknown): ChromiumEffectReceiptV1 {
  try {
    return parseChromiumEffectReceiptV1(value);
  } catch {
    throw new TypeError("Chromium managed effect receipt is invalid");
  }
}

function requestReference(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_REF.test(value)) {
    throw new TypeError("Chromium managed effect request reference is invalid");
  }
  return value;
}

function boundedPositiveInteger(value: unknown, label: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a positive safe integer at most ${maximum}`);
  }
  return value;
}
