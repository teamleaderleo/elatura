// SPDX-License-Identifier: MPL-2.0
import { evaluateLane } from "./vendor/lane-governor.js";
import {
  MAX_CHROMIUM_LANES,
  browserOnlyLaneSignals,
  manualDiscardEligibility,
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
  if ((message.type === "discard" || message.type === "wake") && exactKeys(message, ["type", "tabId"])) {
    const tabId = tabIdFrom(message.tabId);
    return tabId === null ? null : Object.freeze({ type: message.type, tabId });
  }
  if (message.type === "set-protection" && exactKeys(message, ["type", "tabId", "protected"])) {
    const tabId = tabIdFrom(message.tabId);
    if (tabId === null || typeof message.protected !== "boolean") return null;
    return Object.freeze({ type: "set-protection", tabId, protected: message.protected });
  }
  return null;
}

function snapshotFromTab(tab, nowMs) {
  const projection = projectChromiumTab(tab);
  const decision = evaluateLane(projection.lifecycle, browserOnlyLaneSignals(), nowMs);
  return Object.freeze({
    tabId: projection.tabId,
    windowId: projection.windowId,
    tabIndex: projection.tabIndex,
    lifecycle: projection.lifecycle,
    decision,
    manualDiscard: projection.manualDiscard,
  });
}

async function listLanes() {
  const tabs = await chrome.tabs.query({});
  const nowMs = Date.now();
  const lanes = [];
  let unprojectable = 0;

  const ordered = [...tabs].sort((left, right) => {
    if (left.windowId !== right.windowId) return left.windowId - right.windowId;
    return left.index - right.index;
  });

  for (const tab of ordered.slice(0, MAX_CHROMIUM_LANES)) {
    try {
      lanes.push(snapshotFromTab(tab, nowMs));
    } catch {
      unprojectable += 1;
    }
  }

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "list",
    lanes: Object.freeze(lanes),
    truncated: ordered.length > MAX_CHROMIUM_LANES,
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

  const eligibility = manualDiscardEligibility(current);
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
    lane: snapshotFromTab(resulting, Date.now()),
  });
}

async function wakeTab(tabId) {
  const current = await getFreshTab(tabId);
  if (current === null) return responseFailure("tab-unavailable");

  let resulting;
  try {
    resulting = await chrome.tabs.update(tabId, { active: true });
  } catch {
    return responseFailure("operation-failed");
  }
  if (resulting === undefined) return responseFailure("tab-unavailable");

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "wake",
    lane: snapshotFromTab(resulting, Date.now()),
  });
}

async function setProtection(tabId, protectedValue) {
  const current = await getFreshTab(tabId);
  if (current === null) return responseFailure("tab-unavailable");

  let resulting;
  try {
    resulting = await chrome.tabs.update(tabId, { autoDiscardable: !protectedValue });
  } catch {
    return responseFailure("operation-failed");
  }
  if (resulting === undefined) return responseFailure("tab-unavailable");

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    operation: "set-protection",
    protected: protectedValue,
    lane: snapshotFromTab(resulting, Date.now()),
  });
}

async function handleCommand(message) {
  const command = parseCommand(message);
  if (command === null) return responseFailure("invalid-command");

  switch (command.type) {
    case "list":
      return listLanes();
    case "discard":
      return discardTab(command.tabId);
    case "wake":
      return wakeTab(command.tabId);
    case "set-protection":
      return setProtection(command.tabId, command.protected);
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
