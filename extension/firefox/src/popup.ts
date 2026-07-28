// SPDX-License-Identifier: MPL-2.0

type ObservationRun = {
  id: string;
  startedAt: string;
};

type PopupRequestMetric = {
  runId: string;
  method: string;
  resourceType: string;
  pathTemplate: string;
  bytes: number;
  durationMs: number;
  outcome: "stopped" | "error";
  recordedAt: string;
};

type PopupPageMetric = {
  runId: string;
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
  pathTemplate: string;
};

type ObservationState = {
  activeRun?: ObservationRun;
  requestMetrics?: PopupRequestMetric[];
  pageMetrics?: PopupPageMetric[];
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

async function getState(): Promise<ObservationState> {
  return (await browser.runtime.sendMessage({ type: "elatura:get-state" })) as ObservationState;
}

function metricsForRun(state: ObservationState): {
  run: ObservationRun | null;
  requests: PopupRequestMetric[];
  pages: PopupPageMetric[];
} {
  const run = state.activeRun ?? null;
  if (!run) return { run: null, requests: [], pages: [] };
  return {
    run,
    requests: (state.requestMetrics ?? []).filter((metric) => metric.runId === run.id),
    pages: (state.pageMetrics ?? []).filter((metric) => metric.runId === run.id),
  };
}

async function render(state = await getState()): Promise<void> {
  const { run, requests, pages } = metricsForRun(state);
  const totalBytes = requests.reduce((sum, metric) => sum + metric.bytes, 0);
  const composer = [...pages].reverse().find((metric) => metric.kind === "composer-like-input");

  document.querySelector("#mode")!.textContent = run ? "recording" : "idle";
  document.querySelector("#run")!.textContent = run ? run.id.slice(0, 8) : "none";
  document.querySelector("#requests")!.textContent = String(requests.length);
  document.querySelector("#bytes")!.textContent = formatBytes(totalBytes);
  document.querySelector("#composer")!.textContent = composer
    ? `${composer.elapsedMs.toFixed(0)} ms`
    : "not observed";
  document.querySelector<HTMLButtonElement>("#export")!.disabled =
    !run || (requests.length === 0 && pages.length === 0);
}

async function buildReport(state: ObservationState): Promise<Record<string, unknown>> {
  const { run, requests, pages } = metricsForRun(state);
  if (!run) throw new Error("Start an observation run before exporting.");

  const pathGroups = new Map<
    string,
    {
      pathTemplate: string;
      count: number;
      bytes: number;
      durationMs: number;
      maxDurationMs: number;
      errors: number;
      methods: Set<string>;
      resourceTypes: Set<string>;
    }
  >();

  for (const metric of requests) {
    const group = pathGroups.get(metric.pathTemplate) ?? {
      pathTemplate: metric.pathTemplate,
      count: 0,
      bytes: 0,
      durationMs: 0,
      maxDurationMs: 0,
      errors: 0,
      methods: new Set<string>(),
      resourceTypes: new Set<string>(),
    };
    group.count += 1;
    group.bytes += metric.bytes;
    group.durationMs += metric.durationMs;
    group.maxDurationMs = Math.max(group.maxDurationMs, metric.durationMs);
    if (metric.outcome === "error") group.errors += 1;
    group.methods.add(metric.method);
    group.resourceTypes.add(metric.resourceType);
    pathGroups.set(metric.pathTemplate, group);
  }

  const browserInfo = await browser.runtime.getBrowserInfo();
  const generatedAt = new Date().toISOString();
  const latestMark = (kind: PopupPageMetric["kind"]): number | null =>
    [...pages].reverse().find((metric) => metric.kind === kind)?.elapsedMs ?? null;

  return {
    schemaVersion: 1,
    generatedAt,
    mode: "observe",
    run: {
      id: run.id,
      startedAt: run.startedAt,
      exportedAt: generatedAt,
    },
    extension: {
      version: browser.runtime.getManifest().version,
    },
    browser: {
      name: browserInfo.name,
      vendor: browserInfo.vendor,
      version: browserInfo.version,
      buildID: browserInfo.buildID,
    },
    privacy: {
      responseBodiesCaptured: false,
      messageTextCaptured: false,
      queryStringsCaptured: false,
      credentialsCaptured: false,
      pathsRedacted: true,
    },
    summary: {
      requestCount: requests.length,
      totalBytesObserved: requests.reduce((sum, metric) => sum + metric.bytes, 0),
      totalRequestDurationMs: requests.reduce((sum, metric) => sum + metric.durationMs, 0),
      requestErrorCount: requests.filter((metric) => metric.outcome === "error").length,
      domContentLoadedMs: latestMark("dom-content-loaded"),
      composerReadyMs: latestMark("composer-like-input"),
    },
    requestPaths: [...pathGroups.values()]
      .sort((left, right) => right.bytes - left.bytes)
      .map((group) => ({
        pathTemplate: group.pathTemplate,
        count: group.count,
        bytes: group.bytes,
        durationMs: group.durationMs,
        maxDurationMs: group.maxDurationMs,
        errors: group.errors,
        methods: [...group.methods].sort(),
        resourceTypes: [...group.resourceTypes].sort(),
      })),
  };
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
    const report = await buildReport(await getState());
    const json = JSON.stringify(report, null, 2);
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    await browser.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
      filename: `elatura/observe-${timestamp}.json`,
      saveAs: true,
    });
    setStatus("Content-free JSON report exported.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Report export failed.");
  }
});

document.querySelector("#clear")!.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "elatura:clear-run" });
  setStatus("Observation stopped and local measurements cleared.");
  await render();
});

void render();
