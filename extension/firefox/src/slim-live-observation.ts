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

export function buildSlimLiveObservation(
  roleMarkerCount: number,
  containers: readonly SlimLiveContainerObservation[],
): SlimLiveObservationResult {
  if (!Number.isInteger(roleMarkerCount) || roleMarkerCount < 0) {
    return { ok: false, reason: "invalid-document-order" };
  }
  if (roleMarkerCount === 0) return { ok: false, reason: "no-role-markers" };
  if (roleMarkerCount > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return { ok: false, reason: "role-marker-budget-exceeded" };
  }
  if (containers.length === 0) return { ok: false, reason: "no-turn-containers" };
  if (containers.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return { ok: false, reason: "turn-container-budget-exceeded" };
  }

  const pureCandidates: SlimDiscoveryCandidate[] = [];
  const containerIds: string[] = [];
  const roles: SlimObservedRole[] = [];
  for (let index = 0; index < containers.length; index += 1) {
    const container = containers[index];
    if (!container) return { ok: false, reason: "no-turn-containers" };
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

  return {
    ok: true,
    turns: validated.value.turns.map((descriptor, index) => ({
      ...descriptor,
      containerId: containerIds[index] ?? `missing-${index}`,
      role: roles[index] ?? "unknown",
    })),
  };
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
    default:
      return reason;
  }
}
