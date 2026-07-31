// SPDX-License-Identifier: MPL-2.0
import {
  buildObservationReport,
  hasObservationData,
  type StoredObservationState,
} from "./report.js";
import {
  TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS,
  type TransformOptInState,
} from "./transform-opt-in.js";
import type { TransformSafetyState } from "./transform-safety.js";

const OPT_IN_CHECKBOX_IDS = [
  "opt-in-session-only",
  "opt-in-future-risk",
  "opt-in-emergency-control",
] as const;

const MAX_SLIM_TURN_GROUPS = 8;

type SlimMode = "stock" | "render-suppressed" | "latest-window";
type SlimRuntimeStatus = "stock" | "active" | "unsupported" | "drifted" | "failed-open";
type SlimRuntimeSnapshot = {
  mode: SlimMode;
  status: SlimRuntimeStatus;
  turnGroups: number;
  reason: string | null;
  destructiveApplied: boolean;
  metrics: {
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
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function downloadJson(json: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function getState(): Promise<StoredObservationState> {
  return (await browser.runtime.sendMessage({ type: "elatura:get-state" })) as StoredObservationState;
}

async function getTransformSafety(): Promise<TransformSafetyState> {
  return (await browser.runtime.sendMessage({
    type: "elatura:get-transform-safety",
  })) as TransformSafetyState;
}

async function getTransformOptIn(): Promise<TransformOptInState> {
  return (await browser.runtime.sendMessage({
    type: "elatura:get-transform-opt-in",
  })) as TransformOptInState;
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

async function sendToActiveTab(message: unknown): Promise<unknown | null> {
  const tabId = await activeTabId();
  if (tabId === null) return null;
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function getSlimState(): Promise<SlimRuntimeSnapshot | null> {
  return (await sendToActiveTab({ type: "elatura:get-slim-state" })) as SlimRuntimeSnapshot | null;
}

function allOptInAcknowledgementsChecked(): boolean {
  return OPT_IN_CHECKBOX_IDS.every(
    (id) => document.querySelector<HTMLInputElement>(`#${id}`)?.checked === true,
  );
}

function updateOptInControls(state: TransformOptInState): void {
  document.querySelector<HTMLButtonElement>("#record-opt-in")!.disabled =
    state.recorded || !allOptInAcknowledgementsChecked();
  document.querySelector<HTMLButtonElement>("#revoke-opt-in")!.disabled = !state.recorded;
}

function selectedSlimMode(): SlimMode {
  const value = document.querySelector<HTMLSelectElement>("#slim-mode")!.value;
  return value === "render-suppressed" || value === "latest-window" ? value : "stock";
}

function selectedTurnGroups(): number {
  const input = document.querySelector<HTMLInputElement>("#slim-turn-groups")!;
  const value = Number(input.value);
  return Number.isInteger(value) && value >= 1 && value <= MAX_SLIM_TURN_GROUPS ? value : 3;
}

function formatNodeCount(value: number, truncated: boolean): string {
  return `${truncated ? "≥" : ""}${value}`;
}

function liveSlimModeAuthorized(
  safety: TransformSafetyState,
  optIn: TransformOptInState,
): boolean {
  return safety.emergencyDisabled !== true && optIn.authorizesTransform === true;
}

function setApplyAvailability(
  safety: TransformSafetyState,
  optIn: TransformOptInState,
): void {
  const selected = selectedSlimMode();
  document.querySelector<HTMLButtonElement>("#apply-slim")!.disabled =
    selected !== "stock" && !liveSlimModeAuthorized(safety, optIn);
}

function updateSlimControls(
  slim: SlimRuntimeSnapshot | null,
  safety: TransformSafetyState,
  optIn: TransformOptInState,
): void {
  const mode = document.querySelector<HTMLSelectElement>("#slim-mode")!;
  const groups = document.querySelector<HTMLInputElement>("#slim-turn-groups")!;
  const apply = document.querySelector<HTMLButtonElement>("#apply-slim")!;
  const reveal = document.querySelector<HTMLButtonElement>("#reveal-slim")!;
  const restore = document.querySelector<HTMLButtonElement>("#restore-stock")!;

  if (!slim) {
    document.querySelector("#slim-status")!.textContent = "open chatgpt.com";
    document.querySelector("#slim-mounted")!.textContent = "—";
    document.querySelector("#slim-suppressed")!.textContent = "—";
    document.querySelector("#slim-elements")!.textContent = "—";
    document.querySelector("#slim-placeholders")!.textContent = "—";
    apply.disabled = true;
    reveal.disabled = true;
    restore.disabled = true;
    return;
  }

  mode.value = slim.mode;
  groups.value = String(slim.turnGroups);
  document.querySelector("#slim-status")!.textContent = slim.reason
    ? `${slim.status}: ${slim.reason}`
    : slim.status;
  document.querySelector("#slim-mounted")!.textContent =
    `${slim.metrics.mountedTurnsAfter} / ${slim.metrics.discoveredTurnsBefore}`;
  document.querySelector("#slim-suppressed")!.textContent = String(slim.metrics.suppressedTurns);
  document.querySelector("#slim-elements")!.textContent =
    `${formatNodeCount(slim.metrics.elementNodesBefore, slim.metrics.nodeCountTruncatedBefore)} / ` +
    formatNodeCount(slim.metrics.elementNodesAfter, slim.metrics.nodeCountTruncatedAfter);
  document.querySelector("#slim-placeholders")!.textContent = String(slim.metrics.placeholderCount);

  setApplyAvailability(safety, optIn);
  reveal.disabled = slim.mode === "stock" || slim.turnGroups >= MAX_SLIM_TURN_GROUPS;
  restore.disabled = slim.mode === "stock" && slim.status === "stock";
}

async function render(
  state?: StoredObservationState,
  safety?: TransformSafetyState,
  optIn?: TransformOptInState,
  slim?: SlimRuntimeSnapshot | null,
): Promise<void> {
  const [resolvedState, resolvedSafety, resolvedOptIn, resolvedSlim] = await Promise.all([
    state ?? getState(),
    safety ?? getTransformSafety(),
    optIn ?? getTransformOptIn(),
    slim === undefined ? getSlimState() : slim,
  ]);
  const run = resolvedState.activeRun ?? null;
  document.querySelector("#mode")!.textContent = run ? "recording" : "idle";
  document.querySelector("#run")!.textContent = run ? run.id.slice(0, 8) : "none";
  document.querySelector("#requests")!.textContent = String(resolvedState.summary.requestCount);
  document.querySelector("#bytes")!.textContent = formatBytes(resolvedState.summary.totalBytesObserved);
  document.querySelector("#composer")!.textContent =
    resolvedState.pageMarks.composerReadyMs === null
      ? "not observed"
      : `${resolvedState.pageMarks.composerReadyMs.toFixed(0)} ms`;
  document.querySelector("#transform-safety")!.textContent = resolvedSafety.emergencyDisabled
    ? "emergency locked"
    : "awaiting reviewed live authorization";
  document.querySelector("#transform-opt-in")!.textContent = resolvedOptIn.recorded
    ? "intent recorded; does not authorize"
    : "not recorded";
  document.querySelector<HTMLButtonElement>("#export")!.disabled =
    !run || !hasObservationData(resolvedState);
  updateOptInControls(resolvedOptIn);
  updateSlimControls(resolvedSlim, resolvedSafety, resolvedOptIn);
}

function setStatus(message: string): void {
  document.querySelector("#status")!.textContent = message;
}

document.querySelector("#start")!.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "elatura:start-run" });
  setStatus("New run started. Open or reload the test conversation now.");
  await render();
});

document.querySelector("#export")!.addEventListener("click", async () => {
  try {
    const browserInfo = await browser.runtime.getBrowserInfo();
    const report = buildObservationReport(await getState(), {
      extensionVersion: browser.runtime.getManifest().version,
      browser: browserInfo,
    });
    const json = JSON.stringify(report, null, 2);
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    downloadJson(json, `elatura-observe-${timestamp}.json`);
    setStatus(
      report.integrity.pathBreakdownComplete
        ? "Content-free JSON report exported."
        : "Report exported with integrity warnings; inspect the integrity section.",
    );
  } catch {
    setStatus("Report export failed.");
  }
});

document.querySelector("#clear")!.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "elatura:clear-run" });
  setStatus("Observation stopped and local measurements cleared.");
  await render();
});

for (const id of OPT_IN_CHECKBOX_IDS) {
  document.querySelector(`#${id}`)!.addEventListener("change", async () => {
    updateOptInControls(await getTransformOptIn());
  });
}

document.querySelector("#slim-mode")!.addEventListener("change", async () => {
  const [safety, optIn] = await Promise.all([getTransformSafety(), getTransformOptIn()]);
  setApplyAvailability(safety, optIn);
  if (selectedSlimMode() !== "stock" && !liveSlimModeAuthorized(safety, optIn)) {
    setStatus("Slim modes are implemented but locked until reviewed live authorization is connected.");
  }
});

document.querySelector("#apply-slim")!.addEventListener("click", async () => {
  const mode = selectedSlimMode();
  const [safety, optIn] = await Promise.all([getTransformSafety(), getTransformOptIn()]);
  if (mode !== "stock" && !liveSlimModeAuthorized(safety, optIn)) {
    setStatus("Slim modes remain locked. Recorded intent does not authorize a live page change.");
    setApplyAvailability(safety, optIn);
    return;
  }
  const message =
    mode === "stock"
      ? { type: "elatura:restore-stock" }
      : { type: "elatura:set-slim-mode", mode, turnGroups: selectedTurnGroups() };
  const slim = (await sendToActiveTab(message)) as SlimRuntimeSnapshot | null;
  if (!slim) {
    setStatus("Open the target conversation on chatgpt.com, then reopen this popup.");
    await render(undefined, undefined, undefined, null);
    return;
  }
  setStatus(
    slim.status === "active"
      ? `Applied ${slim.mode}.`
      : `Page mode status: ${slim.status}${slim.reason ? ` (${slim.reason})` : ""}.`,
  );
  await render(undefined, undefined, undefined, slim);
});

document.querySelector("#reveal-slim")!.addEventListener("click", async () => {
  const slim = (await sendToActiveTab({ type: "elatura:reveal-previous" })) as
    | SlimRuntimeSnapshot
    | null;
  setStatus(slim ? "Expanding the retained window." : "No active ChatGPT page is available.");
  await render(undefined, undefined, undefined, slim);
});

document.querySelector("#restore-stock")!.addEventListener("click", async () => {
  const slim = (await sendToActiveTab({ type: "elatura:restore-stock" })) as
    | SlimRuntimeSnapshot
    | null;
  setStatus(slim ? "Restoring the stock ChatGPT page." : "No active ChatGPT page is available.");
  await render(undefined, undefined, undefined, slim);
});

document.querySelector("#record-opt-in")!.addEventListener("click", async () => {
  if (!allOptInAcknowledgementsChecked()) {
    setStatus("Review every fixed acknowledgement before recording opt-in intent.");
    return;
  }
  const optIn = (await browser.runtime.sendMessage({
    type: "elatura:record-transform-opt-in",
    acknowledgements: [...TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS],
  })) as TransformOptInState;
  setStatus("Opt-in intent recorded for this session. Live modes remain locked and unauthorized.");
  await render(undefined, undefined, optIn);
});

document.querySelector("#revoke-opt-in")!.addEventListener("click", async () => {
  const optIn = (await browser.runtime.sendMessage({
    type: "elatura:revoke-transform-opt-in",
  })) as TransformOptInState;
  const slim = (await sendToActiveTab({ type: "elatura:restore-stock" })) as
    | SlimRuntimeSnapshot
    | null;
  setStatus("Opt-in intent revoked. Stock restoration was requested for the active ChatGPT page.");
  await render(undefined, undefined, optIn, slim);
});

document.querySelector("#emergency-disable")!.addEventListener("click", async () => {
  const safety = (await browser.runtime.sendMessage({
    type: "elatura:emergency-disable-transforms",
  })) as TransformSafetyState;
  const slim = (await sendToActiveTab({ type: "elatura:restore-stock" })) as
    | SlimRuntimeSnapshot
    | null;
  setStatus("Transforms are locally locked, opt-in intent was cleared, and Stock restoration was requested.");
  await render(undefined, safety, undefined, slim);
});

void render();
