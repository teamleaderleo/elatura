// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_APPLICATION_LANE_RESOURCE_SAMPLES,
  parseApplicationLaneRunManifest,
} from "../src/application-lane-manifest.js";

function resourceSample(phase = "idle") {
  return {
    phase,
    browserProcessBytes: 1_200_000_000,
    rendererProcessBytes: 600_000_000,
    cpuMillis: 20.5,
    domElements: 8_000,
    textNodes: 4_000,
    mountedApplicationUnits: 7,
    elaturaRetainedBytes: 65_536,
  };
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: "00000000-0000-4000-8000-00000000a116",
    recordedAt: "2026-08-27T00:00:00.000Z",
    lane: {
      laneKey: "lane.chatgpt.001",
      applicationClass: "chatgpt",
      targetClass: "conversation",
      targetTokenPresent: true,
    },
    environment: {
      browserClass: "gecko",
      browserVersionToken: "142.0",
      cohort: "elatura",
      interventionLevel: "render-suppression",
    },
    projection: {
      bindings: 3,
      replacements: 2,
      losses: 2,
      recoveries: 2,
      unrecoveredLosses: 0,
      maxConcurrentProjections: 1,
    },
    attention: {
      episodes: 12,
      highestRung: {
        signalOnly: 5,
        boundedSemantic: 4,
        screenshot: 2,
        fullActivation: 1,
      },
      operations: {
        signals: 12,
        boundedSemanticReads: 7,
        screenshots: 3,
        fullActivations: 1,
      },
      falsePositiveSignals: 1,
      missedChanges: 0,
    },
    timingsMs: {
      initialUsableMs: 800,
      switchBackMs: 100,
      recoveryMs: 400,
      boundedReadMs: 10,
      screenshotMs: 35,
      activationMs: 90,
    },
    resources: {
      samples: [resourceSample("idle"), resourceSample("switch"), resourceSample("recovery")],
    },
    fidelity: {
      authoritativeApplicationPreserved: true,
      normalInteractionAvailable: true,
      currentWorkStatePreserved: true,
      recoveryFailures: 0,
      driftFailOpenCount: 1,
    },
    privacy: {
      contentCaptured: false,
      urlsCaptured: false,
      credentialsCaptured: false,
      nativeBrowserIdsCaptured: false,
      screenshotBytesCaptured: false,
    },
    ...structuredClone(overrides),
  };
}

describe("application lane run manifest", () => {
  it("accepts a content-free live lane run", () => {
    const parsed = parseApplicationLaneRunManifest(validManifest());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.lane.laneKey).toBe("lane.chatgpt.001");
    expect(parsed.projection.recoveries).toBe(2);
    expect(parsed.attention.highestRung.fullActivation).toBe(1);
    expect(parsed.privacy.nativeBrowserIdsCaptured).toBe(false);
  });

  it("keeps stock and Elatura cohorts semantically distinct", () => {
    const stock = validManifest({
      environment: {
        browserClass: "gecko",
        browserVersionToken: "142.0",
        cohort: "stock",
        interventionLevel: "stock-observe",
      },
    });
    expect(() => parseApplicationLaneRunManifest(stock)).not.toThrow();

    const mislabeled = validManifest({
      environment: {
        browserClass: "gecko",
        browserVersionToken: "142.0",
        cohort: "stock",
        interventionLevel: "bounded-dom",
      },
    });
    expect(() => parseApplicationLaneRunManifest(mislabeled)).toThrow(/stock-observe/u);
  });

  it("rejects incoherent projection churn accounting", () => {
    const tooManyReplacements = validManifest({
      projection: {
        bindings: 2,
        replacements: 2,
        losses: 1,
        recoveries: 1,
        unrecoveredLosses: 0,
        maxConcurrentProjections: 1,
      },
    });
    expect(() => parseApplicationLaneRunManifest(tooManyReplacements)).toThrow(/bindings minus one/u);

    const impossibleRecovery = validManifest({
      projection: {
        bindings: 2,
        replacements: 1,
        losses: 1,
        recoveries: 1,
        unrecoveredLosses: 1,
        maxConcurrentProjections: 1,
      },
    });
    expect(() => parseApplicationLaneRunManifest(impossibleRecovery)).toThrow(/cannot exceed losses/u);
  });

  it("requires the observation ladder buckets to account for every attention episode", () => {
    const broken = validManifest();
    (broken.attention as { episodes: number }).episodes = 13;
    expect(() => parseApplicationLaneRunManifest(broken)).toThrow(/sum exactly/u);
  });

  it("allows screenshot operations while refusing screenshot bytes in the manifest", () => {
    const parsed = parseApplicationLaneRunManifest(validManifest());
    expect(parsed.attention.operations.screenshots).toBe(3);
    expect(parsed.privacy.screenshotBytesCaptured).toBe(false);

    const leaky = validManifest();
    (leaky.privacy as { screenshotBytesCaptured: boolean }).screenshotBytesCaptured = true;
    expect(() => parseApplicationLaneRunManifest(leaky)).toThrow(/exactly false/u);
  });

  it("refuses content, URLs, credentials, and native browser ids", () => {
    for (const flag of [
      "contentCaptured",
      "urlsCaptured",
      "credentialsCaptured",
      "nativeBrowserIdsCaptured",
    ] as const) {
      const manifest = validManifest();
      (manifest.privacy as Record<string, boolean>)[flag] = true;
      expect(() => parseApplicationLaneRunManifest(manifest)).toThrow(/exactly false/u);
    }
  });

  it("caps resource samples and refuses arbitrary sample fields", () => {
    const tooMany = validManifest({
      resources: {
        samples: Array.from(
          { length: MAX_APPLICATION_LANE_RESOURCE_SAMPLES + 1 },
          () => resourceSample(),
        ),
      },
    });
    expect(() => parseApplicationLaneRunManifest(tooMany)).toThrow(/at most 64/u);

    const withNote = validManifest();
    (withNote.resources as { samples: Record<string, unknown>[] }).samples[0].title = "private";
    expect(() => parseApplicationLaneRunManifest(withNote)).toThrow(/unsupported fields/u);
  });

  it("requires the genuine application to remain authoritative", () => {
    const falseAuthority = validManifest();
    (falseAuthority.fidelity as { authoritativeApplicationPreserved: boolean })
      .authoritativeApplicationPreserved = false;
    expect(() => parseApplicationLaneRunManifest(falseAuthority)).toThrow(/exactly true/u);
  });
});

describe("application lane run validator CLI", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const scriptPath = join(repoRoot, "scripts", "check-application-lane-runs.mjs");
  const scratch = mkdtempSync(join(tmpdir(), "elatura-application-lane-runs-"));

  function runCli(manifest: Record<string, unknown>) {
    const path = join(scratch, "run.json");
    writeFileSync(path, JSON.stringify(manifest));
    try {
      return spawnSync(process.execPath, [scriptPath, path], { encoding: "utf8" });
    } finally {
      rmSync(path, { force: true });
    }
  }

  it("prints only bounded content-free summary tokens", () => {
    const passing = runCli(validManifest());
    expect(passing.status).toBe(0);
    expect(passing.stdout).toContain("pass application=chatgpt browser=gecko cohort=elatura");
    expect(passing.stdout).toContain("privacy=content-free");

    const leaky = validManifest();
    (leaky.privacy as { credentialsCaptured: boolean }).credentialsCaptured = true;
    const failing = runCli(leaky);
    expect(failing.status).toBe(1);
    expect(failing.stderr).toBe("fail schema-invalid\n");
  });
});
