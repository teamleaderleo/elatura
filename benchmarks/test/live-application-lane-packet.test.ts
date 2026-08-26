// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const createPlanScript = join(repoRoot, "scripts", "create-live-application-lane-plan.mjs");
const verifyPlanScript = join(repoRoot, "scripts", "verify-live-application-lane-plan.mjs");
const checkSessionScript = join(repoRoot, "scripts", "check-live-application-lane-session.mjs");
const planSchemaPath = join(repoRoot, "benchmarks", "schema", "live-application-lane-plan-v1.schema.json");
const runSchemaPath = join(repoRoot, "benchmarks", "schema", "live-application-lane-run-v1.schema.json");
const projectionSchemaPath = join(repoRoot, "benchmarks", "schema", "live-application-lane-projection-v1.schema.json");
const scratch: string[] = [];

const generatorArgs = [
  "--edge-version", "140.0", "--edge-build", "edge-build-1",
  "--chrome-version", "140.0", "--chrome-build", "chrome-build-1",
  "--chromium-version", "140.0", "--chromium-build", "chromium-build-1",
  "--firefox-version", "142.0", "--firefox-build", "firefox-build-1",
  "--elatura-revision", "abc1234",
  "--firefox-intervention", "latest3-v1",
  "--chromium-intervention", "parking-v1",
  "--chromium-transport", "extension-only",
];

function generatePlan() {
  const result = spawnSync(process.execPath, [createPlanScript, ...generatorArgs], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, any>;
}

function makeScratch() {
  const path = mkdtempSync(join(tmpdir(), "elatura-live-lane-"));
  scratch.push(path);
  return path;
}

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("live application lane experiment packet", () => {
  it("generates the canonical 112-subrun resource plan", () => {
    const plan = generatePlan();
    expect(plan.kind).toBe("live-application-lane-plan");
    expect(plan.elatura.chromiumTransport).toBe("extension-only");
    expect(plan.stages.map((stage: any) => stage.stage)).toEqual([
      "chatgpt-single",
      "chatgpt-switch-8",
      "gdocs-single",
      "gdocs-switch-8",
    ]);
    expect(plan.stages.map((stage: any) => stage.workloadToken)).toEqual([
      "chatgpt-pathological-a",
      "chatgpt-switch-8",
      "docs-large-text-v1",
      "docs-switch-8-v1",
    ]);
    const physicalRuns = plan.stages.reduce(
      (total: number, stage: any) => total + stage.blocks.reduce(
        (blockTotal: number, block: any) => blockTotal + block.slots.reduce(
          (slotTotal: number, slot: any) => slotTotal + slot.physicalSubruns.length,
          0,
        ),
        0,
      ),
      0,
    );
    expect(physicalRuns).toBe(112);
    expect(plan.stages[0].blocks[0].conditionOrder).toEqual(["ES", "CS", "CRE", "CRS", "FE", "FS"]);
    expect(plan.stages[0].blocks[0].slots.find((slot: any) => slot.conditionCode === "FE").physicalSubruns)
      .toEqual([{ ordinal: 1, mode: "passive" }, { ordinal: 2, mode: "managed" }]);
    expect(plan.stages[0].blocks[1].slots.find((slot: any) => slot.conditionCode === "FE").physicalSubruns)
      .toEqual([{ ordinal: 1, mode: "managed" }, { ordinal: 2, mode: "passive" }]);
  });

  it("keeps benchmark pairing, browser projection, and Elatura lane identity separate", () => {
    const projectionSchema = JSON.parse(readFileSync(projectionSchemaPath, "utf8"));
    const lane = projectionSchema.$defs.lane;
    expect(lane.required).toContain("benchmarkLaneToken");
    expect(lane.required).toContain("browserProjectionGeneration");
    expect(lane.required).toContain("elaturaLane");
    expect(lane.required).not.toContain("tabId");
    expect(projectionSchema.$defs.elaturaLane.required).toEqual(["laneRef", "laneGeneration", "state"]);
    expect(projectionSchema.$defs.event.properties.confidence.enum).toEqual(["exact", "probable", "unknown"]);
    expect(projectionSchema.$defs.event.properties.grantsWorkAuthority.const).toBe(false);
    expect(projectionSchema.$defs.event.properties.authorizesWorkDispatch.const).toBe(false);
  });

  it("admits a preregistered extension-only Chromium transport without weakening the plan", () => {
    const planSchema = JSON.parse(readFileSync(planSchemaPath, "utf8"));
    const runSchema = JSON.parse(readFileSync(runSchemaPath, "utf8"));
    expect(planSchema.properties.elatura.properties.chromiumTransport.enum).toEqual(["extension-only", "extension-cdp"]);
    expect(runSchema.properties.condition.properties.elatura.properties.transport.enum).toContain("chromium-extension");
    expect(runSchema.properties.condition.properties.elatura.properties.transport.enum).toContain("chromium-extension-cdp");
  });

  it("accepts the generated plan and rejects a rewritten condition order", () => {
    const directory = makeScratch();
    const plan = generatePlan();
    const planPath = join(directory, "plan.json");
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const valid = spawnSync(process.execPath, [verifyPlanScript, planPath], { encoding: "utf8" });
    expect(valid.status, valid.stderr).toBe(0);
    expect(JSON.parse(valid.stdout).valid).toBe(true);

    plan.stages[0].blocks[0].conditionOrder = [...plan.stages[0].blocks[0].conditionOrder].reverse();
    const rewrittenPath = join(directory, "rewritten.json");
    writeFileSync(rewrittenPath, `${JSON.stringify(plan, null, 2)}\n`);
    const rewritten = spawnSync(process.execPath, [verifyPlanScript, rewrittenPath], { encoding: "utf8" });
    expect(rewritten.status).toBe(2);
    expect(JSON.parse(rewritten.stdout).issues).toContainEqual({
      code: "block-definition-mismatch",
      key: "chatgpt-single|1",
    });
  });

  it("reports every absent physical slot instead of treating an empty bundle as ready", () => {
    const directory = makeScratch();
    const finalDirectory = join(directory, "final");
    mkdirSync(finalDirectory);
    const plan = generatePlan();
    const planPath = join(directory, "plan.json");
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const checked = spawnSync(process.execPath, [checkSessionScript, planPath, finalDirectory], { encoding: "utf8" });
    expect(checked.status, checked.stderr).toBe(2);
    const result = JSON.parse(checked.stdout);
    expect(result.ready).toBe(false);
    expect(result.scope).toBe("full");
    expect(result.fullPlannedRunCount).toBe(112);
    expect(result.expectedRunCount).toBe(112);
    expect(result.runCount).toBe(0);
    expect(result.issues.filter((entry: any) => entry.code === "missing-run-slot")).toHaveLength(112);
  });

  it("admits one predeclared stage independently without redefining the full plan", () => {
    const directory = makeScratch();
    const finalDirectory = join(directory, "chatgpt-single-final");
    mkdirSync(finalDirectory);
    const plan = generatePlan();
    const planPath = join(directory, "plan.json");
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const checked = spawnSync(
      process.execPath,
      [checkSessionScript, planPath, finalDirectory, "--stage", "chatgpt-single"],
      { encoding: "utf8" },
    );
    expect(checked.status, checked.stderr).toBe(2);
    const result = JSON.parse(checked.stdout);
    expect(result.scope).toBe("chatgpt-single");
    expect(result.fullPlannedRunCount).toBe(112);
    expect(result.expectedRunCount).toBe(40);
    expect(result.issues.filter((entry: any) => entry.code === "missing-run-slot")).toHaveLength(40);
  });

  it("refuses an invented stage scope", () => {
    const directory = makeScratch();
    const finalDirectory = join(directory, "final");
    mkdirSync(finalDirectory);
    const plan = generatePlan();
    const planPath = join(directory, "plan.json");
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const checked = spawnSync(
      process.execPath,
      [checkSessionScript, planPath, finalDirectory, "--stage", "chatgpt-convenient-subset"],
      { encoding: "utf8" },
    );
    expect(checked.status).toBe(2);
    expect(checked.stderr).toContain("Usage:");
  });

  it("rejects an unregistered Chromium transport", () => {
    const directory = makeScratch();
    const plan = generatePlan();
    plan.elatura.chromiumTransport = "debugger-whenever-convenient";
    const planPath = join(directory, "plan.json");
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    const checked = spawnSync(process.execPath, [verifyPlanScript, planPath], { encoding: "utf8" });
    expect(checked.status).toBe(2);
    expect(JSON.parse(checked.stdout).issues).toContainEqual({
      code: "chromium-transport-invalid",
      key: null,
    });
  });
});
