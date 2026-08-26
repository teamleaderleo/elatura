// SPDX-License-Identifier: MPL-2.0
import {
  createChromiumEffectReceiptV1,
  parseChromiumEffectRequestV1,
  projectionMatchesChromiumEffectRequestV1,
} from "./effect.js";
import {
  MAX_CHROMIUM_PROJECTIONS,
  manualDiscardEligibility,
  projectChromiumTab,
} from "./projection.js";

const PROTOCOL_VERSION = 1;
const FAILURE_CODES = new Set([
  "invalid-command",
  "tab-unavailable",
  "window-unavailable",
  "discard-refused",
  "discard-unavailable",
  "operation-failed",
]);

function failure(code, detail = null) {
  if (!FAILURE_CODES.has(code)) throw new TypeError("Unknown fixed failure code");
  return Object.freeze({ protocolVersion: PROTOCOL_VERSION, ok: false, code, detail });
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function tabIdFrom(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseCommand(message) {
  if (!isPlainRecord(message) || typeof message.type !== "string") return null;
  if (message.type === "list" && exactKeys(message, ["type"])) return Object.freeze({ type: "list" });
  if (
    (message.type === "discard" || message.type === "wake" || message.type === "keep-warm")
    && exactKeys(message, ["type", "tabId"])
  ) {
    const tabId = tabIdFrom(message.tabId);
    return tabId === null ? null : Object.freeze({ type: message.type, tabId });
  }
  if (message.type === "set-protection" && exactKeys(message, ["type", "tabId", "protected"])) {
    const tabId = tabIdFrom(message.tabId);
    if (tabId === null || typeof message.protected !== "boolean") return null;
    return Object.freeze({ type: "set-protection", tabId, protected: message.protected });
  }
  if (message.type === "apply-effect" && exactKeys(message, ["type", "request"])) {
    try {
      return Object.freeze({
        type: "apply-effect",
        request: parseChromiumEffectRequestV1(message.request),
      });
    } catch {
      return null;
    }
  }
  return null;
}

function focusedWindowMap(windows) {
  const result = new Map();
  for (const window of windows) {
    if (typeof window.id === "number" && Number.isSafeInteger(window.id) && window.id >= 0) {
      result.set(window.id, window.focused === true);
    }
  }
  return result;
}

function projectionFromTab(tab, focusByWindow) {
  return projectChromiumTab(tab, focusByWindow.get(tab.windowId) === true);
}

async function listProjections() {
  const [tabs, windows] = await Promise.all([chrome.tabs.query({}), chrome.windows.getAll()]);
  const focusByWindow = focusedWindowMap(windows);
  const ordered = [...tabs].sort((left, right) => {
    if (left.windowId !== right.windowId) return left.windowId - right.windowId;
    return left.index - right.index;
  });
  const projections = [];
  let unprojectable = 0;

  for (const tab of ordered.slice(0, MAX_CHROMIUM_PROJECTIONS)) {
    try {
      projections.push(projectionFromTab(tab, focusByWindow));
    } catch {
      unprojectable += 1;
    }
  }

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "list-projections",
    projections: Object.freeze(projections),
    truncated: ordered.length > MAX_CHROMIUM_PROJECTIONS,
    unprojectable,
    laneBinding: "unbound",
  });
}

async function freshTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function freshProjection(tab) {
  try {
    const window = await chrome.windows.get(tab.windowId);
    return projectChromiumTab(tab, window.focused === true);
  } catch {
    return null;
  }
}

async function discardTab(tabId) {
  const current = await freshTab(tabId);
  if (current === null) return failure("tab-unavailable");
  const eligibility = manualDiscardEligibility(current);
  if (!eligibility.eligible) return failure("discard-refused", eligibility.reason);

  let resulting;
  try {
    resulting = await chrome.tabs.discard(tabId);
  } catch {
    return failure("operation-failed");
  }
  if (resulting === undefined) return failure("discard-unavailable");
  const projection = await freshProjection(resulting);
  if (projection === null) return failure("window-unavailable");

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "manual-discard",
    authority: "explicit-operator-browser-action",
    projection,
  });
}

async function keepWarm(tabId) {
  const current = await freshTab(tabId);
  if (current === null) return failure("tab-unavailable");

  let resulting = current;
  let reloadRequested = false;
  try {
    if (resulting.autoDiscardable) {
      const protectedTab = await chrome.tabs.update(tabId, { autoDiscardable: false });
      if (protectedTab === undefined) return failure("tab-unavailable");
      resulting = protectedTab;
    }
    if (resulting.discarded === true) {
      reloadRequested = true;
      await chrome.tabs.reload(tabId);
      const refreshed = await freshTab(tabId);
      if (refreshed !== null) resulting = refreshed;
    }
  } catch {
    return failure("operation-failed");
  }

  const projection = await freshProjection(resulting);
  if (projection === null) return failure("window-unavailable");
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "keep-warm",
    authority: "explicit-operator-browser-action",
    reloadRequested,
    projection,
  });
}

async function wakeTab(tabId) {
  const current = await freshTab(tabId);
  if (current === null) return failure("tab-unavailable");

  let resulting;
  try {
    resulting = await chrome.tabs.update(tabId, { active: true });
    if (resulting === undefined) return failure("tab-unavailable");
    await chrome.windows.update(resulting.windowId, { focused: true });
  } catch {
    return failure("operation-failed");
  }
  const projection = await freshProjection(resulting);
  if (projection === null) return failure("window-unavailable");

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "wake",
    authority: "explicit-operator-browser-action",
    projection,
  });
}

async function setProtection(tabId, protectedValue) {
  const current = await freshTab(tabId);
  if (current === null) return failure("tab-unavailable");

  let resulting;
  try {
    resulting = await chrome.tabs.update(tabId, { autoDiscardable: !protectedValue });
  } catch {
    return failure("operation-failed");
  }
  if (resulting === undefined) return failure("tab-unavailable");
  const projection = await freshProjection(resulting);
  if (projection === null) return failure("window-unavailable");

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "set-protection",
    authority: "explicit-operator-browser-action",
    protected: protectedValue,
    projection,
  });
}

async function applyPlannedEffect(request) {
  const current = await freshTab(request.tabId);
  if (current === null) {
    return effectResponse(
      createChromiumEffectReceiptV1(
        request,
        "browser_error",
        "browser_unavailable",
        null,
      ),
    );
  }
  const before = await freshProjection(current);
  if (before === null) {
    return effectResponse(
      createChromiumEffectReceiptV1(
        request,
        "browser_error",
        "browser_unavailable",
        null,
      ),
    );
  }
  if (!projectionMatchesChromiumEffectRequestV1(request, before)) {
    return effectResponse(
      createChromiumEffectReceiptV1(
        request,
        "stale_projection",
        "projection_mismatch",
        before,
      ),
    );
  }

  const browserResult = request.effect === "keep_warm"
    ? await keepWarm(request.tabId)
    : await discardTab(request.tabId);
  if (browserResult.ok === true) {
    return effectResponse(
      createChromiumEffectReceiptV1(
        request,
        "applied",
        "effect_applied",
        browserResult.projection,
      ),
    );
  }
  if (browserResult.code === "discard-refused") {
    return effectResponse(
      createChromiumEffectReceiptV1(
        request,
        "refused",
        "browser_preflight_refused",
        before,
      ),
    );
  }
  return effectResponse(
    createChromiumEffectReceiptV1(
      request,
      "browser_error",
      browserResult.code === "tab-unavailable" || browserResult.code === "window-unavailable"
        ? "browser_unavailable"
        : "operation_failed",
      before,
    ),
  );
}

function effectResponse(receipt) {
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "apply-effect",
    authority: "browser-local-effect-request",
    receipt,
  });
}

async function handleCommand(message) {
  const command = parseCommand(message);
  if (command === null) return failure("invalid-command");
  switch (command.type) {
    case "list":
      return listProjections();
    case "discard":
      return discardTab(command.tabId);
    case "keep-warm":
      return keepWarm(command.tabId);
    case "wake":
      return wakeTab(command.tabId);
    case "set-protection":
      return setProtection(command.tabId, command.protected);
    case "apply-effect":
      return applyPlannedEffect(command.request);
    default:
      return failure("invalid-command");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleCommand(message).then(
    (response) => sendResponse(response),
    () => sendResponse(failure("operation-failed")),
  );
  return true;
});
