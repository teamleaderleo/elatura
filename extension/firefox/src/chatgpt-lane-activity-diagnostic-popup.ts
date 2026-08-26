// SPDX-License-Identifier: MPL-2.0

import { admitFirefoxChatGptActivityDiagnosticV1 } from "./chatgpt-lane-activity-diagnostic.js";
import {
  acceptFirefoxChatGptActivityPanelDiscoveryV1,
  acceptFirefoxChatGptActivityPanelSampleV1,
  createFirefoxChatGptActivityPanelDiscoveryMessageV1,
  createFirefoxChatGptActivityPanelSampleMessageV1,
  parseFirefoxChatGptActivityPanelTargetV1,
  type FirefoxChatGptActivityPanelBindingV1,
} from "./chatgpt-lane-activity-panel.js";

let diagnosticBinding: FirefoxChatGptActivityPanelBindingV1 | null = null;

function setDiagnosticStatus(message: string): void {
  document.querySelector("#activity-diagnostic-status")!.textContent = message;
}

function updateDiagnosticControls(): void {
  document.querySelector<HTMLButtonElement>("#activity-diagnostic-export")!.disabled =
    diagnosticBinding === null;
}

function clearDiagnosticBinding(message: string): void {
  diagnosticBinding = null;
  updateDiagnosticControls();
  setDiagnosticStatus(message);
}

async function activeTabId(): Promise<number | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const id = tabs[0]?.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

function requestRef(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Firefox ChatGPT activity diagnostic receipt is invalid");
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError();
    }
    return descriptor.value;
  } catch {
    throw new TypeError("Firefox ChatGPT activity diagnostic receipt is invalid");
  }
}

function downloadDiagnostic(value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `elatura-chatgpt-activity-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function bindDiagnosticToActivePage(): Promise<void> {
  let target;
  try {
    target = parseFirefoxChatGptActivityPanelTargetV1(
      document.querySelector<HTMLInputElement>("#activity-lane-ref")!.value,
      document.querySelector<HTMLInputElement>("#activity-lane-generation")!.value,
    );
  } catch {
    clearDiagnosticBinding("Diagnostic export needs a valid canonical lane target.");
    return;
  }

  const tabId = await activeTabId();
  if (tabId === null) {
    clearDiagnosticBinding("Diagnostic export could not resolve the active Firefox tab.");
    return;
  }

  const correlation = requestRef("diagnostic-discover");
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(
      createFirefoxChatGptActivityPanelDiscoveryMessageV1(tabId, correlation),
    );
  } catch {
    clearDiagnosticBinding("Diagnostic document projection discovery failed.");
    return;
  }

  const result = acceptFirefoxChatGptActivityPanelDiscoveryV1(
    target,
    tabId,
    correlation,
    response,
  );
  diagnosticBinding = result.binding;
  updateDiagnosticControls();
  setDiagnosticStatus(
    result.status === "bound"
      ? "Diagnostic export is bound for this popup session."
      : result.status === "unavailable"
        ? "Open the target ChatGPT page and bind again."
        : "Diagnostic document projection response was invalid.",
  );
}

async function exportFreshDiagnostic(): Promise<void> {
  const binding = diagnosticBinding;
  if (binding === null) {
    clearDiagnosticBinding("Bind the active ChatGPT page before exporting a diagnostic.");
    return;
  }

  const correlation = requestRef("diagnostic-sample");
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(
      createFirefoxChatGptActivityPanelSampleMessageV1(binding, correlation),
    );
  } catch {
    clearDiagnosticBinding("Diagnostic activity sampling failed; bind the page again.");
    return;
  }

  const result = acceptFirefoxChatGptActivityPanelSampleV1(binding, correlation, response);
  diagnosticBinding = result.binding;
  updateDiagnosticControls();
  if (result.status !== "sampled" || result.observation === null) {
    clearDiagnosticBinding(
      result.status === "stale"
        ? "ChatGPT page epoch changed; bind again before diagnostic export."
        : result.status === "unavailable"
          ? "Diagnostic activity route is unavailable; bind again."
          : "Diagnostic activity receipt was invalid; bind again.",
    );
    return;
  }

  try {
    const diagnostic = admitFirefoxChatGptActivityDiagnosticV1(
      binding,
      result.observation,
      ownData(response, "observation"),
    );
    downloadDiagnostic(diagnostic);
    setDiagnosticStatus("Canonical content-free activity diagnostic exported.");
  } catch {
    clearDiagnosticBinding("Diagnostic observation admission failed; bind again.");
  }
}

document.querySelector("#activity-lane-ref")!.addEventListener("input", () => {
  clearDiagnosticBinding("Lane target changed; bind again before diagnostic export.");
});

document.querySelector("#activity-lane-generation")!.addEventListener("input", () => {
  clearDiagnosticBinding("Lane target changed; bind again before diagnostic export.");
});

document.querySelector("#activity-bind")!.addEventListener("click", () => {
  void bindDiagnosticToActivePage();
});

document.querySelector("#activity-diagnostic-export")!.addEventListener("click", () => {
  void exportFreshDiagnostic();
});

updateDiagnosticControls();
