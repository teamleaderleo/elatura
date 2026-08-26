// SPDX-License-Identifier: MPL-2.0
import {
  MAX_CHROMIUM_PROJECTIONS,
  manualBrowserDiscardEligibility,
  projectChromiumTab,
} from "./lifecycle.js";

const PROTOCOL_VERSION = 1;
const FAILURE_CODES = new Set([
  "invalid-command",
  "tab-unavailable",
  "discard-refused",
  "discard-unavailable",
  "operation-failed",
]);

function responseFailure(code, detail = null) {
  if (!FAILURE_CODES.has(code)) throw new TypeError("Unknown fixed failure code");
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    code,
    detail,
  });
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
  if (message.type === "list" && exactKeys(message, ["type"])) {
    return Object.freeze({ type: "list" });
  }
  if (
    ["discard", "keep-warm", "allow-reclaim", "activate"].includes(message.type) &&
    exactKeys(message, ["type", "tabId"])
  ) {
    const tabId = tabIdFrom(message.tabId);
    return tabId === null ? null : Object.freeze({ type: message.type, tabId });
  }
  return null;
}

function snapshotFromTab(tab) {
  return projectChromiumTab(tab);
}

async function listProjections() {
  const tabs = await chrome.tabs.query({});
  const projections = [];
  let unprojectable = 0;

  const ordered = [...tabs].sort((left, right) => {
    if (left.windowId !== right.windowId) return left.windowId - right.windowId;
    return left.index - right.index;
  });

  for (const tab of ordered.slice(0, MAX_CHROMIUM_PROJECTIONS)) {
    try {
      projections.push(snapshotFromTab(tab));
    } catch {
      unprojectable += 1;
    }
  }

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "list",
    projections: Object.freeze(projections),
    truncated: ordered.length > MAX_CHROMIUM_PROJECTIONS,
    unprojectable,
  });
}

async function getFreshTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function discardTab(tabId) {
  const current = await getFreshTab(tabId);
  if (current === null) return responseFailure("tab-unavailable");

  const eligibility = manualBrowserDiscardEligibility(current);
  if (!eligibility.eligible) return responseFailure("discard-refused", eligibility.reason);

  let resulting;
  try {
    resulting = await chrome.tabs.discard(tabId);
  } catch {
    return responseFailure("operation-failed");
  }
  if (resulting === undefined) return responseFailure("discard-unavailable");

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "discard",
    mode: "explicit-operator-native-discard",
    projection: snapshotFromTab(resulting),
  });
}

async function keepWarm(tabId) {
  const current = await getFreshTab(tabId);
  if (current === null) return responseFailure("tab-unavailable");

  let resulting = current;
  try {
    if (resulting.autoDiscardable) {
      const protectedTab = await chrome.tabs.update(tabId, { autoDiscardable: false });
      if (protectedTab === undefined) return responseFailure("tab-unavailable");
      resulting = protectedTab;
    }

    const reloadRequested = resulting.discarded === true;
    if (reloadRequested) {
      await chrome.tabs.reload(tabId);
      const refreshed = await getFreshTab(tabId);
      if (refreshed !== null) resulting = refreshed;
    }

    return Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      operation: "keep-warm",
      mode: "background-protected",
      reloadRequested,
      projection: snapshotFromTab(resulting),
    });
  } catch {
    return responseFailure("operation-failed");
  }
}

async function allowReclaim(tabId) {
  const current = await getFreshTab(tabId);
  if (current === null) return responseFailure("tab-unavailable");

  try {
    const resulting = current.autoDiscardable
      ? current
      : await chrome.tabs.update(tabId, { autoDiscardable: true });
    if (resulting === undefined) return responseFailure("tab-unavailable");
    return Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      operation: "allow-reclaim",
      projection: snapshotFromTab(resulting),
    });
  } catch {
    return responseFailure("operation-failed");
  }
}

async function activateTab(tabId) {
  const current = await getFreshTab(tabId);
  if (current === null) return responseFailure("tab-unavailable");

  try {
    const resulting = await chrome.tabs.update(tabId, { active: true });
    if (resulting === undefined) return responseFailure("tab-unavailable");
    return Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      operation: "activate",
      projection: snapshotFromTab(resulting),
    });
  } catch {
    return responseFailure("operation-failed");
  }
}

async function handleCommand(message) {
  const command = parseCommand(message);
  if (command === null) return responseFailure("invalid-command");

  switch (command.type) {
    case "list":
      return listProjections();
    case "discard":
      return discardTab(command.tabId);
    case "keep-warm":
      return keepWarm(command.tabId);
    case "allow-reclaim":
      return allowReclaim(command.tabId);
    case "activate":
      return activateTab(command.tabId);
    default:
      return responseFailure("invalid-command");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleCommand(message).then(
    (response) => sendResponse(response),
    () => sendResponse(responseFailure("operation-failed")),
  );
  return true;
});
