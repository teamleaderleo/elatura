// SPDX-License-Identifier: MPL-2.0

import {
  applySlimBrowserRenderSuppression,
  clearSlimBrowserSuppression,
  countSlimBrowserNodes,
  executeSlimBrowserLatestWindow,
  removeSlimBrowserStatus,
  removeSlimBrowserStyle,
  renderSlimBrowserStatus,
  slimBrowserHasPlaceholders,
  slimBrowserPlaceholderCount,
} from "./slim-browser-dom.js";
import {
  initialSlimDriftState,
  reduceSlimDrift,
  type SlimDriftState,
} from "./slim-discovery.js";
import {
  discoverLiveSlimTurns,
  driftReasonForLiveDiscovery,
  type LiveSlimDiscoveredTurn,
  type LiveSlimDiscovery,
} from "./slim-live-discovery.js";
import {
  planSlimWindow,
  revealPreviousTurnGroups,
  type SlimMode,
} from "./slim-window.js";

type SlimRuntimeStatus =
  | "stock"
  | "active"
  | "unsupported"
  | "route-grace"
  | "drifted"
  | "failed-open";

type SlimConfig = {
  mode: SlimMode;
  turnGroups: number;
};

type SlimMetrics = {
  applyCount: number;
  failOpenCount: number;
  elementNodesBefore: number;
  textNodesBefore: number;
  nodeCountTruncatedBefore: boolean;
  elementNodesAfter: number;
  textNodesAfter: number;
  nodeCountTruncatedAfter: boolean;
  discoveredTurnsBefore: number;
  mountedTurnsAfter: number;
  suppressedTurns: number;
  placeholderCount: number;
};

export type SlimRuntimeSnapshot = {
  mode: SlimMode;
  status: SlimRuntimeStatus;
  turnGroups: number;
  reason: string | null;
  destructiveApplied: boolean;
  metrics: SlimMetrics;
};

type TransformSafetyState = { emergencyDisabled?: boolean };
type TransformOptInState = { recorded?: boolean; authorizesTransform?: boolean };

const DEFAULT_TURN_GROUPS = 3;
const MAX_TURN_GROUPS = 8;
const MAX_NODE_COUNT = 100_000;
const MAX_PLACEHOLDERS = 8;
const APPLY_DELAY_MS = 180;
const DRIFT_RETRY_MS = 500;
const SESSION_CONFIG_KEY = "__elatura_slim_mode_v1";

function initialMetrics(): SlimMetrics {
  return {
    applyCount: 0,
    failOpenCount: 0,
    elementNodesBefore: 0,
    textNodesBefore: 0,
    nodeCountTruncatedBefore: false,
    elementNodesAfter: 0,
    textNodesAfter: 0,
    nodeCountTruncatedAfter: false,
    discoveredTurnsBefore: 0,
    mountedTurnsAfter: 0,
    suppressedTurns: 0,
    placeholderCount: 0,
  };
}

function isSlimMode(value: unknown): value is SlimMode {
  return value === "stock" || value === "render-suppressed" || value === "latest-window";
}

function normalizeTurnGroups(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_TURN_GROUPS
    ? Number(value)
    : null;
}

function parseConfig(value: string | null): SlimConfig | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { mode?: unknown; turnGroups?: unknown };
    const turnGroups = normalizeTurnGroups(parsed.turnGroups);
    if (!isSlimMode(parsed.mode) || turnGroups === null) return null;
    return { mode: parsed.mode, turnGroups };
  } catch {
    return null;
  }
}

function readSessionConfig(): SlimConfig {
  try {
    return parseConfig(sessionStorage.getItem(SESSION_CONFIG_KEY)) ?? {
      mode: "stock",
      turnGroups: DEFAULT_TURN_GROUPS,
    };
  } catch {
    return { mode: "stock", turnGroups: DEFAULT_TURN_GROUPS };
  }
}

function writeSessionConfig(config: SlimConfig): boolean {
  try {
    const serialized = JSON.stringify(config);
    sessionStorage.setItem(SESSION_CONFIG_KEY, serialized);
    return sessionStorage.getItem(SESSION_CONFIG_KEY) === serialized;
  } catch {
    return false;
  }
}

function clearSessionConfig(): void {
  try {
    sessionStorage.removeItem(SESSION_CONFIG_KEY);
  } catch {
    // Blocked page storage must not prevent fail-open cleanup.
  }
}

function discoverySignature(
  mode: SlimMode,
  turnGroups: number,
  turns: readonly LiveSlimDiscoveredTurn[],
): string {
  return [
    mode,
    turnGroups,
    turns.length,
    turns.map((turn) => `${turn.role}:${turn.groupKey}:${turn.streaming ? 1 : 0}`).join(","),
  ].join("|");
}

async function transformAuthorization(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const [safety, optIn] = (await Promise.all([
      browser.runtime.sendMessage({ type: "elatura:get-transform-safety" }),
      browser.runtime.sendMessage({ type: "elatura:get-transform-opt-in" }),
    ])) as [TransformSafetyState, TransformOptInState];
    if (safety.emergencyDisabled) return { ok: false, reason: "emergency-disabled" };
    if (!optIn.recorded) return { ok: false, reason: "session-opt-in-required" };
    if (optIn.authorizesTransform !== true) {
      return { ok: false, reason: "live-authorization-disconnected" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "authorization-unavailable" };
  }
}

export function bootSlimContentController(): void {
  const runtimeState: SlimRuntimeSnapshot = {
    mode: "stock",
    status: "stock",
    turnGroups: DEFAULT_TURN_GROUPS,
    reason: null,
    destructiveApplied: false,
    metrics: initialMetrics(),
  };
  let applyTimer: number | null = null;
  let applying = false;
  let lastAppliedSignature: string | null = null;
  let currentUrl = location.href;
  let driftState: SlimDriftState = initialSlimDriftState();
  let slimObserver: MutationObserver | null = null;

  function snapshot(): SlimRuntimeSnapshot {
    return structuredClone(runtimeState);
  }

  function renderStatus(): void {
    renderSlimBrowserStatus(
      {
        status: runtimeState.status,
        mode: runtimeState.mode,
        turnGroups: runtimeState.turnGroups,
        reason: runtimeState.reason,
      },
      {
        revealPrevious() {
          void revealPrevious();
        },
        restoreStock() {
          void restoreStock();
        },
      },
      MAX_TURN_GROUPS,
    );
  }

  function scheduleApply(delay = APPLY_DELAY_MS): void {
    if (runtimeState.mode === "stock") return;
    if (applyTimer !== null) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      applyTimer = null;
      void applySlimMode();
    }, delay);
  }

  function startObserver(): void {
    if (slimObserver !== null) return;
    slimObserver = new MutationObserver(() => scheduleApply());
    slimObserver.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-busy",
        "data-is-streaming",
        "data-message-author-role",
        "data-testid",
      ],
    });
  }

  function stopObserver(): void {
    slimObserver?.disconnect();
    slimObserver = null;
  }

  function clearApplyTimer(): void {
    if (applyTimer === null) return;
    window.clearTimeout(applyTimer);
    applyTimer = null;
  }

  async function failOpen(reason: string): Promise<SlimRuntimeSnapshot> {
    stopObserver();
    clearApplyTimer();
    runtimeState.metrics.failOpenCount += 1;
    runtimeState.status = "failed-open";
    runtimeState.reason = reason;
    clearSessionConfig();
    driftState = initialSlimDriftState();
    lastAppliedSignature = null;

    if (runtimeState.destructiveApplied) {
      renderStatus();
      window.setTimeout(() => location.reload(), 0);
      return snapshot();
    }

    clearSlimBrowserSuppression();
    removeSlimBrowserStyle();
    runtimeState.mode = "stock";
    renderStatus();
    return snapshot();
  }

  async function handleDiscoveryFailure(
    discovery: Extract<LiveSlimDiscovery, { ok: false }>,
  ): Promise<SlimRuntimeSnapshot> {
    const decision = reduceSlimDrift(driftState, {
      kind: "discovery-failed",
      atMs: performance.now(),
      reason: driftReasonForLiveDiscovery(discovery.reason),
    });
    driftState = decision.state;
    runtimeState.reason = discovery.reason;
    runtimeState.status =
      decision.status === "grace"
        ? "route-grace"
        : decision.status === "stable"
          ? "active"
          : decision.status;
    renderStatus();
    if (decision.shouldFailOpen) return failOpen(discovery.reason);
    if (decision.shouldRetry) scheduleApply(DRIFT_RETRY_MS);
    return snapshot();
  }

  async function applySlimMode(): Promise<SlimRuntimeSnapshot> {
    if (runtimeState.mode === "stock" || applying) return snapshot();
    applying = true;
    try {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        lastAppliedSignature = null;
        runtimeState.destructiveApplied = slimBrowserHasPlaceholders();
        driftState = reduceSlimDrift(driftState, {
          kind: "route-changed",
          atMs: performance.now(),
        }).state;
      }

      const discovery = discoverLiveSlimTurns();
      if (!discovery.ok) return await handleDiscoveryFailure(discovery);
      driftState = reduceSlimDrift(driftState, {
        kind: "discovery-succeeded",
        atMs: performance.now(),
      }).state;

      const currentSignature = discoverySignature(
        runtimeState.mode,
        runtimeState.turnGroups,
        discovery.turns,
      );
      if (currentSignature === lastAppliedSignature) return snapshot();

      const before = countSlimBrowserNodes(MAX_NODE_COUNT);
      const plan = planSlimWindow(
        discovery.turns.map(({ id, groupKey, streaming, estimatedBlockSizePx }) => ({
          id,
          groupKey,
          streaming,
          estimatedBlockSizePx,
        })),
        runtimeState.mode,
        runtimeState.turnGroups,
      );
      if (!plan.ok) return await failOpen(plan.issues[0]?.code ?? "window-plan-failed");

      if (runtimeState.mode === "render-suppressed") {
        applySlimBrowserRenderSuppression(discovery, plan.value);
      } else if (runtimeState.mode === "latest-window") {
        stopObserver();
        const execution = executeSlimBrowserLatestWindow(
          discovery,
          plan.value,
          () => void revealPrevious(),
          MAX_PLACEHOLDERS,
        );
        runtimeState.destructiveApplied =
          runtimeState.destructiveApplied || execution.mutationStarted;
        if (!execution.ok) {
          return await failOpen(execution.issue.code);
        }
        startObserver();
      }

      const after = countSlimBrowserNodes(MAX_NODE_COUNT);
      runtimeState.metrics = {
        ...runtimeState.metrics,
        applyCount: runtimeState.metrics.applyCount + 1,
        elementNodesBefore: before.elementNodes,
        textNodesBefore: before.textNodes,
        nodeCountTruncatedBefore: before.truncated,
        elementNodesAfter: after.elementNodes,
        textNodesAfter: after.textNodes,
        nodeCountTruncatedAfter: after.truncated,
        discoveredTurnsBefore: plan.value.mountedTurnCountBefore,
        mountedTurnsAfter: discovery.turns.filter((turn) => turn.element.isConnected).length,
        suppressedTurns: plan.value.suppressedTurnIds.length,
        placeholderCount: slimBrowserPlaceholderCount(),
      };
      runtimeState.status = "active";
      runtimeState.reason =
        runtimeState.mode === "render-suppressed"
          ? "layout and paint suppression only; network and application state unchanged"
          : "older mounted turns replaced; stock restoration reloads the genuine page";
      driftState = reduceSlimDrift(driftState, {
        kind: "mode-applied",
        atMs: performance.now(),
      }).state;
      lastAppliedSignature = currentSignature;
      renderStatus();
      return snapshot();
    } catch (error) {
      return await failOpen(error instanceof Error ? error.message : "slim-mode-failed");
    } finally {
      applying = false;
    }
  }

  async function setSlimMode(mode: SlimMode, turnGroups: number): Promise<SlimRuntimeSnapshot> {
    const normalizedGroups = normalizeTurnGroups(turnGroups);
    if (!isSlimMode(mode) || normalizedGroups === null) {
      runtimeState.reason = "invalid-mode-request";
      return snapshot();
    }
    if (mode === "stock") return restoreStock();

    const authorization = await transformAuthorization();
    if (!authorization.ok) {
      runtimeState.status = "unsupported";
      runtimeState.reason = authorization.reason;
      renderStatus();
      return snapshot();
    }

    const config = { mode, turnGroups: normalizedGroups } satisfies SlimConfig;
    if (!writeSessionConfig(config)) {
      runtimeState.status = "unsupported";
      runtimeState.reason = "session-recovery-storage-unavailable";
      renderStatus();
      return snapshot();
    }

    if (
      runtimeState.destructiveApplied &&
      (runtimeState.mode !== mode || runtimeState.turnGroups !== normalizedGroups)
    ) {
      stopObserver();
      window.setTimeout(() => location.reload(), 0);
      return snapshot();
    }

    runtimeState.mode = mode;
    runtimeState.turnGroups = normalizedGroups;
    runtimeState.status = "unsupported";
    runtimeState.reason = "waiting-for-supported-turn-layout";
    driftState = initialSlimDriftState();
    lastAppliedSignature = null;
    startObserver();
    renderStatus();
    scheduleApply(0);
    return snapshot();
  }

  async function revealPrevious(): Promise<SlimRuntimeSnapshot> {
    if (runtimeState.mode === "stock") return snapshot();
    const nextGroups = revealPreviousTurnGroups(runtimeState.turnGroups);
    if (nextGroups === runtimeState.turnGroups) return snapshot();
    return setSlimMode(runtimeState.mode, nextGroups);
  }

  async function restoreStock(): Promise<SlimRuntimeSnapshot> {
    stopObserver();
    clearSessionConfig();
    clearApplyTimer();
    if (runtimeState.destructiveApplied) {
      window.setTimeout(() => location.reload(), 0);
      return snapshot();
    }

    clearSlimBrowserSuppression();
    removeSlimBrowserStyle();
    runtimeState.mode = "stock";
    runtimeState.status = "stock";
    runtimeState.reason = null;
    runtimeState.turnGroups = DEFAULT_TURN_GROUPS;
    runtimeState.destructiveApplied = false;
    driftState = initialSlimDriftState();
    lastAppliedSignature = null;
    removeSlimBrowserStatus();
    return snapshot();
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return undefined;
    const candidate = message as { type?: string; mode?: unknown; turnGroups?: unknown };
    if (candidate.type === "elatura:get-slim-state") return snapshot();
    if (candidate.type === "elatura:set-slim-mode") {
      if (!isSlimMode(candidate.mode)) return snapshot();
      const turnGroups = normalizeTurnGroups(candidate.turnGroups);
      if (turnGroups === null) return snapshot();
      return setSlimMode(candidate.mode, turnGroups);
    }
    if (candidate.type === "elatura:reveal-previous") return revealPrevious();
    if (candidate.type === "elatura:restore-stock") return restoreStock();
    return undefined;
  });

  const initialConfig = readSessionConfig();
  if (initialConfig.mode !== "stock") {
    runtimeState.mode = initialConfig.mode;
    runtimeState.turnGroups = initialConfig.turnGroups;
    runtimeState.status = "unsupported";
    runtimeState.reason = "waiting-for-supported-turn-layout";
    renderStatus();
    void transformAuthorization().then((authorization) => {
      if (!authorization.ok) {
        void failOpen(authorization.reason);
        return;
      }
      startObserver();
      scheduleApply(0);
    });
  }
}
