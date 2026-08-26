// SPDX-License-Identifier: MPL-2.0
import {
  parseApplicationLaneDescriptorV1,
  parseApplicationLaneEventV1,
  parseApplicationLaneRequestV1,
  parseApplicationLaneResponseV1,
  type ApplicationLaneCapability,
  type ApplicationLaneDescriptorV1,
  type ApplicationLaneEventV1,
  type ApplicationLaneOperation,
  type ApplicationLaneRequestV1,
  type ApplicationLaneResponseV1,
} from "./application-lane.js";

export const APPLICATION_LANE_RUNTIME_VERSION = 1 as const;

export type ApplicationLaneRuntimeLimitsV1 = Readonly<{
  maxLanes: number;
  maxPendingRequests: number;
  maxPendingRequestsPerLane: number;
  maxRecentEventIdsPerLane: number;
}>;

export const DEFAULT_APPLICATION_LANE_RUNTIME_LIMITS: ApplicationLaneRuntimeLimitsV1 =
  Object.freeze({
    maxLanes: 64,
    maxPendingRequests: 256,
    maxPendingRequestsPerLane: 16,
    maxRecentEventIdsPerLane: 32,
  });

export type ApplicationLaneRuntimeOutcome =
  | "accepted"
  | "inserted"
  | "generation-replaced"
  | "released"
  | "unknown-lane"
  | "unknown-request"
  | "stale-generation"
  | "future-generation"
  | "stale-observation"
  | "descriptor-conflict"
  | "duplicate-event"
  | "duplicate-request"
  | "capability-unavailable"
  | "capacity"
  | "response-mismatch";

export type ApplicationLaneRuntimeCountersV1 = Readonly<{
  generationReplacements: number;
  clearedPendingRequests: number;
  staleEvents: number;
  staleResponses: number;
  duplicateEvents: number;
  duplicateRequests: number;
}>;

export type ApplicationLaneRuntimeUsageV1 = Readonly<{
  lanes: number;
  pendingRequests: number;
  recentEventIds: number;
}>;

export type ApplicationLaneRuntimeLaneSnapshotV1 = Readonly<{
  descriptor: ApplicationLaneDescriptorV1;
  lastEvent: ApplicationLaneEventV1 | null;
  pendingRequests: number;
  recentEventIds: number;
}>;

export type ApplicationLaneRuntimeSnapshotV1 = Readonly<{
  version: typeof APPLICATION_LANE_RUNTIME_VERSION;
  usage: ApplicationLaneRuntimeUsageV1;
  counters: ApplicationLaneRuntimeCountersV1;
  lanes: readonly ApplicationLaneRuntimeLaneSnapshotV1[];
}>;

export type ApplicationLaneRuntimeResult<T> = Readonly<{
  outcome: ApplicationLaneRuntimeOutcome;
  value: T | null;
}>;

type PendingRequest = Readonly<{
  requestId: string;
  laneRef: string;
  laneGeneration: number;
  operation: ApplicationLaneOperation;
}>;

type LaneEntry = {
  descriptor: ApplicationLaneDescriptorV1;
  lastEvent: ApplicationLaneEventV1 | null;
  pendingIds: Set<string>;
  recentEventIds: string[];
  recentEventIdSet: Set<string>;
};

const MAX_RUNTIME_LIMIT = 4_096;
const LANE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,239}$/u;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u;
const CREDENTIAL = /(?:github_pat_|gh[pousr]_|sk-(?:proj-)?|Bearer\s+)[A-Za-z0-9._~+\/-]+/iu;

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RUNTIME_LIMIT) {
    throw new TypeError(`${name} must be a positive safe integer at most ${MAX_RUNTIME_LIMIT}.`);
  }
  return value;
}

function parseLimits(
  input: Partial<ApplicationLaneRuntimeLimitsV1> = {},
): ApplicationLaneRuntimeLimitsV1 {
  return Object.freeze({
    maxLanes: positiveLimit(
      input.maxLanes ?? DEFAULT_APPLICATION_LANE_RUNTIME_LIMITS.maxLanes,
      "maxLanes",
    ),
    maxPendingRequests: positiveLimit(
      input.maxPendingRequests ??
        DEFAULT_APPLICATION_LANE_RUNTIME_LIMITS.maxPendingRequests,
      "maxPendingRequests",
    ),
    maxPendingRequestsPerLane: positiveLimit(
      input.maxPendingRequestsPerLane ??
        DEFAULT_APPLICATION_LANE_RUNTIME_LIMITS.maxPendingRequestsPerLane,
      "maxPendingRequestsPerLane",
    ),
    maxRecentEventIdsPerLane: positiveLimit(
      input.maxRecentEventIdsPerLane ??
        DEFAULT_APPLICATION_LANE_RUNTIME_LIMITS.maxRecentEventIdsPerLane,
      "maxRecentEventIdsPerLane",
    ),
  });
}

function result<T>(
  outcome: ApplicationLaneRuntimeOutcome,
  value: T | null = null,
): ApplicationLaneRuntimeResult<T> {
  return Object.freeze({ outcome, value });
}

function increment(value: number, delta = 1): number {
  if (!Number.isSafeInteger(delta) || delta < 0) {
    throw new TypeError("counter delta must be a non-negative safe integer.");
  }
  return Math.min(Number.MAX_SAFE_INTEGER, value + delta);
}

function compareObservedAt(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameDescriptor(
  left: ApplicationLaneDescriptorV1,
  right: ApplicationLaneDescriptorV1,
): boolean {
  return (
    left.version === right.version &&
    left.laneRef === right.laneRef &&
    left.generation === right.generation &&
    left.adapter.id === right.adapter.id &&
    left.adapter.version === right.adapter.version &&
    left.state === right.state &&
    left.observedAt === right.observedAt &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((value, index) => right.capabilities[index] === value)
  );
}

function operationCapability(
  operation: ApplicationLaneOperation,
): ApplicationLaneCapability | null {
  if (operation === "status") return null;
  if (operation === "observe") return "observe";
  if (operation === "activate") return "activate";
  return "screenshot";
}

function descriptorFromResponse(
  current: ApplicationLaneDescriptorV1,
  response: ApplicationLaneResponseV1,
): ApplicationLaneDescriptorV1 {
  if (response.operation === "status" && response.outcome === "ok") {
    return response.payload as ApplicationLaneDescriptorV1;
  }
  return Object.freeze({
    ...current,
    state: response.state,
    observedAt: response.observedAt,
  });
}

function boundedLaneRef(value: string): string {
  const text = value.trim();
  if (!LANE_REF.test(text) || UNSAFE_TEXT.test(text) || CREDENTIAL.test(text)) {
    throw new TypeError("Lane reference is invalid.");
  }
  return text;
}

/**
 * Bounded in-memory ownership for the consumer-neutral application-lane
 * protocol. This runtime retains only the current descriptor, one last event,
 * bounded recent event ids, and pending request metadata. Observation content,
 * screenshots, browser handles, and operation response payloads stay with the
 * caller/transport.
 */
export class ApplicationLaneRuntimeV1 {
  readonly limits: ApplicationLaneRuntimeLimitsV1;
  #lanes = new Map<string, LaneEntry>();
  #pending = new Map<string, PendingRequest>();
  #counters: {
    generationReplacements: number;
    clearedPendingRequests: number;
    staleEvents: number;
    staleResponses: number;
    duplicateEvents: number;
    duplicateRequests: number;
  } = {
    generationReplacements: 0,
    clearedPendingRequests: 0,
    staleEvents: 0,
    staleResponses: 0,
    duplicateEvents: 0,
    duplicateRequests: 0,
  };

  constructor(limits: Partial<ApplicationLaneRuntimeLimitsV1> = {}) {
    this.limits = parseLimits(limits);
  }

  /** Install or refresh the authoritative descriptor for one logical lane. */
  upsertDescriptor(input: unknown): ApplicationLaneRuntimeResult<ApplicationLaneDescriptorV1> {
    const descriptor = parseApplicationLaneDescriptorV1(input);
    const entry = this.#lanes.get(descriptor.laneRef);
    if (entry === undefined) {
      if (this.#lanes.size >= this.limits.maxLanes) {
        return result("capacity");
      }
      this.#lanes.set(descriptor.laneRef, {
        descriptor,
        lastEvent: null,
        pendingIds: new Set(),
        recentEventIds: [],
        recentEventIdSet: new Set(),
      });
      return result("inserted", descriptor);
    }

    // One durable lane reference keeps one application adapter identity. An
    // adapter version may change with a newer generation; an adapter id cannot.
    if (descriptor.adapter.id !== entry.descriptor.adapter.id) {
      return result("descriptor-conflict", entry.descriptor);
    }
    if (descriptor.generation < entry.descriptor.generation) {
      return result("stale-generation", entry.descriptor);
    }
    if (descriptor.generation === entry.descriptor.generation) {
      const order = compareObservedAt(descriptor.observedAt, entry.descriptor.observedAt);
      if (order < 0) {
        return result("stale-observation", entry.descriptor);
      }
      if (order === 0 && !sameDescriptor(descriptor, entry.descriptor)) {
        return result("descriptor-conflict", entry.descriptor);
      }
      if (order === 0) {
        return result("accepted", entry.descriptor);
      }
      entry.descriptor = descriptor;
      if (
        entry.lastEvent !== null &&
        compareObservedAt(entry.lastEvent.observedAt, descriptor.observedAt) < 0
      ) {
        entry.lastEvent = null;
      }
      return result("accepted", descriptor);
    }

    // A newer generation replaces all volatile ownership from the old browser
    // projection before any new event/request can be admitted.
    const cleared = this.#clearPending(entry);
    entry.descriptor = descriptor;
    entry.lastEvent = null;
    entry.recentEventIds = [];
    entry.recentEventIdSet.clear();
    this.#counters.generationReplacements = increment(
      this.#counters.generationReplacements,
    );
    this.#counters.clearedPendingRequests = increment(
      this.#counters.clearedPendingRequests,
      cleared,
    );
    return result("generation-replaced", descriptor);
  }

  /** Admit only current-generation, non-duplicate application-local events. */
  admitEvent(input: unknown): ApplicationLaneRuntimeResult<ApplicationLaneEventV1> {
    const event = parseApplicationLaneEventV1(input);
    const entry = this.#lanes.get(event.laneRef);
    if (entry === undefined) return result("unknown-lane");

    if (event.laneGeneration < entry.descriptor.generation) {
      this.#counters.staleEvents = increment(this.#counters.staleEvents);
      return result("stale-generation");
    }
    if (event.laneGeneration > entry.descriptor.generation) {
      return result("future-generation");
    }
    if (!entry.descriptor.capabilities.includes("events")) {
      return result("capability-unavailable");
    }
    if (entry.recentEventIdSet.has(event.eventId)) {
      this.#counters.duplicateEvents = increment(this.#counters.duplicateEvents);
      return result("duplicate-event");
    }
    if (compareObservedAt(event.observedAt, entry.descriptor.observedAt) < 0) {
      this.#counters.staleEvents = increment(this.#counters.staleEvents);
      return result("stale-observation");
    }
    if (
      entry.lastEvent !== null &&
      compareObservedAt(event.observedAt, entry.lastEvent.observedAt) < 0
    ) {
      this.#counters.staleEvents = increment(this.#counters.staleEvents);
      return result("stale-observation");
    }

    entry.lastEvent = event;
    entry.recentEventIds.push(event.eventId);
    entry.recentEventIdSet.add(event.eventId);
    while (entry.recentEventIds.length > this.limits.maxRecentEventIdsPerLane) {
      const removed = entry.recentEventIds.shift();
      if (removed !== undefined) entry.recentEventIdSet.delete(removed);
    }
    return result("accepted", event);
  }

  /**
   * Claim ownership of one operation before the transport dispatches it. Only
   * the current lane generation and declared application-lane capabilities are
   * admitted.
   */
  beginRequest(input: unknown): ApplicationLaneRuntimeResult<ApplicationLaneRequestV1> {
    const request = parseApplicationLaneRequestV1(input);
    const entry = this.#lanes.get(request.laneRef);
    if (entry === undefined) return result("unknown-lane");

    if (request.laneGeneration < entry.descriptor.generation) {
      return result("stale-generation");
    }
    if (request.laneGeneration > entry.descriptor.generation) {
      return result("future-generation");
    }
    const required = operationCapability(request.operation);
    if (required !== null && !entry.descriptor.capabilities.includes(required)) {
      return result("capability-unavailable");
    }
    if (this.#pending.has(request.requestId)) {
      this.#counters.duplicateRequests = increment(this.#counters.duplicateRequests);
      return result("duplicate-request");
    }
    if (
      this.#pending.size >= this.limits.maxPendingRequests ||
      entry.pendingIds.size >= this.limits.maxPendingRequestsPerLane
    ) {
      return result("capacity");
    }

    const pending = Object.freeze({
      requestId: request.requestId,
      laneRef: request.laneRef,
      laneGeneration: request.laneGeneration,
      operation: request.operation,
    });
    this.#pending.set(request.requestId, pending);
    entry.pendingIds.add(request.requestId);
    return result("accepted", request);
  }

  /**
   * Reconcile a transport response with the exact pending request. Late
   * responses from replaced generations are refused before their payload can
   * repopulate runtime state.
   */
  acceptResponse(input: unknown): ApplicationLaneRuntimeResult<ApplicationLaneResponseV1> {
    const response = parseApplicationLaneResponseV1(input);
    const entry = this.#lanes.get(response.laneRef);
    if (entry === undefined) return result("unknown-lane");

    if (response.laneGeneration < entry.descriptor.generation) {
      this.#counters.staleResponses = increment(this.#counters.staleResponses);
      return result("stale-generation");
    }
    if (response.laneGeneration > entry.descriptor.generation) {
      return result("future-generation");
    }

    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return result("unknown-request");
    if (
      pending.laneRef !== response.laneRef ||
      pending.laneGeneration !== response.laneGeneration ||
      pending.operation !== response.operation
    ) {
      return result("response-mismatch");
    }

    // The canonical protocol parses status payloads independently. The runtime
    // additionally binds nested descriptor identity/state/time to the outer
    // response before accepting it as current lane state.
    if (response.operation === "status" && response.outcome === "ok") {
      const payload = response.payload as ApplicationLaneDescriptorV1;
      if (
        payload.laneRef !== response.laneRef ||
        payload.generation !== response.laneGeneration ||
        payload.state !== response.state ||
        payload.observedAt !== response.observedAt ||
        payload.adapter.id !== entry.descriptor.adapter.id
      ) {
        return result("response-mismatch");
      }
    }

    this.#pending.delete(response.requestId);
    entry.pendingIds.delete(response.requestId);

    // A correct but older same-generation reply completes its request without
    // regressing the latest descriptor. Response payloads are returned to the
    // caller and are never retained by this runtime.
    if (compareObservedAt(response.observedAt, entry.descriptor.observedAt) >= 0) {
      entry.descriptor = descriptorFromResponse(entry.descriptor, response);
      if (
        entry.lastEvent !== null &&
        compareObservedAt(entry.lastEvent.observedAt, entry.descriptor.observedAt) < 0
      ) {
        entry.lastEvent = null;
      }
    }
    return result("accepted", response);
  }

  releaseLane(laneRefInput: string): ApplicationLaneRuntimeResult<ApplicationLaneDescriptorV1> {
    const laneRef = boundedLaneRef(laneRefInput);
    const entry = this.#lanes.get(laneRef);
    if (entry === undefined) return result("unknown-lane");
    const cleared = this.#clearPending(entry);
    this.#counters.clearedPendingRequests = increment(
      this.#counters.clearedPendingRequests,
      cleared,
    );
    this.#lanes.delete(laneRef);
    return result("released", entry.descriptor);
  }

  /** Clear all volatile lane state while preserving content-free counters. */
  clear(): void {
    for (const entry of this.#lanes.values()) {
      const cleared = this.#clearPending(entry);
      this.#counters.clearedPendingRequests = increment(
        this.#counters.clearedPendingRequests,
        cleared,
      );
    }
    this.#lanes.clear();
  }

  snapshot(): ApplicationLaneRuntimeSnapshotV1 {
    const lanes = [...this.#lanes.values()]
      .map((entry) =>
        Object.freeze({
          descriptor: entry.descriptor,
          lastEvent: entry.lastEvent,
          pendingRequests: entry.pendingIds.size,
          recentEventIds: entry.recentEventIds.length,
        }),
      )
      .sort((left, right) =>
        left.descriptor.laneRef < right.descriptor.laneRef
          ? -1
          : left.descriptor.laneRef > right.descriptor.laneRef
            ? 1
            : 0,
      );
    let recentEventIds = 0;
    for (const entry of this.#lanes.values()) {
      recentEventIds += entry.recentEventIds.length;
    }
    return Object.freeze({
      version: APPLICATION_LANE_RUNTIME_VERSION,
      usage: Object.freeze({
        lanes: this.#lanes.size,
        pendingRequests: this.#pending.size,
        recentEventIds,
      }),
      counters: Object.freeze({ ...this.#counters }),
      lanes: Object.freeze(lanes),
    });
  }

  #clearPending(entry: LaneEntry): number {
    let cleared = 0;
    for (const requestId of entry.pendingIds) {
      if (this.#pending.delete(requestId)) cleared += 1;
    }
    entry.pendingIds.clear();
    return cleared;
  }
}
