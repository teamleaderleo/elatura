// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const timing = join(repoRoot, "scripts", "validate-live-application-lane-timing.mjs");

function plan(slotCount = 2) {
  return {
    generatedAt: "2026-08-27T00:00:00.000Z",
    protocol: { betweenPhysicalSubrunsMs: 60_000 },
    stages: [
      {
        stage: "chatgpt-single",
        blocks: [
          {
            number: 1,
            slots: Array.from({ length: slotCount }, (_, index) => ({
              conditionOrdinal: index + 1,
              physicalSubruns: [{ ordinal: 1 }],
            })),
          },
        ],
      },
    ],
  };
}

function run(conditionOrdinal: number, startedAt: string, recordedAt: string) {
  return {
    kind: "live-application-lane-run",
    startedAt,
    recordedAt,
    block: {
      stage: "chatgpt-single",
      number: 1,
      conditionOrdinal,
      physicalSubrunOrdinal: 1,
    },
  };
}

function execute(runs: unknown[], planValue = plan()) {
  const root = mkdtempSync(join(tmpdir(), "elatura-live-timing-"));
  try {
    const planPath = join(root, "plan.json");
    const finalDirectory = join(root, "final");
    mkdirSync(finalDirectory);
    writeFileSync(planPath, `${JSON.stringify(planValue, null, 2)}\n`, "utf8");
    runs.forEach((value, index) => {
      writeFileSync(
        join(finalDirectory, `run-${String(index + 1).padStart(2, "0")}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
    });
    return spawnSync(process.execPath, [timing, planPath, finalDirectory], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function issueCodes(result: ReturnType<typeof execute>) {
  return JSON.parse(result.stdout).issues.map((entry: { code: string }) => entry.code);
}

describe("live-lane timing admission", () => {
  it("admits a run sequence with exactly the preregistered 60-second cooldown", () => {
    const result = execute([
      run(1, "2026-08-27T00:01:00.000Z", "2026-08-27T00:02:00.000Z"),
      run(2, "2026-08-27T00:03:00.000Z", "2026-08-27T00:04:00.000Z"),
    ]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("rejects a ten-second cooldown", () => {
    const result = execute([
      run(1, "2026-08-27T00:01:00.000Z", "2026-08-27T00:02:00.000Z"),
      run(2, "2026-08-27T00:02:10.000Z", "2026-08-27T00:03:10.000Z"),
    ]);
    expect(result.status).toBe(2);
    expect(issueCodes(result)).toContain("inter-run-cooldown-violation");
  });

  it("rejects one millisecond below the preregistered cooldown", () => {
    const result = execute([
      run(1, "2026-08-27T00:01:00.000Z", "2026-08-27T00:02:00.000Z"),
      run(2, "2026-08-27T00:02:59.999Z", "2026-08-27T00:03:59.999Z"),
    ]);
    expect(result.status).toBe(2);
    expect(issueCodes(result)).toContain("inter-run-cooldown-violation");
  });

  it("rejects a run whose completion does not follow its start", () => {
    const result = execute([
      run(1, "2026-08-27T00:01:00.000Z", "2026-08-27T00:01:00.000Z"),
    ], plan(1));
    expect(result.status).toBe(2);
    expect(issueCodes(result)).toContain("run-time-order-violation");
  });

  it("rejects a run that starts before or at plan creation", () => {
    const result = execute([
      run(1, "2026-08-27T00:00:00.000Z", "2026-08-27T00:01:00.000Z"),
    ], plan(1));
    expect(result.status).toBe(2);
    expect(issueCodes(result)).toContain("started-before-plan");
  });

  it("rejects non-canonical start timestamps with a fixed code", () => {
    const result = execute([
      run(1, "2026-08-27T00:01:00Z", "2026-08-27T00:02:00.000Z"),
    ], plan(1));
    expect(result.status).toBe(2);
    expect(issueCodes(result)).toContain("invalid-started-at");
  });

  it("does not infer cooldown continuity across an absent planned slot", () => {
    const result = execute([
      run(1, "2026-08-27T00:01:00.000Z", "2026-08-27T00:02:00.000Z"),
      run(3, "2026-08-27T00:02:10.000Z", "2026-08-27T00:03:10.000Z"),
    ], plan(3));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
