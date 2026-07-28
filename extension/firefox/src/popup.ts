// SPDX-License-Identifier: MPL-2.0

type PopupRequestMetric = { bytes?: number };
type PopupPageMetric = { kind?: string; elapsedMs?: number };

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

async function render(): Promise<void> {
  const data = await browser.storage.local.get<{
    requestMetrics?: PopupRequestMetric[];
    pageMetrics?: PopupPageMetric[];
  }>({ requestMetrics: [], pageMetrics: [] });

  const requests = data.requestMetrics ?? [];
  const totalBytes = requests.reduce((sum, metric) => sum + (metric.bytes ?? 0), 0);
  const composer = [...(data.pageMetrics ?? [])]
    .reverse()
    .find((metric) => metric.kind === "composer-like-input");

  document.querySelector("#requests")!.textContent = String(requests.length);
  document.querySelector("#bytes")!.textContent = formatBytes(totalBytes);
  document.querySelector("#composer")!.textContent = composer?.elapsedMs
    ? `${composer.elapsedMs.toFixed(0)} ms`
    : "not observed";
}

document.querySelector("#clear")!.addEventListener("click", async () => {
  await browser.storage.local.clear();
  document.querySelector("#status")!.textContent = "Local measurements cleared.";
  await render();
});

void render();
