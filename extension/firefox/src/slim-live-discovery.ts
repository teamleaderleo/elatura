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

export type LiveSlimDiscoveredTurn = SlimTurnDescriptor & {
  role: SlimObservedRole;
  element: HTMLElement;
};

export type LiveSlimDiscoveryFailureReason =
  | SlimDiscoveryFailureReason
  | "no-role-markers"
  | "role-marker-budget-exceeded"
  | "no-turn-containers"
  | "turn-container-budget-exceeded"
  | "turn-parent-missing"
  | "ambiguous-role-markers";

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
  role: SlimObservedRole,
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
  if (roleNodes.length === 0) return { ok: false, reason: "no-role-markers" };
  if (roleNodes.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
    return { ok: false, reason: "role-marker-budget-exceeded" };
  }

  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const roleMarkerCounts = new Map<HTMLElement, number>();
  for (let index = 0; index < roleNodes.length; index += 1) {
    const roleNode = roleNodes[index];
    if (!roleNode) return { ok: false, reason: "no-role-markers" };
    const candidate =
      roleNode.closest<HTMLElement>('[data-testid^="conversation-turn-"]') ??
      roleNode.closest<HTMLElement>("article");
    if (!candidate) continue;
    roleMarkerCounts.set(candidate, (roleMarkerCounts.get(candidate) ?? 0) + 1);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    if (candidates.length > MAX_SLIM_DISCOVERY_CANDIDATES) {
      return { ok: false, reason: "turn-container-budget-exceeded" };
    }
  }
  if (candidates.length === 0) return { ok: false, reason: "no-turn-containers" };
  if (candidates.some((candidate) => roleMarkerCounts.get(candidate) !== 1)) {
    return { ok: false, reason: "ambiguous-role-markers" };
  }

  const stopButtonPresent = document.querySelector('[data-testid="stop-button"]') !== null;
  const parentTokens = new Map<HTMLElement, string>();
  const pureCandidates: SlimDiscoveryCandidate[] = [];
  const elementsById = new Map<string, HTMLElement>();
  const rolesById = new Map<string, SlimObservedRole>();

  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates[index];
    if (!element) return { ok: false, reason: "no-turn-containers" };
    const parent = element.parentElement;
    if (!parent) return { ok: false, reason: "turn-parent-missing" };
    if (index > 0) {
      const previous = candidates[index - 1];
      if (!previous) return { ok: false, reason: "turn-order-ambiguous" };
      if (!(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return { ok: false, reason: "turn-order-ambiguous" };
      }
    }

    const roleMarker = element.querySelector<HTMLElement>("[data-message-author-role]");
    const role = normalizeSlimObservedRole(
      roleMarker?.getAttribute("data-message-author-role"),
    );
    const id = `turn-${index + 1}`;
    pureCandidates.push({
      id,
      parentToken: parentTokenFor(parent, parentTokens),
      documentOrder: index,
      role,
      streaming: streamingState(element, role, index, candidates.length, stopButtonPresent),
      estimatedBlockSizePx: boundedHeight(element),
    });
    elementsById.set(id, element);
    rolesById.set(id, role);
  }

  const validated = validateAndGroupSlimDiscovery(pureCandidates);
  if (!validated.ok) {
    return { ok: false, reason: validated.issues[0]?.code ?? "no-turn-containers" };
  }

  const turns: LiveSlimDiscoveredTurn[] = [];
  for (const descriptor of validated.value.turns) {
    const element = elementsById.get(descriptor.id);
    const role = rolesById.get(descriptor.id);
    if (!element || !role) return { ok: false, reason: "no-turn-containers" };
    turns.push({ ...descriptor, role, element });
  }
  return { ok: true, turns };
}

export function driftReasonForLiveDiscovery(
  reason: LiveSlimDiscoveryFailureReason,
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
