// SPDX-License-Identifier: MPL-2.0
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "check-chatgpt-lane-activity-observation.mjs");
const tempPaths: string[] = [];

function diagnostic(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    laneRef: "elatura:lane:cli-private-ref",
    laneGeneration: 4,
    observedAtMs: 1_000_100,
    source: "reviewed-live-sentinel",
    confidence: "probable",
    generation: "inactive",
    composer: "clean",
    composition: "inactive",
    modal: "inactive",
    mediaOrDevice: "unknown",
    download: "unknown",
    otherTransient: "unknown",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    ...overrides,
  };
}

function run(value: unknown) {
  const directory = mkdtempSync(resolve(tmpdir(), "elatura-chatgpt-activity-"));
  tempPaths.push(directory);
  const path = resolve(directory, "diagnostic.json");
  writeFileSync(path, JSON.stringify(value), "utf8");
  return spawnSync(process.execPath, [SCRIPT, path], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });
}

afterEach(() => {
  while (tempPaths.length > 0) {
    const path = tempPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

describe("ChatGPT activity diagnostic checker", () => {
  it("accepts one exact canonical content-free observation without echoing lane identity", () => {
    const result = run(diagnostic());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "pass source=reviewed-live-sentinel confidence=probable privacy=content-free",
    );
    expect(result.stdout).not.toContain("cli-private-ref");
    expect(result.stderr).toBe("");
  });

  it("rejects decorated observations with a fixed error token and zero payload echo", () => {
    const result = run(diagnostic({ privatePayload: "must-never-echo" }));

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("fail schema-invalid\n");
    expect(result.stderr).not.toContain("must-never-echo");
    expect(result.stderr).not.toContain("cli-private-ref");
  });
});
