// SPDX-License-Identifier: MPL-2.0
import {
  buildObservationReport,
  hasObservationData,
  type StoredObservationState,
} from "./report.js";

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

async function render(state?: StoredObservationState): Promise<void> {
  const resolvedState = state ?? (await getState());
  const run = resolvedState.activeRun ?? null;
  document.querySelector("#mode")!.textContent = run ? "recording" : "idle";
  document.querySelector("#run")!.textContent = run ? run.id.slice(0, 8) : "none";
  document.querySelector("#requests")!.textContent = String(resolvedState.summary.requestCount);
  document.querySelector("#bytes")!.textContent = formatBytes(resolvedState.summary.totalBytesObserved);
  document.querySelector("#composer")!.textContent =
    resolvedState.pageMarks.composerReadyMs === null
      ? "not observed"
      : `${resolvedState.pageMarks.composerReadyMs.toFixed(0)} ms`;
  document.querySelector<HTMLButtonElement>("#export")!.disabled = !run || !hasObservationData(resolvedState);
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

void render();
