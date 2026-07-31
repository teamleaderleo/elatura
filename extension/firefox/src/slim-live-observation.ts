// SPDX-License-Identifier: MPL-2.0

import {
  MAX_SLIM_DISCOVERY_CANDIDATES,
  normalizeSlimObservedRole,
  validateAndGroupSlimDiscovery,
  type SlimDiscoveryCandidate,
  type SlimDiscoveryFailureReason,
  type SlimObservedRole,
} from "./slim-discovery.js";
import type { SlimTurnDescriptor } from "./slim-window.js";

const MAX_OBSERVATION_TOKEN_LENGTH = 128;
const TOKEN_PATTERN = /^[0-9A-Za-z:_-]+$/u;

export type SlimLiveContainerObservation = {
  containerId: string;
  parentToken: string | null;
  documentOrder: number;
  roleValues: readonly unknown[];
  streaming: boolean;
  estimatedBlockSizePx: number;
};

export type SlimLiveObservationFailureReason =
  | SlimDiscoveryFailureReason
  | "invalid-marker-count"
  | "marker-count-mismatch"
  | "invalid-container-id"
  | "duplicate-container-id"
  | "observation-alignment-failed"
  | "no-role-markers"
  | "role-marker-budget-exceeded"
  | "no-turn-containers"
  | "turn-container-budget-exceeded"
  | "turn-parent-missing"
  | "ambiguous-role-markers";

export type SlimObservedTurn = SlimTurnDescriptor & {
  containerId: string;
  role: SlimObservedRole;
};

export type SlimLiveObservationResult =
  | { ok: true; turns: SlimObservedTurn[] }
  | { ok: false; reason: SlimLiveObservationFailureReason };

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_OBSERVATION_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(value)
  );
}

export function buildSlimLiveObservation(
  roleMarkerCount: number,
  containers: readonly SlimLiveContainerObservation[],
): SlimLiveObservationResult {
  if (!Number.isInteger(roleMarkerCount) || roleMarkerCount < 0) {
    return { ok: false, reason: "invalid-marker-count" };
  }
  if (roleMarkerCount === 0) return { ok: false, reason: "no-role-markers" };
  if (roleMarkerCount > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return { ok: false, reason: "role-marker-budget-exceeded" };
  }
  if (containers.length === 0) return { ok: false, reason: "no-turn-containers" };
  if (containers.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return { ok: false, reason: "turn-container-budget-exceeded" };
  }

  const assignedMarkerCount = containers.reduce(
    (total, container) => total + container.roleValues.length,
    0,
  );
  if (assignedMarkerCount > roleMarkerCount) {
    return { ok: false, reason: "marker-count-mismatch" };
  }

  const pureCandidates: SlimDiscoveryCandidate[] = [];
  const containerIds: string[] = [];
  const roles: SlimObservedRole[] = [];
  const seenContainerIds = new Set<string>();
  for (let index = 0; index < containers.length; index += 1) {
    const container = containers[index];
    if (!container) return { ok: false, reason: "no-turn-containers" };
    if (!validToken(container.containerId)) {
      return { ok: false, reason: "invalid-container-id" };
    }
    if (seenContainerIds.has(container.containerId)) {
      return { ok: false, reason: "duplicate-container-id" };
    }
    seenContainerIds.add(container.containerId);
    if (container.roleValues.length !== 1) {
      return { ok: false, reason: "ambiguous-role-markers" };
    }
    if (container.parentToken === null) {
      return { ok: false, reason: "turn-parent-missing" };
    }
    const role = normalizeSlimObservedRole(container.roleValues[0]);
    const id = `turn-${index + 1}`;
    pureCandidates.push({
      id,
      parentToken: container.parentToken,
      documentOrder: container.documentOrder,
      role,
      streaming: container.streaming,
      estimatedBlockSizePx: container.estimatedBlockSizePx,
    });
    containerIds.push(container.containerId);
    roles.push(role);
  }

  const validated = validateAndGroupSlimDiscovery(pureCandidates);
  if (!validated.ok) {
    return { ok: false, reason: validated.issues[0]?.code ?? "no-turn-containers" };
  }
  if (
    validated.value.turns.length !== containerIds.length ||
    validated.value.turns.length !== roles.length
  ) {
    return { ok: false, reason: "observation-alignment-failed" };
  }

  const turns: SlimObservedTurn[] = [];
  for (let index = 0; index < validated.value.turns.length; index += 1) {
    const descriptor = validated.value.turns[index];
    const containerId = containerIds[index];
    const role = roles[index];
    if (!descriptor || !containerId || !role) {
      return { ok: false, reason: "observation-alignment-failed" };
    }
    turns.push({ ...descriptor, containerId, role });
  }
  return { ok: true, turns };
}

export function driftReasonForSlimObservation(
  reason: SlimLiveObservationFailureReason,
): SlimDiscoveryFailureReason {
  switch (reason) {
    case "no-role-markers":
    case "no-turn-containers":
      return "no-turn-candidates";
    case "role-marker-budget-exceeded":
    case "turn-container-budget-exceeded":
      return "candidate-budget-exceeded";
    case "turn-parent-missing":
      return "turn-parent-mismatch";
    case "ambiguous-role-markers":
      return "invalid-role";
    case "invalid-marker-count":
    case "marker-count-mismatch":
    case "invalid-container-id":
    case "duplicate-container-id":
    case "observation-alignment-failed":
      return "invalid-candidate-id";
    default:
      return reason;
  }
}
