// SPDX-License-Identifier: MPL-2.0

import { MAX_SLIM_DISCOVERY_CANDIDATES, normalizeSlimObservedRole } from "./slim-discovery.js";
import {
  buildSlimLiveObservation,
  driftReasonForSlimObservation,
  type SlimLiveContainerObservation,
  type SlimLiveObservationFailureReason,
} from "./slim-live-observation.js";
import type { SlimTurnDescriptor } from "./slim-window.js";

export type LiveSlimDiscoveredTurn = SlimTurnDescriptor & {
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  element: HTMLElement;
};

export type LiveSlimDiscoveryFailureReason = SlimLiveObservationFailureReason | "turn-order-ambiguous";

export type LiveSlimDiscovery =
  | { ok: true; turns: LiveSlimDiscoveredTurn[] }
  | { ok: false; reason: LiveSlimDiscoveryFailureReason };

function boundedHeight(element: HTMLElement): number {
  const rectHeight = element.getBoundingClientRect().height;
  const candidate = Number.isFinite(rectHeight) && rectHeight > 0 ? rectHeight : element.offsetHeight;
  return Math.min(1_000_000, Math.max(1, Math.round(candidate || 320)));
}

function parentTokenFor(
  parent: HTMLElement,
  tokens: Map<HTMLElement, string>,
): string {
  const existing = tokens.get(parent);
  if (existing) return existing;
  const token = `parent-${tokens.size + 1}`;
  tokens.set(parent, token);
  return token;
}

function streamingState(
  element: HTMLElement,
  role: LiveSlimDiscoveredTurn["role"],
  index: number,
  total: number,
  stopButtonPresent: boolean,
): boolean {
  const lastAssistantStreaming =
    stopButtonPresent && role === "assistant" && index === total - 1;
  return (
    lastAssistantStreaming ||
    element.matches('[aria-busy="true"], [data-is-streaming="true"]') ||
    element.querySelector('[aria-busy="true"], [data-is-streaming="true"]') !== null
  );
}

export function discoverLiveSlimTurns(): LiveSlimDiscovery {
  const roleNodes = document.querySelectorAll<HTMLElement>("[data-message-author-role]");
  if (roleNodes.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return { ok: false, reason: "role-marker-budget-exceeded" };
  }

  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const roleValues = new Map<HTMLElement, unknown[]>();
  for (let index = 0; index < roleNodes.length; index += 1) {
    const roleNode = roleNodes[index];
    if (!roleNode) return { ok: false, reason: "no-role-markers" };
    const candidate =
      roleNode.closest<HTMLElement>('[data-testid^="conversation-turn-"]') ??
      roleNode.closest<HTMLElement>("article");
    if (!candidate) continue;
    const values = roleValues.get(candidate) ?? [];
    values.push(roleNode.getAttribute("data-message-author-role"));
    roleValues.set(candidate, values);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    if (candidates.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
      return { ok: false, reason: "turn-container-budget-exceeded" };
    }
  }

  const parentTokens = new Map<HTMLElement, string>();
  const elementsByContainerId = new Map<string, HTMLElement>();
  const stopButtonPresent = document.querySelector('[data-testid="stop-button"]') !== null;
  const observations: SlimLiveContainerObservation[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates[index];
    if (!element) return { ok: false, reason: "no-turn-containers" };
    if (index > 0) {
      const previous = candidates[index - 1];
      if (!previous) return { ok: false, reason: "turn-order-ambiguous" };
      if (!(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return { ok: false, reason: "turn-order-ambiguous" };
      }
    }
    const parent = element.parentElement;
    const values = roleValues.get(element) ?? [];
    const role = normalizeSlimObservedRole(values[0]);
    const containerId = `container-${index + 1}`;
    observations.push({
      containerId,
      parentToken: parent ? parentTokenFor(parent, parentTokens) : null,
      documentOrder: index,
      roleValues: values,
      streaming: streamingState(element, role, index, candidates.length, stopButtonPresent),
      estimatedBlockSizePx: boundedHeight(element),
    });
    elementsByContainerId.set(containerId, element);
  }

  const observed = buildSlimLiveObservation(roleNodes.length, observations);
  if (!observed.ok) return observed;

  const turns: LiveSlimDiscoveredTurn[] = [];
  for (const descriptor of observed.turns) {
    const element = elementsByContainerId.get(descriptor.containerId);
    if (!element) return { ok: false, reason: "no-turn-containers" };
    turns.push({
      id: descriptor.id,
      groupKey: descriptor.groupKey,
      streaming: descriptor.streaming,
      estimatedBlockSizePx: descriptor.estimatedBlockSizePx,
      role: descriptor.role,
      element,
    });
  }
  return { ok: true, turns };
}

export function driftReasonForLiveDiscovery(
  reason: LiveSlimDiscoveryFailureReason,
): ReturnType<typeof driftReasonForSlimObservation> {
  return driftReasonForSlimObservation(reason);
}
