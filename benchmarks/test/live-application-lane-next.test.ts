// SPDX-License-Identifier: MPL-2.0
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectedLiveLaneCondition,
  plannedLiveLaneSubruns,
} from "../../scripts/live-application-lane-utils.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsGenerator = join(repoRoot, "scripts", "generate-google-docs-workload.mjs");
const planGenerator = join(repoRoot, "scripts", "create-live-application-lane-plan.mjs");
const nextRun = join(repoRoot, "scripts", "next-live-application-lane-run.mjs");

let root = "";
let planPath = "";
let plan: Record<string, any>;
let planned: readonly Record<string, any>[];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "elatura-live-next-"));
  const docsRoot = join(root, "docs");
  const generated = spawnSync(process.execPath, [docsGenerator, "--out", docsRoot], { encoding: "utf8" });
  expect(generated.status, generated.stderr).toBe(0);
  const result = spawnSync(
    process.execPath,
    [
      planGenerator,
      "--edge-version", "140.0", "--edge-build", "edge-build-1",
      "--chrome-version", "140.0", "--chrome-build", "chrome-build-1",
      "--chromium-version", "140.0", "--chromium-build", "chromium-build-1",
      "--firefox-version", "142.0", "--firefox-build", "firefox-build-1",
      "--elatura-revision", "next-helper-test",
      "--firefox-intervention", "latest3-v1",
      "--chromium-intervention", "parking-v1",
      "--chromium-transport", "extension-only",
      "--gdocs-manifest", join(docsRoot, "manifest.json"),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  plan = JSON.parse(result.stdout);
  planPath = join(root, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  planned = plannedLiveLaneSubruns(plan, "chatgpt-single");
  expect(planned).toHaveLength(40);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function runFor(entry: Record<string, any>, index: number) {
  const condition = expectedLiveLaneCondition(plan, entry);
  const minute = 2 + index * 2;
  const startedAt = new Date(Date.UTC(2099, 0, 1, 0, minute - 1, 0)).toISOString();
  const recordedAt = new Date(Date.UTC(2099, 0, 1, 0, minute, 0)).toISOString();
  const runId = randomUUID();
  return {
    schemaVersion: 1,
    kind: "live-application-lane-run",
    experimentId: "live-lane-v1",
    sessionId: plan.sessionId,
    runId,
    startedAt,
    recordedAt,
    block: {
      stage: entry.stage,
      number: entry.blockNumber,
      conditionOrdinal: entry.conditionOrdinal,
      physicalSubrunOrdinal: entry.physicalSubrunOrdinal,
    },
    condition: {
      code: condition.code,
      browserProduct: condition.browserProduct,
      engineFamily: condition.engineFamily,
      browserVersion: condition.browserVersion,
      browserBuildToken: condition.browserBuildToken,
      profilePairing: "paired-snapshot-lineage",
      elatura: { ...condition.elatura },
    },
    workload: {
      application: entry.application,
      token: entry.workloadToken,
      pattern: entry.pattern,
      laneCount: entry.laneCount,
      fixture: null,
    },
    environment: {
      osFamily: "macos",
      osBuildToken: "test-build-1",
      architecture: "arm64",
      physicalMemoryBytes: 17179869184,
      logicalCpuCount: 8,
      displayWidthPx: 1920,
      displayHeightPx: 1080,
      displayScale: 2,
      networkClass: "wifi",
      powerClass: "ac",
    },
    protocol: {
      samplePeriodMs: 2000,
      settleMs: 120000,
      steadyForegroundMs: 600000,
      backgroundProbeCount: 10,
      backgroundProbeDwellMs: 30000,
      switchWarmupRotations: 2,
      switchRecordedRotations: 12,
      switchDwellMs: 15000,
      longBackgroundMs: 300000,
      switchTimeoutMs: 15000,
      restartWaitMs: 60000,
    },
    timingsMs: { applicationActionable: 100, domContentLoaded: 50 },
    resourceSamples: [
      {
        elapsedMs: 0,
        phase: "initial-hydration",
        laneOrdinal: 1,
        targetHostRssBytes: 1,
        browserTreeRssBytes: 1,
        externalElaturaRssBytes: condition.elatura.present ? 1 : null,
        targetHostCpuPercent: 0,
        browserTreeCpuPercent: 0,
        externalElaturaCpuPercent: condition.elatura.present ? 0 : null,
        targetHostProcessCount: 1,
        browserTreeProcessCount: 1,
        externalElaturaProcessCount: condition.elatura.present ? 1 : 0,
        memoryPressureClass: "normal",
      },
    ],
    switchEvents: [],
    domRuntimeCheckpoint: null,
    recovery: {
      attempted: true,
      firstActionableMs: 100,
      allLanesActionableMs: null,
      boundedReads: 0,
      screenshots: 0,
      fullApplicationInspections: 0,
      reloads: 0,
      explicitUserActions: 0,
      fidelityFailure: false,
    },
    attention: null,
    fidelity: {
      authoritativeApplicationPreserved: true,
      interactionTargetAvailable: true,
      expectedRegionPreserved: true,
      streamOrCollaborationStateTruthful: true,
      draftCaretSelectionPreserved: null,
      autosaveTruthful: null,
      normalControlsReachable: true,
      failOpenTruthful: true,
      automaticEffectCount: 0,
      silentDataLossCount: 0,
      falseCompletionCount: 0,
    },
    outcome: { status: "usable", failureCode: null },
    privacy: {
      applicationContentCaptured: false,
      titlesCaptured: false,
      urlsCaptured: false,
      queryStringsCaptured: false,
      credentialsCaptured: false,
      screenshotsCaptured: false,
      rawDomCaptured: false,
      accessibilityTextCaptured: false,
      processCommandLinesCaptured: false,
      freeFormNotesCaptured: false,
    },
  };
}

function projectionFor(entry: Record<string, any>, run: Record<string, any>, index: number) {
  const hasElatura = entry.conditionCode === "FE" || entry.conditionCode === "CRE";
  return {
    schemaVersion: 1,
    kind: "live-application-lane-projection-ledger",
    sessionId: plan.sessionId,
    runId: run.runId,
    logicalLanes: [
      {
        laneOrdinal: 1,
        benchmarkLaneToken: "lane-chat-a",
        application: entry.application,
        locatorClass: "opaque-local-conversation",
        browserProjectionGeneration: 1,
        projectionState: "active",
        freshness: "fresh",
        recoveryState: "none",
        interventionLevel: hasElatura
          ? entry.elaturaMode === "managed" ? "lifecycle-parking" : "observe-only"
          : "stock",
        elaturaLane: hasElatura
          ? { laneRef: `elatura:lane:test-${index + 1}`, laneGeneration: 1, state: "active" }
          : null,
      },
    ],
    events: [],
    privacy: {
      applicationContentCaptured: false,
      rawApplicationLocatorCaptured: false,
      profileIdCaptured: false,
      tabIdCaptured: false,
      targetIdCaptured: false,
      processIdCaptured: false,
      credentialsCaptured: false,
      freeFormNotesCaptured: false,
    },
  };
}

function finalDirectory(name: string, completedIndexes: number[], omitProjectionIndex: number | null = null) {
  const directory = join(root, name);
  mkdirSync(directory);
  for (const index of completedIndexes) {
    const entry = planned[index];
    const run = runFor(entry, index);
    writeFileSync(join(directory, `run-${index}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    if (index !== omitProjectionIndex) {
      const projection = projectionFor(entry, run, index);
      writeFileSync(
        join(directory, `projection-${index}.json`),
        `${JSON.stringify(projection, null, 2)}\n`,
        "utf8",
      );
    }
  }
  return directory;
}

function execute(directory: string, now = "2099-01-01T00:00:00.000Z") {
  return spawnSync(
    process.execPath,
    [nextRun, planPath, directory, "--stage", "chatgpt-single", "--now", now],
    { encoding: "utf8" },
  );
}

function output(result: ReturnType<typeof execute>) {
  return JSON.parse(result.stdout) as Record<string, any>;
}

describe("live-lane next-run helper", () => {
  it("reports the exact first planned subrun for an empty stage", () => {
    const directory = finalDirectory("empty", []);
    const result = execute(directory);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const value = output(result);
    expect(value.state).toBe("ready");
    expect(value.authority).toBe("progress-only");
    expect(value.progress).toEqual({
      expectedPhysicalSubruns: 40,
      completedPhysicalSubruns: 0,
      remainingPhysicalSubruns: 40,
    });
    expect(value.next.conditionCode).toBe("ES");
    expect(value.next.browserProduct).toBe("Edge");
    expect(value.next.blockNumber).toBe(1);
    expect(value.next.conditionOrdinal).toBe(1);
    expect(value.next.physicalSubrunOrdinal).toBe(1);
  });

  it("computes the remaining preregistered cooldown from the previous completed pair", () => {
    const directory = finalDirectory("cooldown", [0]);
    const result = execute(directory, "2099-01-01T00:02:30.000Z");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const value = output(result);
    expect(value.state).toBe("cooldown");
    expect(value.next.conditionCode).toBe("CS");
    expect(value.next.cooldown).toEqual({
      requiredMs: 60000,
      eligibleAt: "2099-01-01T00:03:00.000Z",
      remainingMs: 30000,
    });
  });

  it("marks the next slot ready exactly at the cooldown boundary", () => {
    const directory = finalDirectory("ready", [0]);
    const result = execute(directory, "2099-01-01T00:03:00.000Z");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(output(result).state).toBe("ready");
  });

  it("refuses a later completed slot when an earlier planned slot is absent", () => {
    const directory = finalDirectory("out-of-order", [1]);
    const result = execute(directory);
    expect(result.status).toBe(2);
    expect(output(result).issues).toContainEqual({
      code: "out-of-order-artifacts",
      key: planned[1].key,
    });
  });

  it("refuses a run without its projection ledger", () => {
    const directory = finalDirectory("missing-projection", [0], 0);
    const result = execute(directory);
    expect(result.status).toBe(2);
    expect(output(result).issues).toContainEqual({
      code: "run-projection-pair-missing",
      key: planned[0].key,
    });
  });

  it("reports a stage complete only after every planned run/projection pair exists", () => {
    const directory = finalDirectory("complete", planned.map((_, index) => index));
    const result = execute(directory, "2099-01-02T12:00:00.000Z");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const value = output(result);
    expect(value.state).toBe("complete");
    expect(value.next).toBeNull();
    expect(value.progress.completedPhysicalSubruns).toBe(40);
    expect(value.progress.remainingPhysicalSubruns).toBe(0);
  });
});
