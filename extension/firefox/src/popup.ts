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

async function render(
  state?: StoredObservationState,
  safety?: TransformSafetyState,
  optIn?: TransformOptInState,
): Promise<void> {
  const [resolvedState, resolvedSafety, resolvedOptIn] = await Promise.all([
    state ?? getState(),
    safety ?? getTransformSafety(),
    optIn ?? getTransformOptIn(),
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
    ? "locked"
    : "unknown";
  document.querySelector("#transform-opt-in")!.textContent = resolvedOptIn.recorded
    ? "intent recorded; locked"
    : "not recorded; locked";
  document.querySelector<HTMLButtonElement>("#export")!.disabled =
    !run || !hasObservationData(resolvedState);
  updateOptInControls(resolvedOptIn);
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

document.querySelector("#record-opt-in")!.addEventListener("click", async () => {
  if (!allOptInAcknowledgementsChecked()) {
    setStatus("Review every fixed acknowledgement before recording opt-in intent.");
    return;
  }
  const optIn = (await browser.runtime.sendMessage({
    type: "elatura:record-transform-opt-in",
    acknowledgements: [...TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS],
  })) as TransformOptInState;
  setStatus("Opt-in intent recorded for this session. Transforms remain locked and unauthorized.");
  await render(undefined, undefined, optIn);
});

document.querySelector("#revoke-opt-in")!.addEventListener("click", async () => {
  const optIn = (await browser.runtime.sendMessage({
    type: "elatura:revoke-transform-opt-in",
  })) as TransformOptInState;
  setStatus("Transform opt-in intent revoked. Transforms remain locked.");
  await render(undefined, undefined, optIn);
});

document.querySelector("#emergency-disable")!.addEventListener("click", async () => {
  const safety = (await browser.runtime.sendMessage({
    type: "elatura:emergency-disable-transforms",
  })) as TransformSafetyState;
  setStatus("Transforms are locally locked and opt-in intent was cleared. Observation and ordinary browsing remain available.");
  await render(undefined, safety);
});

void render();
