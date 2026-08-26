// SPDX-License-Identifier: MPL-2.0

/**
 * Provider-neutral identity and projection state for an Elatura application
 * lane. A lane names a logical application target. Browser-native identities,
 * profiles, sessions, tabs, targets, windows, and renderer processes remain
 * replaceable projection state and are deliberately absent from this model.
 */

export const APPLICATION_LANE_MODEL_VERSION = 1 as const;

export const APPLICATION_LANE_BROWSER_CLASSES = [
  "gecko",
  "chromium",
  "webkit",
  "remote",
  "unknown",
] as const;
export type ApplicationLaneBrowserClass =
  (typeof APPLICATION_LANE_BROWSER_CLASSES)[number];

export const APPLICATION_LANE_PROJECTION_STATES = [
  "active",
  "background",
  "parked",
  "discarded",
  "unavailable",
] as const;
export type ApplicationLaneProjectionState =
  (typeof APPLICATION_LANE_PROJECTION_STATES)[number];

export const APPLICATION_LANE_LOSS_REASONS = [
  "navigation",
  "discard",
  "crash",
  "restart",
  "profile-replaced",
  "host-migrated",
  "unknown",
] as const;
export type ApplicationLaneProjectionLossReason =
  (typeof APPLICATION_LANE_LOSS_REASONS)[number];

export const APPLICATION_LANE_AVAILABILITY = [
  "unbound",
  "available",
  "parked",
  "discarded",
  "unavailable",
  "recovery-needed",
] as const;
export type ApplicationLaneAvailability =
  (typeof APPLICATION_LANE_AVAILABILITY)[number];

const OPAQUE_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._:-]{0,127}$/u;
const CLASS_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u;

export type ApplicationLaneProjection = Readonly<{
  generation: number;
  projectionToken: string;
  browserClass: ApplicationLaneBrowserClass;
  state: ApplicationLaneProjectionState;
}>;

export type ApplicationLaneProjectionStats = Readonly<{
  bindings: number;
  replacements: number;
  losses: number;
  recoveries: number;
}>;

export type ApplicationLane = Readonly<{
  modelVersion: typeof APPLICATION_LANE_MODEL_VERSION;
  laneKey: string;
  applicationClass: string;
  targetToken: string | null;
  projectionGeneration: number;
  projection: ApplicationLaneProjection | null;
  availability: ApplicationLaneAvailability;
  pendingRecovery: boolean;
  lastLossReason: ApplicationLaneProjectionLossReason | null;
  projectionStats: ApplicationLaneProjectionStats;
}>;

export type CreateApplicationLaneInput = Readonly<{
  laneKey: string;
  applicationClass: string;
  targetToken?: string | null;
}>;

export type BindApplicationLaneProjectionInput = Readonly<{
  projectionToken: string;
  browserClass: ApplicationLaneBrowserClass;
  state?: ApplicationLaneProjectionState;
}>;

function assertOpaqueToken(value: string, name: string): string {
  if (!OPAQUE_TOKEN.test(value)) {
    throw new TypeError(`${name} must be a bounded opaque token.`);
  }
  return value;
}

function assertClassToken(value: string, name: string): string {
  if (!CLASS_TOKEN.test(value)) {
    throw new TypeError(`${name} must be a bounded class token.`);
  }
  return value;
}

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  name: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${name} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function availabilityForProjectionState(
  state: ApplicationLaneProjectionState,
): ApplicationLaneAvailability {
  switch (state) {
    case "parked":
      return "parked";
    case "discarded":
      return "discarded";
    case "unavailable":
      return "unavailable";
    case "active":
    case "background":
      return "available";
  }
}

function freezeLane(input: {
  laneKey: string;
  applicationClass: string;
  targetToken: string | null;
  projectionGeneration: number;
  projection: ApplicationLaneProjection | null;
  availability: ApplicationLaneAvailability;
  pendingRecovery: boolean;
  lastLossReason: ApplicationLaneProjectionLossReason | null;
  projectionStats: ApplicationLaneProjectionStats;
}): ApplicationLane {
  return Object.freeze({
    modelVersion: APPLICATION_LANE_MODEL_VERSION,
    laneKey: input.laneKey,
    applicationClass: input.applicationClass,
    targetToken: input.targetToken,
    projectionGeneration: input.projectionGeneration,
    projection: input.projection,
    availability: input.availability,
    pendingRecovery: input.pendingRecovery,
    lastLossReason: input.lastLossReason,
    projectionStats: input.projectionStats,
  });
}

export function createApplicationLane(
  input: CreateApplicationLaneInput,
): ApplicationLane {
  const laneKey = assertOpaqueToken(input.laneKey, "laneKey");
  const applicationClass = assertClassToken(
    input.applicationClass,
    "applicationClass",
  );
  const targetToken =
    input.targetToken === undefined || input.targetToken === null
      ? null
      : assertOpaqueToken(input.targetToken, "targetToken");

  return freezeLane({
    laneKey,
    applicationClass,
    targetToken,
    projectionGeneration: 0,
    projection: null,
    availability: "unbound",
    pendingRecovery: false,
    lastLossReason: null,
    projectionStats: Object.freeze({
      bindings: 0,
      replacements: 0,
      losses: 0,
      recoveries: 0,
    }),
  });
}

/**
 * Bind a new browser projection. Rebinding always creates a new generation;
 * callers must mint a fresh opaque projection token instead of passing a
 * browser-native id through this API.
 */
export function bindApplicationLaneProjection(
  lane: ApplicationLane,
  input: BindApplicationLaneProjectionInput,
): ApplicationLane {
  const projectionToken = assertOpaqueToken(
    input.projectionToken,
    "projectionToken",
  );
  const browserClass = assertEnum(
    input.browserClass,
    APPLICATION_LANE_BROWSER_CLASSES,
    "browserClass",
  );
  const state = assertEnum(
    input.state ?? "active",
    APPLICATION_LANE_PROJECTION_STATES,
    "state",
  );

  if (lane.projection?.projectionToken === projectionToken) {
    throw new TypeError(
      "projectionToken must change when a new projection generation is bound.",
    );
  }

  const generation = lane.projectionGeneration + 1;
  const recovering = lane.pendingRecovery;
  const hadPriorProjection = lane.projectionGeneration > 0;
  const projection = Object.freeze({
    generation,
    projectionToken,
    browserClass,
    state,
  });

  return freezeLane({
    laneKey: lane.laneKey,
    applicationClass: lane.applicationClass,
    targetToken: lane.targetToken,
    projectionGeneration: generation,
    projection,
    availability: availabilityForProjectionState(state),
    pendingRecovery: false,
    lastLossReason: lane.lastLossReason,
    projectionStats: Object.freeze({
      bindings: lane.projectionStats.bindings + 1,
      replacements:
        lane.projectionStats.replacements + (hadPriorProjection ? 1 : 0),
      losses: lane.projectionStats.losses,
      recoveries: lane.projectionStats.recoveries + (recovering ? 1 : 0),
    }),
  });
}

export function updateApplicationLaneProjectionState(
  lane: ApplicationLane,
  state: ApplicationLaneProjectionState,
): ApplicationLane {
  if (lane.projection === null) {
    throw new TypeError("cannot update projection state without a bound projection.");
  }
  const parsedState = assertEnum(
    state,
    APPLICATION_LANE_PROJECTION_STATES,
    "state",
  );
  const projection = Object.freeze({
    ...lane.projection,
    state: parsedState,
  });

  return freezeLane({
    laneKey: lane.laneKey,
    applicationClass: lane.applicationClass,
    targetToken: lane.targetToken,
    projectionGeneration: lane.projectionGeneration,
    projection,
    availability: availabilityForProjectionState(parsedState),
    pendingRecovery: false,
    lastLossReason: lane.lastLossReason,
    projectionStats: lane.projectionStats,
  });
}

/**
 * Mark the current browser projection as lost. The logical lane key and target
 * survive. A later bind creates a new generation and records a recovery.
 */
export function loseApplicationLaneProjection(
  lane: ApplicationLane,
  reason: ApplicationLaneProjectionLossReason,
): ApplicationLane {
  if (lane.projection === null) {
    throw new TypeError("cannot lose a projection when no projection is bound.");
  }
  const parsedReason = assertEnum(
    reason,
    APPLICATION_LANE_LOSS_REASONS,
    "reason",
  );

  return freezeLane({
    laneKey: lane.laneKey,
    applicationClass: lane.applicationClass,
    targetToken: lane.targetToken,
    projectionGeneration: lane.projectionGeneration,
    projection: null,
    availability: "recovery-needed",
    pendingRecovery: true,
    lastLossReason: parsedReason,
    projectionStats: Object.freeze({
      bindings: lane.projectionStats.bindings,
      replacements: lane.projectionStats.replacements,
      losses: lane.projectionStats.losses + 1,
      recoveries: lane.projectionStats.recoveries,
    }),
  });
}
