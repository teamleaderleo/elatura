// SPDX-License-Identifier: MPL-2.0

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
  type SlimWindowPlan,
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

type NodeCount = {
  elementNodes: number;
  textNodes: number;
  truncated: boolean;
};

type TransformSafetyState = { emergencyDisabled?: boolean };
type TransformOptInState = { recorded?: boolean; authorizesTransform?: boolean };

const DEFAULT_TURN_GROUPS = 3;
const MAX_TURN_GROUPS = 8;
const SESSION_CONFIG_KEY = "__elatura_slim_mode_v1";
const STATUS_HOST_ID = "elatura-slim-status-host";
const STYLE_ID = "elatura-slim-style";
const MAX_NODE_COUNT = 100_000;
const MAX_PLACEHOLDERS = 8;
const APPLY_DELAY_MS = 180;
const DRIFT_RETRY_MS = 500;

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

function countDocumentNodes(): NodeCount {
  const walker = document.createTreeWalker(
    document,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let elementNodes = 0;
  let textNodes = 0;
  let visited = 0;
  while (walker.nextNode()) {
    visited += 1;
    if (walker.currentNode.nodeType === Node.ELEMENT_NODE) elementNodes += 1;
    else if (walker.currentNode.nodeType === Node.TEXT_NODE) textNodes += 1;
    if (visited >= MAX_NODE_COUNT) return { elementNodes, textNodes, truncated: true };
  }
  return { elementNodes, textNodes, truncated: false };
}

function ensureSlimStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [data-elatura-render-suppressed="true"] {
      content-visibility: auto !important;
      contain: layout paint style !important;
      contain-intrinsic-block-size: var(--elatura-intrinsic-size, 480px) !important;
    }
    [data-elatura-placeholder="true"] {
      box-sizing: border-box !important;
      display: flex !important;
      align-items: flex-end !important;
      justify-content: center !important;
      min-block-size: var(--elatura-placeholder-size, 96px) !important;
      padding: 12px !important;
      contain: layout paint style !important;
    }
    [data-elatura-placeholder="true"] > button {
      font: 600 13px/1.2 system-ui, sans-serif !important;
      border: 1px solid currentColor !important;
      border-radius: 999px !important;
      padding: 8px 12px !important;
      background: Canvas !important;
      color: CanvasText !important;
      cursor: pointer !important;
    }
  `;
  (document.head ?? document.documentElement).append(style);
}

function clearSuppressionAttributes(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-elatura-render-suppressed="true"]',
  )) {
    element.removeAttribute("data-elatura-render-suppressed");
    element.style.removeProperty("--elatura-intrinsic-size");
  }
}

function removeStatusHost(): void {
  document.getElementById(STATUS_HOST_ID)?.remove();
}

function createStatusHost(
  revealPrevious: () => void,
  restoreStock: () => void,
): ShadowRoot {
  const existing = document.getElementById(STATUS_HOST_ID) as HTMLElement | null;
  if (existing?.shadowRoot) return existing.shadowRoot;
  existing?.remove();
  const host = document.createElement("aside");
  host.id = STATUS_HOST_ID;
  host.style.cssText =
    "position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:min(360px,calc(100vw - 24px));";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .chip { font: 600 12px/1.3 system-ui,sans-serif; color: CanvasText; background: Canvas;
        border: 1px solid currentColor; border-radius: 12px;
        box-shadow: 0 8px 30px rgb(0 0 0 / .18); padding: 9px 10px; }
      .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .reason { margin-top:5px; font-weight:400; opacity:.75; overflow-wrap:anywhere; }
      button { font:inherit; border:1px solid currentColor; border-radius:999px; padding:4px 8px;
        background:Canvas; color:CanvasText; cursor:pointer; }
    </style>
    <div class="chip">
      <div class="row"><span id="token"></span><button id="previous">Previous</button><button id="stock">Stock</button></div>
      <div class="reason" id="reason"></div>
    </div>
  `;
  shadow.querySelector("#previous")?.addEventListener("click", revealPrevious);
  shadow.querySelector("#stock")?.addEventListener("click", restoreStock);
  document.documentElement.append(host);
  return shadow;
}

function placeholderBlockSize(element: HTMLElement): number {
  const raw = Number(element.dataset.elaturaBlockSize ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function setPlaceholderBlockSize(element: HTMLElement, value: number): void {
  const bounded = Math.min(2_000_000, Math.max(72, Math.round(value)));
  element.dataset.elaturaBlockSize = String(bounded);
  element.style.setProperty("--elatura-placeholder-size", `${bounded}px`);
}

function createPlaceholder(
  turnCount: number,
  blockSize: number,
  revealPrevious: () => void,
): HTMLElement {
  const placeholder = document.createElement("section");
  placeholder.setAttribute("data-elatura-placeholder", "true");
  placeholder.dataset.elaturaTurnCount = String(turnCount);
  setPlaceholderBlockSize(placeholder, blockSize);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Reveal earlier messages (${turnCount} hidden turns)`;
  button.addEventListener("click", revealPrevious);
  placeholder.append(button);
  return placeholder;
}

function mergePlaceholder(previous: HTMLElement, addedTurns: number, addedBlockSize: number): void {
  const existingTurns = Number(previous.dataset.elaturaTurnCount ?? "0");
  const turnCount = Math.max(0, Number.isFinite(existingTurns) ? existingTurns : 0) + addedTurns;
  previous.dataset.elaturaTurnCount = String(turnCount);
  setPlaceholderBlockSize(previous, placeholderBlockSize(previous) + addedBlockSize);
  const button = previous.querySelector<HTMLButtonElement>("button");
  if (button) button.textContent = `Reveal earlier messages (${turnCount} hidden turns)`;
}

function applyRenderSuppression(
  discovery: Extract<LiveSlimDiscovery, { ok: true }>,
  plan: SlimWindowPlan,
): void {
  ensureSlimStyle();
  const suppressed = new Set(plan.suppressedTurnIds);
  for (const turn of discovery.turns) {
    if (suppressed.has(turn.id)) {
      turn.element.setAttribute("data-elatura-render-suppressed", "true");
      turn.element.style.setProperty(
        "--elatura-intrinsic-size",
        `${Math.max(1, turn.estimatedBlockSizePx)}px`,
      );
    } else {
      turn.element.removeAttribute("data-elatura-render-suppressed");
      turn.element.style.removeProperty("--elatura-intrinsic-size");
    }
  }
}

function applyLatestWindow(
  discovery: Extract<LiveSlimDiscovery, { ok: true }>,
  plan: SlimWindowPlan,
  revealPrevious: () => void,
): boolean {
  ensureSlimStyle();
  clearSuppressionAttributes();
  const elementById = new Map(discovery.turns.map((turn) => [turn.id, turn.element]));
  const scrollTop = window.scrollY;
  let removedAny = false;

  for (const range of plan.removalRanges) {
    const elements = range.turnIds
      .map((id) => elementById.get(id))
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    if (elements.length !== range.turnIds.length || elements.length === 0) {
      throw new Error("window-range-drift");
    }
    const first = elements[0];
    if (!first) throw new Error("window-range-empty");
    const previous = first.previousElementSibling as HTMLElement | null;
    if (previous?.hasAttribute("data-elatura-placeholder")) {
      mergePlaceholder(previous, elements.length, range.estimatedBlockSizePx);
    } else {
      first.before(createPlaceholder(elements.length, range.estimatedBlockSizePx, revealPrevious));
    }
    for (const element of elements) element.remove();
    removedAny = true;
  }

  const placeholders = document.querySelectorAll('[data-elatura-placeholder="true"]');
  if (placeholders.length > MAX_PLACEHOLDERS) throw new Error("placeholder-budget-exceeded");
  if (removedAny) requestAnimationFrame(() => window.scrollTo({ top: scrollTop }));
  return removedAny;
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
    if (runtimeState.status === "stock") {
      removeStatusHost();
      return;
    }
    const shadow = createStatusHost(
      () => void revealPrevious(),
      () => void restoreStock(),
    );
    const token = shadow.querySelector<HTMLElement>("#token");
    const reason = shadow.querySelector<HTMLElement>("#reason");
    const previous = shadow.querySelector<HTMLButtonElement>("#previous");
    if (token) {
      token.textContent = `Elatura · ${runtimeState.status} · ${runtimeState.mode} · ${runtimeState.turnGroups}`;
    }
    if (reason) reason.textContent = runtimeState.reason ?? "Content-free local mode";
    if (previous) {
      previous.hidden = runtimeState.mode === "stock" || runtimeState.turnGroups >= MAX_TURN_GROUPS;
    }
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

  async function failOpen(reason: string): Promise<SlimRuntimeSnapshot> {
    stopObserver();
    if (applyTimer !== null) {
      window.clearTimeout(applyTimer);
      applyTimer = null;
    }
    runtimeState.metrics.failOpenCount += 1;
    runtimeState.status = "failed-open";
    runtimeState.reason = reason;
    clearSessionConfig();
    driftState = initialSlimDriftState();
    renderStatus();
    if (runtimeState.destructiveApplied) {
      window.setTimeout(() => location.reload(), 0);
      return snapshot();
    }
    clearSuppressionAttributes();
    runtimeState.mode = "stock";
    lastAppliedSignature = null;
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
        runtimeState.destructiveApplied =
          document.querySelector('[data-elatura-placeholder="true"]') !== null;
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
      const before = countDocumentNodes();
      const result = planSlimWindow(
        discovery.turns.map(({ id, groupKey, streaming, estimatedBlockSizePx }) => ({
          id,
          groupKey,
          streaming,
          estimatedBlockSizePx,
        })),
        runtimeState.mode,
        runtimeState.turnGroups,
      );
      if (!result.ok) return await failOpen(result.issues[0]?.code ?? "window-plan-failed");

      if (runtimeState.mode === "render-suppressed") {
        applyRenderSuppression(discovery, result.value);
      } else if (runtimeState.mode === "latest-window") {
        stopObserver();
        try {
          runtimeState.destructiveApplied =
            applyLatestWindow(discovery, result.value, () => void revealPrevious()) ||
            runtimeState.destructiveApplied;
        } finally {
          startObserver();
        }
      }

      const after = countDocumentNodes();
      runtimeState.metrics = {
        ...runtimeState.metrics,
        applyCount: runtimeState.metrics.applyCount + 1,
        elementNodesBefore: before.elementNodes,
        textNodesBefore: before.textNodes,
        nodeCountTruncatedBefore: before.truncated,
        elementNodesAfter: after.elementNodes,
        textNodesAfter: after.textNodes,
        nodeCountTruncatedAfter: after.truncated,
        discoveredTurnsBefore: result.value.mountedTurnCountBefore,
        mountedTurnsAfter: discovery.turns.filter((turn) => turn.element.isConnected).length,
        suppressedTurns: result.value.suppressedTurnIds.length,
        placeholderCount: document.querySelectorAll('[data-elatura-placeholder="true"]').length,
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
    if (applyTimer !== null) {
      window.clearTimeout(applyTimer);
      applyTimer = null;
    }
    if (runtimeState.destructiveApplied) {
      window.setTimeout(() => location.reload(), 0);
      return snapshot();
    }
    clearSuppressionAttributes();
    document.getElementById(STYLE_ID)?.remove();
    runtimeState.mode = "stock";
    runtimeState.status = "stock";
    runtimeState.reason = null;
    runtimeState.turnGroups = DEFAULT_TURN_GROUPS;
    runtimeState.destructiveApplied = false;
    driftState = initialSlimDriftState();
    lastAppliedSignature = null;
    removeStatusHost();
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
