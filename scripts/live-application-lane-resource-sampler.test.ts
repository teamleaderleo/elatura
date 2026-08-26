// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  aggregateLiveLaneProcessSnapshot,
  createLiveLaneSamplerFooter,
  createLiveLaneSamplerHeader,
  createLiveLaneSamplerSampleLine,
  createLiveLaneSamplerState,
  parseLiveLaneSamplerState,
  parseNumericPsProcessTable,
  readNumericPsProcessTable,
} from "./live-application-lane-resource-sampler.mjs";

const PS = [
  "1 0 10 0.1",
  "10 1 1000 10.0",
  "11 10 500 2.5",
  "12 11 300 1.0",
  "20 1 700 3.0",
  "21 20 200 0.5",
  "30 11 100 0.1",
  "",
].join("\n");

function state(overrides: Record<string, unknown> = {}) {
  return createLiveLaneSamplerState({
    phase: "steady-foreground",
    laneOrdinal: 1,
    browserRootPid: 10,
    externalElaturaRootPid: 20,
    memoryPressureClass: "normal",
    updatedAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("live-lane numeric process snapshot", () => {
  it("parses only numeric pid/ppid/rss/cpu columns and converts KiB RSS to bytes", () => {
    const rows = parseNumericPsProcessTable(PS);
    expect(rows).toHaveLength(7);
    expect(rows[1]).toEqual({
      pid: 10,
      parentPid: 1,
      rssBytes: 1_024_000,
      cpuPercent: 10,
    });
    expect(() => parseNumericPsProcessTable("10 1 100 1.0 browser-title-or-command")).toThrow(
      "process snapshot row is invalid",
    );
    expect(() => parseNumericPsProcessTable("10 1 100 1.0\n10 1 100 1.0\n")).toThrow(
      "duplicate pid",
    );
  });

  it("invokes ps with numeric columns only", () => {
    let invocation: { command?: string; args?: readonly string[] } = {};
    const rows = readNumericPsProcessTable({
      platform: "linux",
      spawn(command: string, args: readonly string[]) {
        invocation = { command, args };
        return { status: 0, stdout: "10 1 100 1.0\n", stderr: "", error: undefined };
      },
    });
    expect(rows).toHaveLength(1);
    expect(invocation.command).toBe("ps");
    expect(invocation.args).toEqual(["-axo", "pid=,ppid=,rss=,%cpu="]);
    expect(invocation.args?.join(" ")).not.toMatch(/comm|command|args/u);
  });

  it("can read the current process from the host ps implementation", () => {
    if (process.platform !== "darwin" && process.platform !== "linux") return;
    const rows = readNumericPsProcessTable();
    expect(rows.some((row) => row.pid === process.pid)).toBe(true);
  });
});

describe("live-lane process-tree aggregation", () => {
  it("sums browser and external Elatura descendants without double counting", () => {
    const result = aggregateLiveLaneProcessSnapshot(
      parseNumericPsProcessTable(PS),
      state(),
      4_000,
    );
    expect(result.roots).toEqual({ browser: "present", externalElatura: "present" });
    expect(result.sample).toEqual({
      elapsedMs: 4_000,
      phase: "steady-foreground",
      laneOrdinal: 1,
      targetHostRssBytes: (1000 + 500 + 300 + 100 + 700 + 200) * 1024,
      browserTreeRssBytes: (1000 + 500 + 300 + 100) * 1024,
      externalElaturaRssBytes: (700 + 200) * 1024,
      targetHostCpuPercent: 17.1,
      browserTreeCpuPercent: 13.6,
      externalElaturaCpuPercent: 3.5,
      targetHostProcessCount: 6,
      browserTreeProcessCount: 4,
      externalElaturaProcessCount: 2,
      memoryPressureClass: "normal",
    });
  });

  it("keeps an absent external process tree semantically distinct from zero usage", () => {
    const result = aggregateLiveLaneProcessSnapshot(
      parseNumericPsProcessTable(PS),
      state({ externalElaturaRootPid: null }),
      0,
    );
    expect(result.roots.externalElatura).toBe("unset");
    expect(result.sample.externalElaturaRssBytes).toBeNull();
    expect(result.sample.externalElaturaCpuPercent).toBeNull();
    expect(result.sample.externalElaturaProcessCount).toBe(0);
    expect(result.sample.targetHostRssBytes).toBe(result.sample.browserTreeRssBytes);
  });

  it("surfaces configured roots that disappeared from the process snapshot", () => {
    const result = aggregateLiveLaneProcessSnapshot(
      parseNumericPsProcessTable(PS),
      state({ browserRootPid: 999 }),
      2_000,
    );
    expect(result.roots.browser).toBe("missing");
    expect(result.sample.browserTreeProcessCount).toBe(0);
    expect(result.sample.targetHostProcessCount).toBe(2);
  });

  it("rejects overlapping browser and external Elatura trees", () => {
    expect(() => aggregateLiveLaneProcessSnapshot(
      parseNumericPsProcessTable(PS),
      state({ externalElaturaRootPid: 11 }),
      2_000,
    )).toThrow("process trees overlap");
  });
});

describe("live-lane sampler records", () => {
  it("rejects decorated sampler state", () => {
    const valid = state();
    expect(() => parseLiveLaneSamplerState({ ...valid, extra: "private-data" })).toThrow(
      "sampler state is invalid",
    );
  });

  it("keeps process identifiers out of header/sample/footer evidence lines", () => {
    const aggregate = aggregateLiveLaneProcessSnapshot(
      parseNumericPsProcessTable(PS),
      state(),
      2_000,
    );
    const records = [
      createLiveLaneSamplerHeader({
        startedAt: "2099-01-01T00:00:00.000Z",
        platform: "linux",
      }),
      createLiveLaneSamplerSampleLine({
        capturedAt: "2099-01-01T00:00:02.000Z",
        aggregate,
      }),
      createLiveLaneSamplerFooter({
        stoppedAt: "2099-01-01T00:00:03.000Z",
        sampleCount: 1,
        stopReason: "signal",
      }),
    ];
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("browserRootPid");
    expect(serialized).not.toContain("externalElaturaRootPid");
    expect(serialized).not.toContain('"pid"');
    expect(serialized).not.toMatch(/commandLine|processName|title|url/iu);
  });
});
