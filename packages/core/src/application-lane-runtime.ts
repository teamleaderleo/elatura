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
import { matchApplicationLaneResponseV1 } from "./application-lane-client.js";

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
  | "cancelled"
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
  | "response-mismatch"
  | "response-budget-exceeded";

export type ApplicationLaneRuntimeCountersV1 = Readonly<{
  generationReplacements: number;
  clearedPendingRequests: number;
  staleEvents: number;
  staleResponses: number;
  duplicateEvents: number;
  duplicateRequests: number;
  rejectedResponseBudgets: number;
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
  request: ApplicationLaneRequestV1;
}>;

type LaneEntry = {
  descriptor: ApplicationLaneDescriptorV1;
  lastEvent: ApplicationLaneEventV1 | null;
  pendingIds: Set<string>;
  recentEventIds: string[];
  recentEventIdSet: Set<string>;
};

const MAX_RUNTIME_LIMIT = 4_096;

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
      input.maxPendingRequests ?? DEFAULT_APPLICATION_LANE_RUNTIME_LIMITS.maxPendingRequests,
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

/**
 * Bounded in-memory ownership for the consumer-neutral application-lane
 * protocol. Observation content, screenshots, browser handles, and completed
 * response payloads stay with the caller/transport.
 */
export class ApplicationLaneRuntimeV1 {
  readonly limits: ApplicationLaneRuntimeLimitsV1;
  #lanes = new Map<string, LaneEntry>();
  #pending = new Map<string, PendingRequest>();
  #counters = {
    generationReplacements: 0,
    clearedPendingRequests: 0,
    staleEvents: 0,
    staleResponses: 0,
    duplicateEvents: 0,
    duplicateRequests: 0,
    rejectedResponseBudgets: 0,
  };

  constructor(limits: Partial<ApplicationLaneRuntimeLimitsV1> = {}) {
    this.limits = parseLimits(limits);
  }

  upsertDescriptor(input: unknown): ApplicationLaneRuntimeResult<ApplicationLaneDescriptorV1> {
    const descriptor = parseApplicationLaneDescriptorV1(input);
    const entry = this.#lanes.get(descriptor.laneRef);
    if (entry === undefined) {
      if (this.#lanes.size >= this.limits.maxLanes) return result("capacity");
      this.#lanes.set(descriptor.laneRef, {
        descriptor,
        lastEvent: null,
        pendingIds: new Set(),
        recentEventIds: [],
        recentEventIdSet: new Set(),
      });
      return result("inserted", descriptor);
    }

    if (descriptor.generation < entry.descriptor.generation) {
      return result("stale-generation", entry.descriptor);
    }
    if (descriptor.generation === entry.descriptor.generation) {
      const order = compareObservedAt(descriptor.observedAt, entry.descriptor.observedAt);
      if (order < 0) return result("stale-observation", entry.descriptor);
      if (order === 0 && !sameDescriptor(descriptor, entry.descriptor)) {
        return result("descriptor-conflict", entry.descriptor);
      }
      if (order === 0) return result("accepted", entry.descriptor);
      entry.descriptor = descriptor;
      if (
        entry.lastEvent !== null &&
        compareObservedAt(entry.lastEvent.observedAt, descriptor.observedAt) < 0
      ) {
        entry.lastEvent = null;
      }
      return result("accepted", descriptor);
    }

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

    this.#pending.set(request.requestId, Object.freeze({ request }));
    entry.pendingIds.add(request.requestId);
    return result("accepted", request);
  }

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

    const matched = matchApplicationLaneResponseV1(pending.request, response);
    if (!matched.matched) {
      if (matched.reason === "observation_budget_exceeded") {
        this.#consumePending(response.requestId, entry);
        this.#counters.rejectedResponseBudgets = increment(
          this.#counters.rejectedResponseBudgets,
        );
        return result("response-budget-exceeded");
      }
      return result("response-mismatch");
    }
    const acceptedResponse = matched.response as ApplicationLaneResponseV1;

    if (acceptedResponse.operation === "status" && acceptedResponse.outcome === "ok") {
      const payload = acceptedResponse.payload as ApplicationLaneDescriptorV1;
      if (
        payload.laneRef !== acceptedResponse.laneRef ||
        payload.generation !== acceptedResponse.laneGeneration ||
        payload.state !== acceptedResponse.state ||
        payload.observedAt !== acceptedResponse.observedAt
      ) {
        this.#consumePending(acceptedResponse.requestId, entry);
        return result("response-mismatch");
      }
    }

    this.#consumePending(acceptedResponse.requestId, entry);
    const responseOrder = compareObservedAt(
      acceptedResponse.observedAt,
      entry.descriptor.observedAt,
    );
    const candidate = descriptorFromResponse(entry.descriptor, acceptedResponse);
    if (responseOrder === 0 && !sameDescriptor(candidate, entry.descriptor)) {
      return result("descriptor-conflict", acceptedResponse);
    }
    if (responseOrder > 0) {
      entry.descriptor = candidate;
      if (
        entry.lastEvent !== null &&
        compareObservedAt(entry.lastEvent.observedAt, entry.descriptor.observedAt) < 0
      ) {
        entry.lastEvent = null;
      }
    }
    return result("accepted", acceptedResponse);
  }

  cancelRequest(requestId: string): ApplicationLaneRuntimeResult<ApplicationLaneRequestV1> {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return result("unknown-request");
    this.#pending.delete(requestId);
    this.#lanes.get(pending.request.laneRef)?.pendingIds.delete(requestId);
    return result("cancelled", pending.request);
  }

  releaseLane(laneRef: string): ApplicationLaneRuntimeResult<ApplicationLaneDescriptorV1> {
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
    for (const entry of this.#lanes.values()) recentEventIds += entry.recentEventIds.length;
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

  #consumePending(requestId: string, entry: LaneEntry): void {
    this.#pending.delete(requestId);
    entry.pendingIds.delete(requestId);
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
