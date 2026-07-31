// SPDX-License-Identifier: MPL-2.0

import {
  executeSlimDomRemoval,
  type SlimDomExecutionResult,
  type SlimDomHost,
} from "./slim-dom-executor.js";
import type { LiveSlimDiscovery } from "./slim-live-discovery.js";
import type { SlimMode, SlimWindowPlan } from "./slim-window.js";

const STATUS_HOST_ID = "elatura-slim-status-host";
const STYLE_ID = "elatura-slim-style";
const MAX_PLACEHOLDER_BLOCK_SIZE_PX = 2_000_000;

export type SlimBrowserNodeCount = {
  elementNodes: number;
  textNodes: number;
  truncated: boolean;
};

export type SlimBrowserStatusView = {
  status: string;
  mode: SlimMode;
  turnGroups: number;
  reason: string | null;
};

export type SlimBrowserStatusActions = {
  revealPrevious(): void;
  restoreStock(): void;
};

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

function statusShadow(actions: SlimBrowserStatusActions): ShadowRoot {
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
  shadow.querySelector("#previous")?.addEventListener("click", actions.revealPrevious);
  shadow.querySelector("#stock")?.addEventListener("click", actions.restoreStock);
  document.documentElement.append(host);
  return shadow;
}

function placeholderBlockSize(element: HTMLElement): number {
  const raw = Number(element.dataset.elaturaBlockSize ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function setPlaceholderBlockSize(element: HTMLElement, value: number): void {
  const bounded = Math.min(MAX_PLACEHOLDER_BLOCK_SIZE_PX, Math.max(72, Math.round(value)));
  element.dataset.elaturaBlockSize = String(bounded);
  element.style.setProperty("--elatura-placeholder-size", `${bounded}px`);
}

function createPlaceholder(
  turnCount: number,
  blockSizePx: number,
  revealPrevious: () => void,
): HTMLElement {
  const placeholder = document.createElement("section");
  placeholder.setAttribute("data-elatura-placeholder", "true");
  placeholder.dataset.elaturaTurnCount = String(turnCount);
  setPlaceholderBlockSize(placeholder, blockSizePx);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Reveal earlier messages (${turnCount} hidden turns)`;
  button.addEventListener("click", revealPrevious);
  placeholder.append(button);
  return placeholder;
}

function mergePlaceholder(
  placeholder: HTMLElement,
  addedTurns: number,
  addedBlockSizePx: number,
): void {
  const currentTurns = Number(placeholder.dataset.elaturaTurnCount ?? "0");
  const turnCount = Math.max(0, Number.isFinite(currentTurns) ? currentTurns : 0) + addedTurns;
  placeholder.dataset.elaturaTurnCount = String(turnCount);
  setPlaceholderBlockSize(
    placeholder,
    placeholderBlockSize(placeholder) + addedBlockSizePx,
  );
  const button = placeholder.querySelector<HTMLButtonElement>("button");
  if (button) button.textContent = `Reveal earlier messages (${turnCount} hidden turns)`;
}

export function countSlimBrowserNodes(maximumNodes: number): SlimBrowserNodeCount {
  if (!Number.isInteger(maximumNodes) || maximumNodes < 1) {
    throw new RangeError("maximumNodes must be a positive integer.");
  }
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
    if (visited >= maximumNodes) return { elementNodes, textNodes, truncated: true };
  }
  return { elementNodes, textNodes, truncated: false };
}

export function applySlimBrowserRenderSuppression(
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

export function executeSlimBrowserLatestWindow(
  discovery: Extract<LiveSlimDiscovery, { ok: true }>,
  plan: SlimWindowPlan,
  revealPrevious: () => void,
  maximumPlaceholders: number,
): SlimDomExecutionResult {
  ensureSlimStyle();
  clearSlimBrowserSuppression();
  const elementById = new Map(discovery.turns.map((turn) => [turn.id, turn.element]));
  const scrollTop = window.scrollY;
  const host: SlimDomHost<HTMLElement> = {
    resolveTurn(turnId) {
      return elementById.get(turnId) ?? null;
    },
    isConnected(node) {
      return node.isConnected;
    },
    previousSibling(node) {
      return node.previousElementSibling as HTMLElement | null;
    },
    isPlaceholder(node) {
      return node.hasAttribute("data-elatura-placeholder");
    },
    existingPlaceholderCount() {
      return document.querySelectorAll('[data-elatura-placeholder="true"]').length;
    },
    createPlaceholder(turnCount, blockSizePx) {
      return createPlaceholder(turnCount, blockSizePx, revealPrevious);
    },
    mergePlaceholder(placeholder, addedTurns, addedBlockSizePx) {
      mergePlaceholder(placeholder, addedTurns, addedBlockSizePx);
    },
    insertBefore(reference, placeholder) {
      reference.before(placeholder);
    },
    removeTurn(node) {
      node.remove();
    },
  };

  const result = executeSlimDomRemoval(
    plan.removalRanges,
    host,
    maximumPlaceholders,
  );
  if (result.mutationStarted) {
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop }));
  }
  return result;
}

export function clearSlimBrowserSuppression(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-elatura-render-suppressed="true"]',
  )) {
    element.removeAttribute("data-elatura-render-suppressed");
    element.style.removeProperty("--elatura-intrinsic-size");
  }
}

export function removeSlimBrowserStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}

export function slimBrowserPlaceholderCount(): number {
  return document.querySelectorAll('[data-elatura-placeholder="true"]').length;
}

export function slimBrowserHasPlaceholders(): boolean {
  return document.querySelector('[data-elatura-placeholder="true"]') !== null;
}

export function renderSlimBrowserStatus(
  view: SlimBrowserStatusView,
  actions: SlimBrowserStatusActions,
  maximumTurnGroups: number,
): void {
  if (view.status === "stock") {
    removeSlimBrowserStatus();
    return;
  }
  const shadow = statusShadow(actions);
  const token = shadow.querySelector<HTMLElement>("#token");
  const reason = shadow.querySelector<HTMLElement>("#reason");
  const previous = shadow.querySelector<HTMLButtonElement>("#previous");
  if (token) {
    token.textContent = `Elatura · ${view.status} · ${view.mode} · ${view.turnGroups}`;
  }
  if (reason) reason.textContent = view.reason ?? "Content-free local mode";
  if (previous) {
    previous.hidden = view.mode === "stock" || view.turnGroups >= maximumTurnGroups;
  }
}

export function removeSlimBrowserStatus(): void {
  document.getElementById(STATUS_HOST_ID)?.remove();
}
