// SPDX-License-Identifier: MPL-2.0

let composerRecorded = false;

type ContentPageMetric = {
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
};

type SlimMode = "stock" | "render-suppressed" | "latest-window";
type SlimRuntimeStatus = "stock" | "active" | "unsupported" | "drifted" | "failed-open";
type SlimTurnDescriptor = import("./slim-window.js").SlimTurnDescriptor;
type SlimWindowPlan = import("./slim-window.js").SlimWindowPlan;
type SlimWindowPlanResult = import("./slim-window.js").SlimWindowPlanResult;
type SlimPlannerModule = typeof import("./slim-window.js");

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

type SlimRuntimeSnapshot = {
  mode: SlimMode;
  status: SlimRuntimeStatus;
  turnGroups: number;
  reason: string | null;
  destructiveApplied: boolean;
  metrics: SlimMetrics;
};

type DiscoveredTurn = SlimTurnDescriptor & {
  role: string;
  element: HTMLElement;
};

type TurnDiscovery =
  | { ok: true; turns: DiscoveredTurn[]; parent: HTMLElement }
  | { ok: false; reason: string };

type NodeCount = {
  elementNodes: number;
  textNodes: number;
  truncated: boolean;
};

type TransformSafetyState = { emergencyDisabled?: boolean };
type TransformOptInState = { recorded?: boolean };

const DEFAULT_TURN_GROUPS = 3;
const MAX_TURN_GROUPS = 8;
const SESSION_CONFIG_KEY = "__elatura_slim_mode_v1";
const STATUS_HOST_ID = "elatura-slim-status-host";
const STYLE_ID = "elatura-slim-style";
const MAX_NODE_COUNT = 100_000;
const MAX_PLACEHOLDERS = 8;
const APPLY_DELAY_MS = 180;
const DRIFT_RETRY_MS = 500;
const DRIFT_FAILURE_LIMIT = 3;

const plannerPromise = import(browser.runtime.getURL("slim-window.js")) as Promise<SlimPlannerModule>;

const runtimeState: SlimRuntimeSnapshot = {
  mode: "stock",
  status: "stock",
  turnGroups: DEFAULT_TURN_GROUPS,
  reason: null,
  destructiveApplied: false,
  metrics: {
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
  },
};

let applyTimer: number | null = null;
let applying = false;
let everApplied = false;
let driftFailures = 0;
let lastAppliedSignature: string | null = null;
let currentUrl = location.href;

function emit(kind: ContentPageMetric["kind"]): void {
  const metric: ContentPageMetric = {
    kind,
    elapsedMs: Math.max(0, performance.now()),
    recordedAt: new Date().toISOString(),
  };
  void browser.runtime.sendMessage({ type: "elatura:page-metric", metric });
}

function findComposerLikeInput(): Element | null {
  return document.querySelector(
    'textarea, [contenteditable="true"][role="textbox"], form [contenteditable="true"]',
  );
}

function inspectForComposer(): void {
  if (composerRecorded || !findComposerLikeInput()) return;
  composerRecorded = true;
  emit("composer-like-input");
  composerObserver.disconnect();
}

const composerObserver = new MutationObserver(inspectForComposer);
composerObserver.observe(document, { subtree: true, childList: true, attributes: true });

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
    // A blocked page storage implementation must not prevent fail-open cleanup.
  }
}

function boundedHeight(element: HTMLElement): number {
  const rectHeight = element.getBoundingClientRect().height;
  const candidate = Number.isFinite(rectHeight) && rectHeight > 0 ? rectHeight : element.offsetHeight;
  return Math.min(1_000_000, Math.max(1, Math.round(candidate || 320)));
}

function discoverTurns(): TurnDiscovery {
  const roleNodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-author-role]"),
  );
  if (roleNodes.length === 0) return { ok: false, reason: "no-role-markers" };

  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const roleNode of roleNodes) {
    const candidate =
      roleNode.closest<HTMLElement>('[data-testid^="conversation-turn-"]') ??
      roleNode.closest<HTMLElement>("article");
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  if (candidates.length === 0) return { ok: false, reason: "no-turn-containers" };

  const parent = candidates[0]?.parentElement;
  if (!parent || candidates.some((candidate) => candidate.parentElement !== parent)) {
    return { ok: false, reason: "turn-parent-mismatch" };
  }
  for (let index = 1; index < candidates.length; index += 1) {
    const previous = candidates[index - 1];
    const current = candidates[index];
    if (!previous || !current) continue;
    if (!(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      return { ok: false, reason: "turn-order-ambiguous" };
    }
  }
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const leftElement = candidates[left];
      const rightElement = candidates[right];
      if (leftElement?.contains(rightElement)) {
        return { ok: false, reason: "nested-turn-containers" };
      }
    }
  }

  const stopButtonPresent = document.querySelector('[data-testid="stop-button"]') !== null;
  const roles = candidates.map(
    (candidate) =>
      candidate
        .querySelector<HTMLElement>("[data-message-author-role]")
        ?.getAttribute("data-message-author-role")
        ?.trim()
        .toLowerCase() ?? "unknown",
  );
  let groupIndex = 0;
  const turns: DiscoveredTurn[] = candidates.map((element, index) => {
    const role = roles[index] ?? "unknown";
    if (role === "user") groupIndex += 1;
    const lastAssistantStreaming =
      stopButtonPresent && role === "assistant" && index === candidates.length - 1;
    const streaming =
      lastAssistantStreaming ||
      element.matches('[aria-busy="true"], [data-is-streaming="true"]') ||
      element.querySelector('[aria-busy="true"], [data-is-streaming="true"]') !== null;
    return {
      id: `turn-${index + 1}`,
      groupKey: `group-${groupIndex}`,
      role,
      streaming,
      estimatedBlockSizePx: boundedHeight(element),
      element,
    };
  });

  if (!turns.some((turn) => turn.role === "user" || turn.role === "assistant")) {
    return { ok: false, reason: "unsupported-role-set" };
  }
  return { ok: true, turns, parent };
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
    if (visited >= MAX_NODE_COUNT) {
      return { elementNodes, textNodes, truncated: true };
    }
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

function statusHost(): ShadowRoot {
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
        border: 1px solid color-mix(in srgb, CanvasText 28%, transparent); border-radius: 12px;
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
  shadow.querySelector("#previous")?.addEventListener("click", () => {
    void revealPrevious();
  });
  shadow.querySelector("#stock")?.addEventListener("click", () => {
    void restoreStock();
  });
  document.documentElement.append(host);
  return shadow;
}

function renderStatus(): void {
  if (runtimeState.status === "stock") {
    removeStatusHost();
    return;
  }
  const shadow = statusHost();
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

function snapshot(): SlimRuntimeSnapshot {
  return structuredClone(runtimeState);
}

function applyRenderSuppression(discovery: Extract<TurnDiscovery, { ok: true }>, plan: SlimWindowPlan): void {
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

function placeholderBlockSize(element: HTMLElement): number {
  const raw = Number(element.dataset.elaturaBlockSize ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function setPlaceholderBlockSize(element: HTMLElement, value: number): void {
  const bounded = Math.min(2_000_000, Math.max(72, Math.round(value)));
  element.dataset.elaturaBlockSize = String(bounded);
  element.style.setProperty("--elatura-placeholder-size", `${bounded}px`);
}

function createPlaceholder(turnCount: number, blockSize: number): HTMLElement {
  const placeholder = document.createElement("section");
  placeholder.setAttribute("data-elatura-placeholder", "true");
  placeholder.dataset.elaturaTurnCount = String(turnCount);
  setPlaceholderBlockSize(placeholder, blockSize);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Reveal earlier messages (${turnCount} hidden turns)`;
  button.addEventListener("click", () => {
    void revealPrevious();
  });
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

function applyLatestWindow(discovery: Extract<TurnDiscovery, { ok: true }>, plan: SlimWindowPlan): boolean {
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
      first.before(createPlaceholder(elements.length, range.estimatedBlockSizePx));
    }
    for (const element of elements) element.remove();
    removedAny = true;
  }

  const placeholders = document.querySelectorAll('[data-elatura-placeholder="true"]');
  if (placeholders.length > MAX_PLACEHOLDERS) throw new Error("placeholder-budget-exceeded");
  if (removedAny) {
    runtimeState.destructiveApplied = true;
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: "instant" }));
  }
  return removedAny;
}

function signature(discovery: Extract<TurnDiscovery, { ok: true }>): string {
  return [
    runtimeState.mode,
    runtimeState.turnGroups,
    discovery.turns.length,
    discovery.turns.map((turn) => `${turn.role}:${turn.groupKey}:${turn.streaming ? 1 : 0}`).join(","),
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
    return { ok: true };
  } catch {
    return { ok: false, reason: "authorization-unavailable" };
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

async function failOpen(reason: string): Promise<SlimRuntimeSnapshot> {
  runtimeState.metrics.failOpenCount += 1;
  runtimeState.status = "failed-open";
  runtimeState.reason = reason;
  clearSessionConfig();
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

async function applySlimMode(): Promise<SlimRuntimeSnapshot> {
  if (runtimeState.mode === "stock" || applying) return snapshot();
  applying = true;
  try {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      lastAppliedSignature = null;
      driftFailures = 0;
      runtimeState.destructiveApplied =
        document.querySelector('[data-elatura-placeholder="true"]') !== null;
    }

    const discovery = discoverTurns();
    if (!discovery.ok) {
      runtimeState.reason = discovery.reason;
      if (everApplied) {
        driftFailures += 1;
        runtimeState.status = "drifted";
        renderStatus();
        if (driftFailures >= DRIFT_FAILURE_LIMIT) return await failOpen(discovery.reason);
        scheduleApply(DRIFT_RETRY_MS);
      } else {
        runtimeState.status = "unsupported";
        renderStatus();
      }
      return snapshot();
    }

    driftFailures = 0;
    const currentSignature = signature(discovery);
    if (currentSignature === lastAppliedSignature) return snapshot();
    const before = countDocumentNodes();
    const planner = await plannerPromise;
    const result: SlimWindowPlanResult = planner.planSlimWindow(
      discovery.turns.map(({ id, groupKey, streaming, estimatedBlockSizePx }) => ({
        id,
        groupKey,
        streaming,
        estimatedBlockSizePx,
      })),
      runtimeState.mode,
      runtimeState.turnGroups,
    );
    if (!result.ok) {
      return await failOpen(result.issues[0]?.code ?? "window-plan-failed");
    }

    if (runtimeState.mode === "render-suppressed") {
      applyRenderSuppression(discovery, result.value);
    } else if (runtimeState.mode === "latest-window") {
      applyLatestWindow(discovery, result.value);
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
      mountedTurnsAfter:
        runtimeState.mode === "latest-window"
          ? document.querySelectorAll('[data-testid^="conversation-turn-"], article').length
          : result.value.mountedTurnCountAfter,
      suppressedTurns: result.value.suppressedTurnIds.length,
      placeholderCount: document.querySelectorAll('[data-elatura-placeholder="true"]').length,
    };
    runtimeState.status = "active";
    runtimeState.reason =
      runtimeState.mode === "render-suppressed"
        ? "layout and paint suppression only; network and application state unchanged"
        : "older mounted turns replaced; stock restoration reloads the genuine page";
    everApplied = true;
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
    window.setTimeout(() => location.reload(), 0);
    return snapshot();
  }

  runtimeState.mode = mode;
  runtimeState.turnGroups = normalizedGroups;
  runtimeState.status = "unsupported";
  runtimeState.reason = "waiting-for-supported-turn-layout";
  lastAppliedSignature = null;
  renderStatus();
  scheduleApply(0);
  return snapshot();
}

async function revealPrevious(): Promise<SlimRuntimeSnapshot> {
  if (runtimeState.mode === "stock") return snapshot();
  let nextGroups = runtimeState.turnGroups;
  try {
    const planner = await plannerPromise;
    nextGroups = planner.revealPreviousTurnGroups(runtimeState.turnGroups);
  } catch {
    return failOpen("planner-unavailable");
  }
  if (nextGroups === runtimeState.turnGroups) return snapshot();
  return setSlimMode(runtimeState.mode, nextGroups);
}

async function restoreStock(): Promise<SlimRuntimeSnapshot> {
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
  driftFailures = 0;
  lastAppliedSignature = null;
  removeStatusHost();
  return snapshot();
}

const slimObserver = new MutationObserver(() => scheduleApply());
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

addEventListener(
  "DOMContentLoaded",
  () => {
    emit("dom-content-loaded");
    inspectForComposer();
  },
  { once: true },
);

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
    scheduleApply(0);
  });
}
