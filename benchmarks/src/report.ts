// SPDX-License-Identifier: MPL-2.0

export type ElaturaMode = "edge-baseline" | "firefox-baseline" | "observe" | "safe" | "cached";

export type BenchmarkRun = {
  schemaVersion: 1;
  runId: string;
  recordedAt: string;
  mode: ElaturaMode;
  browser: { name: string; version: string; profile: "clean" | "existing" };
  workload: { label: string; redactedPathTemplate?: string };
  measurements: {
    responseBytes?: number;
    networkCompleteMs?: number;
    composerReadyMs?: number;
    newestContentVisibleMs?: number;
    scrollResponsiveMs?: number;
    peakContentProcessBytes?: number;
    extensionProcessBytes?: number;
    longTaskCount?: number;
    longTaskDurationMs?: number;
    domNodeCount?: number;
  };
  outcome: { completed: boolean; crashed: boolean; notes?: string[] };
};

export function assertContentFreeReport(report: BenchmarkRun): void {
  const serialized = JSON.stringify(report).toLowerCase();
  const forbiddenKeys = ["cookie", "authorization", "message_text", "response_body", "query_string"];
  for (const key of forbiddenKeys) {
    if (serialized.includes(key)) throw new Error(`Benchmark report contains forbidden field marker: ${key}`);
  }
}
