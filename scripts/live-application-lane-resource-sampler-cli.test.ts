// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateLiveLaneProcessSnapshot,
  createLiveLaneSamplerFooter,
  createLiveLaneSamplerHeader,
  createLiveLaneSamplerSampleLine,
  createLiveLaneSamplerState,
  parseNumericPsProcessTable,
} from "./live-application-lane-resource-sampler.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const stateCli = join(ROOT, "scripts", "set-live-application-lane-sampler-state.mjs");
const samplerCli = join(ROOT, "scripts", "run-live-application-lane-resource-sampler.mjs");
const checkCli = join(ROOT, "scripts", "check-live-application-lane-resource-sampler.mjs");
const temporaryRoots: string[] = [];

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `elatura-${label}-`));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

function run(command: string, args: string[]) {
  return spawnSync(process.execPath, [command, ...args], { encoding: "utf8" });
}

function parsedStdout(result: ReturnType<typeof run>) {
  return JSON.parse(result.stdout) as Record<string, any>;
}

function fixtureAggregate(elapsedMs: number, phase = "steady-foreground") {
  const rows = parseNumericPsProcessTable([
    "10 1 1000 10.0",
    "11 10 500 2.0",
    "20 1 200 1.0",
    "",
  ].join("\n"));
  return aggregateLiveLaneProcessSnapshot(
    rows,
    createLiveLaneSamplerState({
      phase,
      laneOrdinal: 1,
      browserRootPid: 10,
      externalElaturaRootPid: 20,
      memoryPressureClass: "normal",
      updatedAt: "2099-01-01T00:00:00.000Z",
    }),
    elapsedMs,
  );
}

describe("live-lane sampler state CLI", () => {
  it("creates and atomically updates a private control state without echoing PIDs", () => {
    const root = temporaryRoot("sampler-state");
    const path = join(root, "state.json");
    const first = run(stateCli, [
      path,
      "--phase", "initial-hydration",
      "--browser-root-pid", "12345",
      "--elatura-root-pid", "23456",
      "--memory-pressure", "warn",
      "--at", "2099-01-01T00:00:00.000Z",
    ]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).not.toContain("12345");
    expect(first.stdout).not.toContain("23456");
    expect(parsedStdout(first)).toMatchObject({
      valid: true,
      phase: "initial-hydration",
      browserRoot: "set",
      externalElaturaRoot: "set",
      memoryPressureClass: "warn",
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      browserRootPid: 12345,
      externalElaturaRootPid: 23456,
    });

    const second = run(stateCli, [
      path,
      "--phase", "steady-foreground",
      "--browser-root-pid", "clear",
      "--at", "2099-01-01T00:00:01.000Z",
    ]);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      phase: "steady-foreground",
      browserRootPid: null,
      externalElaturaRootPid: 23456,
      memoryPressureClass: "warn",
    });
  });
});

describe("live-lane sampler checker", () => {
  it("validates a graceful content-free sidecar and extracts only run resource samples", () => {
    const root = temporaryRoot("sampler-check");
    const input = join(root, "samples.jsonl");
    const extract = join(root, "resource-samples.json");
    const lines = [
      createLiveLaneSamplerHeader({
        startedAt: "2099-01-01T00:00:00.000Z",
        platform: "linux",
      }),
      createLiveLaneSamplerSampleLine({
        capturedAt: "2099-01-01T00:00:00.050Z",
        aggregate: fixtureAggregate(0, "launch"),
      }),
      createLiveLaneSamplerSampleLine({
        capturedAt: "2099-01-01T00:00:02.050Z",
        aggregate: fixtureAggregate(2_000),
      }),
      createLiveLaneSamplerSampleLine({
        capturedAt: "2099-01-01T00:00:04.250Z",
        aggregate: fixtureAggregate(4_200),
      }),
      createLiveLaneSamplerFooter({
        stoppedAt: "2099-01-01T00:00:04.300Z",
        sampleCount: 3,
        stopReason: "signal",
      }),
    ];
    writeFileSync(input, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

    const result = run(checkCli, [input, "--extract", extract]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(parsedStdout(result)).toMatchObject({
      valid: true,
      samplePeriodMs: 2_000,
      sampleCount: 3,
      stopReason: "signal",
      spacing: { minimumMs: 2_000, medianMs: 2_100, maximumMs: 2_200 },
      browserMissingSamples: 0,
      externalElaturaMissingSamples: 0,
      extractWritten: true,
      privacy: "content-free-process-aggregates",
    });
    const extracted = JSON.parse(readFileSync(extract, "utf8"));
    expect(extracted).toHaveLength(3);
    expect(extracted[0]).toEqual(lines[1].sample);
    expect(JSON.stringify(extracted)).not.toMatch(/pid|command|processName/iu);
  });

  it("refuses sidecars without a graceful footer or with reported sampler errors", () => {
    const root = temporaryRoot("sampler-invalid");
    const missingFooter = join(root, "missing-footer.jsonl");
    const header = createLiveLaneSamplerHeader({
      startedAt: "2099-01-01T00:00:00.000Z",
      platform: "linux",
    });
    const sample = createLiveLaneSamplerSampleLine({
      capturedAt: "2099-01-01T00:00:00.050Z",
      aggregate: fixtureAggregate(0),
    });
    writeFileSync(missingFooter, `${JSON.stringify(header)}\n${JSON.stringify(sample)}\n`, "utf8");
    const first = run(checkCli, [missingFooter]);
    expect(first.status).toBe(2);
    expect(parsedStdout(first).valid).toBe(false);

    const errorFile = join(root, "error.jsonl");
    const errorFooter = createLiveLaneSamplerFooter({
      stoppedAt: "2099-01-01T00:00:01.000Z",
      sampleCount: 1,
      stopReason: "error",
      errorCode: "process-snapshot-failed",
    });
    writeFileSync(
      errorFile,
      `${[header, sample, errorFooter].map((line) => JSON.stringify(line)).join("\n")}\n`,
      "utf8",
    );
    const second = run(checkCli, [errorFile]);
    expect(second.status).toBe(2);
    expect(parsedStdout(second)).toEqual({
      kind: "live-application-lane-resource-sampler-check",
      valid: false,
      issues: [{ code: "sampler-reported-error" }],
    });
  });
});

describe("live-lane sampler runner", () => {
  it("produces one graceful numeric sidecar on the host ps implementation", () => {
    if (process.platform !== "darwin" && process.platform !== "linux") return;
    const root = temporaryRoot("sampler-runner");
    const statePath = join(root, "state.json");
    const out = join(root, "raw.jsonl");
    writeFileSync(
      statePath,
      `${JSON.stringify(createLiveLaneSamplerState({
        phase: "launch",
        memoryPressureClass: "unknown",
        updatedAt: "2099-01-01T00:00:00.000Z",
      }), null, 2)}\n`,
      "utf8",
    );
    const sampled = run(samplerCli, [
      "--state", statePath,
      "--out", out,
      "--duration-ms", "25",
    ]);
    expect(sampled.status, `${sampled.stdout}\n${sampled.stderr}`).toBe(0);
    expect(parsedStdout(sampled)).toMatchObject({
      kind: "live-application-lane-resource-sampler-complete",
      sampleCount: 1,
      stopReason: "duration",
      samplePeriodMs: 2_000,
    });
    const checked = run(checkCli, [out]);
    expect(checked.status, `${checked.stdout}\n${checked.stderr}`).toBe(0);
    expect(parsedStdout(checked)).toMatchObject({ valid: true, sampleCount: 1 });
  });
});
