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

const FORBIDDEN_FIELD_NAMES = new Set([
  "authorization",
  "authorizationheader",
  "cookie",
  "cookies",
  "headers",
  "message",
  "messagetext",
  "querystring",
  "rawurl",
  "responsebody",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function inspect(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(normalizedKey(key))) {
      throw new Error(`Benchmark report contains forbidden field at ${path}.${key}`);
    }
    if (normalizedKey(key) === "pathtemplate" && typeof child === "string" && child.includes("?")) {
      throw new Error(`Benchmark report path template contains a query string at ${path}.${key}`);
    }
    inspect(child, `${path}.${key}`);
  }
}

export function assertContentFreeReport(report: unknown): void {
  inspect(report, "$report");
}
