// SPDX-License-Identifier: MPL-2.0
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsGenerator = join(repoRoot, "scripts", "generate-google-docs-workload.mjs");
const planGenerator = join(repoRoot, "scripts", "create-live-application-lane-plan.mjs");
const admission = join(repoRoot, "scripts", "validate-live-application-lane-artifacts.mjs");
const PRIVATE_CANARY = "synthetic-private-canary";

function createPlan(root: string) {
  const docsRoot = join(root, "docs");
  const generated = spawnSync(process.execPath, [docsGenerator, "--out", docsRoot], { encoding: "utf8" });
  expect(generated.status, generated.stderr).toBe(0);
  const planned = spawnSync(
    process.execPath,
    [
      planGenerator,
      "--edge-version", "140.0", "--edge-build", "edge-build-1",
      "--chrome-version", "140.0", "--chrome-build", "chrome-build-1",
      "--chromium-version", "140.0", "--chromium-build", "chromium-build-1",
      "--firefox-version", "142.0", "--firefox-build", "firefox-build-1",
      "--elatura-revision", "schema-admission-test",
      "--firefox-intervention", "latest3-v1",
      "--chromium-intervention", "parking-v1",
      "--chromium-transport", "extension-only",
      "--gdocs-manifest", join(docsRoot, "manifest.json"),
    ],
    { encoding: "utf8" },
  );
  expect(planned.status, planned.stderr).toBe(0);
  const plan = JSON.parse(planned.stdout) as Record<string, any>;
  const planPath = join(root, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { plan, planPath };
}

function stockRun(plan: Record<string, any>, runId: string) {
  return {
    schemaVersion: 1,
    kind: "live-application-lane-run",
    experimentId: "live-lane-v1",
    sessionId: plan.sessionId,
    runId,
    recordedAt: "2026-08-27T01:00:00.000Z",
    block: {
      stage: "chatgpt-single",
      number: 1,
      conditionOrdinal: 1,
      physicalSubrunOrdinal: 1,
    },
    condition: {
      code: "ES",
      browserProduct: "Edge",
      engineFamily: "blink-v8",
      browserVersion: plan.browsers.ES.version,
      browserBuildToken: plan.browsers.ES.buildToken,
      profilePairing: "paired-snapshot-lineage",
      elatura: {
        present: false,
        mode: "none",
        transport: "none",
        revision: null,
        interventionToken: null,
      },
    },
    workload: {
      application: "chatgpt",
      token: "chatgpt-pathological-a",
      pattern: "single-lane",
      laneCount: 1,
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
    timingsMs: {
      applicationActionable: 100,
      domContentLoaded: 50,
    },
    resourceSamples: [
      {
        elapsedMs: 0,
        phase: "initial-hydration",
        laneOrdinal: 1,
        targetHostRssBytes: 1,
        browserTreeRssBytes: 1,
        externalElaturaRssBytes: null,
        targetHostCpuPercent: 0,
        browserTreeCpuPercent: 0,
        externalElaturaCpuPercent: null,
        targetHostProcessCount: 1,
        browserTreeProcessCount: 1,
        externalElaturaProcessCount: 0,
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
    outcome: {
      status: "usable",
      failureCode: null,
    },
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

function stockProjection(plan: Record<string, any>, runId: string) {
  return {
    schemaVersion: 1,
    kind: "live-application-lane-projection-ledger",
    sessionId: plan.sessionId,
    runId,
    logicalLanes: [
      {
        laneOrdinal: 1,
        benchmarkLaneToken: "lane-chat-a",
        application: "chatgpt",
        locatorClass: "opaque-local-conversation",
        browserProjectionGeneration: 1,
        projectionState: "active",
        freshness: "fresh",
        recoveryState: "none",
        interventionLevel: "stock",
        elaturaLane: null,
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

function writeArtifacts(root: string, run: unknown, projection: unknown) {
  const finalDirectory = join(root, "final");
  mkdirSync(finalDirectory);
  writeFileSync(join(finalDirectory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  writeFileSync(join(finalDirectory, "projection.json"), `${JSON.stringify(projection, null, 2)}\n`, "utf8");
  return finalDirectory;
}

function validate(planPath: string, finalDirectory: string) {
  return spawnSync(process.execPath, [admission, planPath, finalDirectory], { encoding: "utf8" });
}

function withFixture(test: (value: {
  root: string;
  plan: Record<string, any>;
  planPath: string;
  run: Record<string, any>;
  projection: Record<string, any>;
}) => void) {
  const root = mkdtempSync(join(tmpdir(), "elatura-live-schema-"));
  try {
    const { plan, planPath } = createPlan(root);
    const runId = randomUUID();
    test({
      root,
      plan,
      planPath,
      run: stockRun(plan, runId),
      projection: stockProjection(plan, runId),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("live-lane schema admission", () => {
  it("admits schema-valid content-free run and projection artifacts", () => {
    withFixture(({ root, planPath, run, projection }) => {
      const finalDirectory = writeArtifacts(root, run, projection);
      const result = validate(planPath, finalDirectory);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  it("rejects missing privacy declarations", () => {
    withFixture(({ root, planPath, run, projection }) => {
      run.privacy = {};
      const finalDirectory = writeArtifacts(root, run, projection);
      const result = validate(planPath, finalDirectory);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).issues).toContainEqual({
        code: "run-schema-invalid",
        key: "artifact-002",
      });
    });
  });

  it("rejects extra content-bearing fields without echoing their values", () => {
    withFixture(({ root, planPath, run, projection }) => {
      run.transcriptText = PRIVATE_CANARY;
      const finalDirectory = writeArtifacts(root, run, projection);
      const result = validate(planPath, finalDirectory);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("run-schema-invalid");
      expect(result.stdout).not.toContain(PRIVATE_CANARY);
      expect(result.stderr).not.toContain(PRIVATE_CANARY);
    });
  });

  it("rejects required fields omitted from the former manual checker", () => {
    withFixture(({ root, planPath, run, projection }) => {
      delete run.experimentId;
      const finalDirectory = writeArtifacts(root, run, projection);
      const result = validate(planPath, finalDirectory);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("run-schema-invalid");
    });
  });

  it("rejects unknown nested browser projection fields", () => {
    withFixture(({ root, planPath, run, projection }) => {
      projection.logicalLanes[0].tabId = 17;
      const finalDirectory = writeArtifacts(root, run, projection);
      const result = validate(planPath, finalDirectory);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("projection-schema-invalid");
    });
  });

  it("validates the session plan against its shipped schema", () => {
    withFixture(({ root, plan, planPath, run, projection }) => {
      plan.privacy = {};
      writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      const finalDirectory = writeArtifacts(root, run, projection);
      const result = validate(planPath, finalDirectory);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("plan-schema-invalid");
    });
  });
});
