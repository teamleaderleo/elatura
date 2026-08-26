// SPDX-License-Identifier: MPL-2.0
import {
  parseApplicationLaneDescriptorV1,
  type ApplicationLaneDescriptorV1,
} from "@elatura/core/application-lane";
import type { ApplicationLaneResidencyRequestV1 } from "@elatura/core/application-lane-lifecycle";
import {
  createChromiumLaneBindingV1,
  planBoundChromiumResidencyV1,
  type BoundChromiumResidencyPlanV1,
  type ChromiumBoundApplicationFactsV1,
  type ChromiumLaneBindingV1,
} from "./binding.js";
import type { ChromiumProjection } from "./projection.js";

export const CHROMIUM_BINDING_RUNTIME_VERSION = 1 as const;
export const DEFAULT_MAX_CHROMIUM_BINDING_RUNTIME_LANES = 64;
const MAX_CHROMIUM_BINDING_RUNTIME_LANES = 256;
const PROJECTION_REF = /^chrome-session-tab-(?:0|[1-9][0-9]*)$/u;

export const chromiumBindingRuntimeStatuses = ["bound", "rebound", "observed", "planned", "refused"] as const;
export type ChromiumBindingRuntimeStatus = (typeof chromiumBindingRuntimeStatuses)[number];

export const chromiumBindingRuntimeReasons = [
  "binding-created",
  "binding-current",
  "binding-missing",
  "binding-capacity",
  "projection-collision",
  "projection-rebind-required",
  "old-projection-mismatch",
  "projection-rebound",
  "generation-advanced-unbound",
  "stale-generation",
  "projection-mismatch",
  "plan-ready",
] as const;
export type ChromiumBindingRuntimeReason = (typeof chromiumBindingRuntimeReasons)[number];

export type ChromiumBindingRuntimeReceiptV1 = Readonly<{
  version: typeof CHROMIUM_BINDING_RUNTIME_VERSION;
  status: ChromiumBindingRuntimeStatus;
  reason: ChromiumBindingRuntimeReason;
  laneRef: string;
  laneGeneration: number;
  binding: ChromiumLaneBindingV1 | null;
  plan: BoundChromiumResidencyPlanV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

type LaneState = {
  generation: number;
  binding: ChromiumLaneBindingV1 | null;
};

/**
 * Volatile owner of which #144 Chromium binding is current.
 *
 * This runtime deliberately keeps zero browser/profile/content state beyond the
 * already-private binding value. Service-worker/runtime restart clears the map
 * and therefore removes all managed-effect planning authority until rebind.
 */
export class ChromiumBindingRuntime {
  readonly maxTrackedLanes: number;
  #lanes = new Map<string, LaneState>();
  #projectionOwners = new Map<string, string>();

  constructor(
    maxTrackedLanesInput: unknown = DEFAULT_MAX_CHROMIUM_BINDING_RUNTIME_LANES,
  ) {
    this.maxTrackedLanes = boundedPositiveInteger(
      maxTrackedLanesInput,
      "Maximum Chromium binding runtime lanes",
      MAX_CHROMIUM_BINDING_RUNTIME_LANES,
    );
  }

  get trackedLaneCount(): number {
    return this.#lanes.size;
  }

  get activeBindingCount(): number {
    return this.#projectionOwners.size;
  }

  bind(
    descriptorInput: unknown,
    projection: ChromiumProjection,
  ): ChromiumBindingRuntimeReceiptV1 {
    const descriptor = canonicalDescriptor(descriptorInput);
    const candidate = safeCreateBinding(descriptor, projection);
    const existing = this.#lanes.get(descriptor.laneRef);

    if (existing === undefined) {
      if (this.#lanes.size >= this.maxTrackedLanes) {
        return receipt(descriptor, "refused", "binding-capacity", null, null);
      }
      if (this.#projectionOwners.has(candidate.projectionRef)) {
        return receipt(descriptor, "refused", "projection-collision", null, null);
      }
      this.#lanes.set(descriptor.laneRef, {
        generation: descriptor.generation,
        binding: candidate,
      });
      this.#projectionOwners.set(candidate.projectionRef, descriptor.laneRef);
      return receipt(descriptor, "bound", "binding-created", candidate, null);
    }

    if (descriptor.generation < existing.generation) {
      return receipt(descriptor, "refused", "stale-generation", null, null);
    }

    if (descriptor.generation > existing.generation) {
      this.#advance(existing, descriptor.generation);
      const owner = this.#projectionOwners.get(candidate.projectionRef);
      if (owner !== undefined && owner !== descriptor.laneRef) {
        return receipt(descriptor, "refused", "projection-collision", null, null);
      }
      existing.binding = candidate;
      this.#projectionOwners.set(candidate.projectionRef, descriptor.laneRef);
      return receipt(descriptor, "rebound", "binding-created", candidate, null);
    }

    if (existing.binding === null) {
      const owner = this.#projectionOwners.get(candidate.projectionRef);
      if (owner !== undefined && owner !== descriptor.laneRef) {
        return receipt(descriptor, "refused", "projection-collision", null, null);
      }
      existing.binding = candidate;
      this.#projectionOwners.set(candidate.projectionRef, descriptor.laneRef);
      return receipt(descriptor, "bound", "binding-created", candidate, null);
    }

    if (
      existing.binding.projectionRef === candidate.projectionRef &&
      existing.binding.tabId === candidate.tabId
    ) {
      return receipt(descriptor, "observed", "binding-current", existing.binding, null);
    }
    return receipt(
      descriptor,
      "refused",
      "projection-rebind-required",
      existing.binding,
      null,
    );
  }

  /**
   * Replace one same-generation projection. A higher generation observed here
   * invalidates the prior generation and intentionally stays unbound; generation
   * changes must use bind() with a newly proven projection.
   */
  rebindProjection(
    descriptorInput: unknown,
    oldProjectionRefInput: unknown,
    projection: ChromiumProjection,
  ): ChromiumBindingRuntimeReceiptV1 {
    const descriptor = canonicalDescriptor(descriptorInput);
    const oldProjectionRef = projectionReference(oldProjectionRefInput);
    const candidate = safeCreateBinding(descriptor, projection);
    const existing = this.#lanes.get(descriptor.laneRef);
    if (existing === undefined) {
      return receipt(descriptor, "refused", "binding-missing", null, null);
    }
    if (descriptor.generation < existing.generation) {
      return receipt(descriptor, "refused", "stale-generation", null, null);
    }
    if (descriptor.generation > existing.generation) {
      this.#advance(existing, descriptor.generation);
      return receipt(descriptor, "refused", "generation-advanced-unbound", null, null);
    }
    if (existing.binding === null) {
      return receipt(descriptor, "refused", "binding-missing", null, null);
    }
    if (existing.binding.projectionRef !== oldProjectionRef) {
      return receipt(
        descriptor,
        "refused",
        "old-projection-mismatch",
        existing.binding,
        null,
      );
    }
    if (
      existing.binding.projectionRef === candidate.projectionRef &&
      existing.binding.tabId === candidate.tabId
    ) {
      return receipt(descriptor, "observed", "binding-current", existing.binding, null);
    }
    const owner = this.#projectionOwners.get(candidate.projectionRef);
    if (owner !== undefined && owner !== descriptor.laneRef) {
      return receipt(descriptor, "refused", "projection-collision", existing.binding, null);
    }

    this.#projectionOwners.delete(existing.binding.projectionRef);
    existing.binding = candidate;
    this.#projectionOwners.set(candidate.projectionRef, descriptor.laneRef);
    return receipt(descriptor, "rebound", "projection-rebound", candidate, null);
  }

  /**
   * Observe canonical generation truth without supplying a projection. A newer
   * descriptor is enough to revoke the older browser binding immediately. An
   * unbound lane still retains the highest seen generation as a tombstone so a
   * later stale generation cannot gain authority simply because no binding had
   * existed yet.
   */
  observeDescriptor(descriptorInput: unknown): ChromiumBindingRuntimeReceiptV1 {
    const descriptor = canonicalDescriptor(descriptorInput);
    const existing = this.#lanes.get(descriptor.laneRef);
    if (existing === undefined) {
      if (this.#lanes.size >= this.maxTrackedLanes) {
        return receipt(descriptor, "refused", "binding-capacity", null, null);
      }
      this.#lanes.set(descriptor.laneRef, {
        generation: descriptor.generation,
        binding: null,
      });
      return receipt(descriptor, "observed", "binding-missing", null, null);
    }
    if (descriptor.generation < existing.generation) {
      return receipt(descriptor, "refused", "stale-generation", null, null);
    }
    if (descriptor.generation > existing.generation) {
      this.#advance(existing, descriptor.generation);
      return receipt(
        descriptor,
        "observed",
        "generation-advanced-unbound",
        null,
        null,
      );
    }
    return existing.binding === null
      ? receipt(descriptor, "observed", "binding-missing", null, null)
      : receipt(descriptor, "observed", "binding-current", existing.binding, null);
  }

  /**
   * Plan only through the binding retained as current by this runtime. Historical
   * detached ChromiumLaneBindingV1 values are deliberately absent from this API.
   */
  planCurrent(
    descriptorInput: unknown,
    projection: ChromiumProjection,
    request: ApplicationLaneResidencyRequestV1,
    applicationFacts: ChromiumBoundApplicationFactsV1,
  ): ChromiumBindingRuntimeReceiptV1 {
    const descriptor = canonicalDescriptor(descriptorInput);
    // Build/validate the supplied projection binding before generation state can
    // change. Browser-host projection objects are local, yet fixed failure keeps
    // a future accidental hostile caller from partially revoking currentness.
    const currentProjectionBinding = safeCreateBinding(descriptor, projection);
    const existing = this.#lanes.get(descriptor.laneRef);
    if (existing === undefined) {
      if (this.#lanes.size >= this.maxTrackedLanes) {
        return receipt(descriptor, "refused", "binding-capacity", null, null);
      }
      this.#lanes.set(descriptor.laneRef, {
        generation: descriptor.generation,
        binding: null,
      });
      return receipt(descriptor, "refused", "binding-missing", null, null);
    }
    if (descriptor.generation < existing.generation) {
      return receipt(descriptor, "refused", "stale-generation", null, null);
    }
    if (descriptor.generation > existing.generation) {
      this.#advance(existing, descriptor.generation);
      return receipt(
        descriptor,
        "refused",
        "generation-advanced-unbound",
        null,
        null,
      );
    }
    if (existing.binding === null) {
      return receipt(descriptor, "refused", "binding-missing", null, null);
    }
    if (
      existing.binding.projectionRef !== currentProjectionBinding.projectionRef ||
      existing.binding.tabId !== currentProjectionBinding.tabId
    ) {
      return receipt(
        descriptor,
        "refused",
        "projection-mismatch",
        existing.binding,
        null,
      );
    }

    const plan = planBoundChromiumResidencyV1(
      descriptor,
      existing.binding,
      projection,
      request,
      applicationFacts,
    );
    if (!plan.binding.matched) {
      return receipt(
        descriptor,
        "refused",
        "projection-mismatch",
        existing.binding,
        null,
      );
    }
    return receipt(descriptor, "planned", "plan-ready", existing.binding, plan);
  }

  currentBinding(descriptorInput: unknown): ChromiumLaneBindingV1 | null {
    const descriptor = canonicalDescriptor(descriptorInput);
    const existing = this.#lanes.get(descriptor.laneRef);
    if (existing === undefined || descriptor.generation !== existing.generation) return null;
    return existing.binding;
  }

  clear(): void {
    this.#lanes.clear();
    this.#projectionOwners.clear();
  }

  #advance(state: LaneState, generation: number): void {
    if (state.binding !== null) this.#projectionOwners.delete(state.binding.projectionRef);
    state.generation = generation;
    state.binding = null;
  }
}

function receipt(
  descriptor: ApplicationLaneDescriptorV1,
  status: ChromiumBindingRuntimeStatus,
  reason: ChromiumBindingRuntimeReason,
  binding: ChromiumLaneBindingV1 | null,
  plan: BoundChromiumResidencyPlanV1 | null,
): ChromiumBindingRuntimeReceiptV1 {
  return Object.freeze({
    version: CHROMIUM_BINDING_RUNTIME_VERSION,
    status,
    reason,
    laneRef: descriptor.laneRef,
    laneGeneration: descriptor.generation,
    binding,
    plan,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function canonicalDescriptor(value: unknown): ApplicationLaneDescriptorV1 {
  try {
    return parseApplicationLaneDescriptorV1(value);
  } catch {
    throw new TypeError("Chromium binding runtime descriptor is invalid");
  }
}

function safeCreateBinding(
  descriptor: ApplicationLaneDescriptorV1,
  projection: ChromiumProjection,
): ChromiumLaneBindingV1 {
  try {
    const binding = createChromiumLaneBindingV1(descriptor, projection);
    projectionReference(binding.projectionRef);
    if (!Number.isSafeInteger(binding.tabId) || binding.tabId < 0) throw new TypeError();
    return binding;
  } catch {
    throw new TypeError("Chromium binding runtime projection is invalid");
  }
}

function projectionReference(value: unknown): string {
  if (typeof value !== "string" || value.length > 96 || !PROJECTION_REF.test(value)) {
    throw new TypeError("Chromium projection reference is invalid");
  }
  const tabId = Number(value.slice("chrome-session-tab-".length));
  if (!Number.isSafeInteger(tabId) || tabId < 0) {
    throw new TypeError("Chromium projection reference is invalid");
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
