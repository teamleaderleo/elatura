// SPDX-License-Identifier: MPL-2.0
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_PROBE_SAMPLES as MANIFEST_MAX_PROBE_SAMPLES,
  MINIMUM_PROBE_CYCLES,
  MINIMUM_PROBE_SAMPLES as MANIFEST_MINIMUM_PROBE_SAMPLES,
  evaluateCompanionBrowserPlateau,
  parseCompanionBrowserRunManifest,
} from "../../../benchmarks/src/companion-browser-manifest.js";
import { BoundedBrowserRequestLedger } from "../src/browser-request-ledger.js";
import { CompanionWebController } from "../src/controller.js";
import { HttpCompanionTransport } from "../src/http-companion-transport.js";
import {
  MAXIMUM_PROBE_SAMPLES,
  MAX_SWITCH_PROBE_CONVERSATIONS,
  OPEN_CLOSE_PROBE_CYCLES,
  SAMPLES_PER_OPEN_CLOSE_CYCLE,
  SWITCH_PROBE_ROUNDS,
  openCloseProbeWarmupCycles,
  planOpenCloseProbe,
  planSwitchProbe,
  probeTranscriptLines,
  runOpenCloseProbe,
  runSwitchProbe,
  switchProbeWarmupOpens,
} from "../src/probes.js";
import { MINIMUM_PLATEAU_SAMPLES } from "../src/plateau.js";
import { DEFAULT_COMPANION_BROWSER_LEDGER_POLICY } from "../src/browser-request-ledger.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER_SCRIPT = join(REPO_ROOT, "scripts", "run-synthetic-companion-loopback.mjs");
const CHECK_SCRIPT = join(REPO_ROOT, "scripts", "check-companion-browser-runs.mjs");
const SCHEMA_PATH = join(
  REPO_ROOT,
  "benchmarks",
  "schema",
  "benchmark-companion-browser-run-v1.schema.json",
);
const PRESCRIBED_PORT = 4173;

describe("prescribed probe plan cardinality", () => {
  it("derives admissible sample counts from explicit constants", () => {
    expect(planSwitchProbe(1)).toEqual({
      kind: "switch-probe",
      rounds: SWITCH_PROBE_ROUNDS,
      conversations: 1,
      warmup: switchProbeWarmupOpens(1),
      cycles: SWITCH_PROBE_ROUNDS,
      samples: SWITCH_PROBE_ROUNDS,
    });
    expect(planOpenCloseProbe()).toEqual({
      kind: "open-close-probe",
      cycles: OPEN_CLOSE_PROBE_CYCLES,
      samplesPerCycle: SAMPLES_PER_OPEN_CLOSE_CYCLE,
      warmup: openCloseProbeWarmupCycles(),
      samples: OPEN_CLOSE_PROBE_CYCLES * SAMPLES_PER_OPEN_CLOSE_CYCLE,
    });
  });

  it("binds warm-up to exceed the ledger cache capacity at steady state", () => {
    const capacity = DEFAULT_COMPANION_BROWSER_LEDGER_POLICY.maxCacheEntries;
    for (let conversations = 1; conversations <= MAX_SWITCH_PROBE_CONVERSATIONS; conversations += 1) {
      const warmupOpens = switchProbeWarmupOpens(conversations);
      expect(warmupOpens).toBeGreaterThan(capacity);
      expect(warmupOpens % conversations).toBe(0);
    }
    expect(openCloseProbeWarmupCycles() * SAMPLES_PER_OPEN_CLOSE_CYCLE)
      .toBeGreaterThan(capacity);
  });

  it("keeps the derived emissions inside the manifest admission window", () => {
    // The single-conversation server prescribed by the runbook is exactly the
    // configuration that used to emit 3 inadmissible samples.
    const singleConversation = planSwitchProbe(1).samples;
    expect(singleConversation).toBeGreaterThanOrEqual(MANIFEST_MINIMUM_PROBE_SAMPLES);

    const openCloseSamples = planOpenCloseProbe().samples;
    expect(openCloseSamples).toBeLessThanOrEqual(MANIFEST_MAX_PROBE_SAMPLES);
    expect(openCloseSamples).toBeGreaterThanOrEqual(MINIMUM_PLATEAU_SAMPLES);
  });

  it("lands exactly on the ceiling at the maximum admitted configuration", () => {
    expect(SWITCH_PROBE_ROUNDS * MAX_SWITCH_PROBE_CONVERSATIONS)
      .toBe(MAXIMUM_PROBE_SAMPLES);
    expect(OPEN_CLOSE_PROBE_CYCLES * SAMPLES_PER_OPEN_CLOSE_CYCLE)
      .toBe(MAXIMUM_PROBE_SAMPLES);
    expect(planSwitchProbe(MAX_SWITCH_PROBE_CONVERSATIONS).samples)
      .toBe(MAXIMUM_PROBE_SAMPLES);
  });

  it("refuses configurations whose derived emission would be inadmissible", () => {
    // One more conversation than the maximum would emit above the ceiling.
    expect(() => planSwitchProbe(MAX_SWITCH_PROBE_CONVERSATIONS + 1))
      .toThrow(/admits 6-32/u);
    for (const hostile of [0, -1, 1.5, NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planSwitchProbe(hostile)).toThrow(/positive integer/u);
    }
  });

  it("stays identical to the shipped parser and JSON schema bounds", async () => {
    expect(MANIFEST_MAX_PROBE_SAMPLES).toBe(MAXIMUM_PROBE_SAMPLES);
    expect(MANIFEST_MINIMUM_PROBE_SAMPLES).toBe(MINIMUM_PLATEAU_SAMPLES);

    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as {
      $defs: {
        probe: { properties: {
          cycles: { minimum: number };
          samples: { minItems: number; maxItems: number };
        } };
      };
    };
    const probeSchema = schema.$defs.probe.properties;
    expect(probeSchema.samples.minItems).toBe(MINIMUM_PLATEAU_SAMPLES);
    expect(probeSchema.samples.maxItems).toBe(MAXIMUM_PROBE_SAMPLES);
    expect(probeSchema.cycles.minimum).toBe(MINIMUM_PROBE_CYCLES);
  });
});

describe("prescribed command emits schema-admissible probe evidence", () => {
  const scratch = mkdtempSync(join(tmpdir(), "elatura-probe-emission-"));
  let server: { origin: string; child: ChildProcess };

  function spawnServer(portArguments: string[]): Promise<{ origin: string; child: ChildProcess }> {
    return new Promise((resolveStart, rejectStart) => {
      // The exact command documented by the runbook, executed verbatim.
      const child = spawn(
        process.execPath,
        [
          SERVER_SCRIPT,
          "--host", "127.0.0.1",
          ...portArguments,
          "--conversation", "synthetic-10000",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      let settled = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        const match = /listening on (\S+)/u.exec(stdout);
        if (match && !settled) {
          settled = true;
          resolveStart({ origin: match[1]!, child });
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("exit", (code) => {
        if (!settled) {
          settled = true;
          rejectStart(new Error(`server exited ${code}: ${stderr.slice(0, 400)}`));
        }
      });
    });
  }

  beforeAll(async () => {
    try {
      server = await spawnServer(["--port", String(PRESCRIBED_PORT)]);
    } catch {
      // Only the port may deviate from the prescription when the literal is
      // occupied locally; the port never affects probe emission counts.
      server = await spawnServer(["--port", "0"]);
    }
  }, 30_000);

  afterAll(async () => {
    if (server?.child.exitCode === null) {
      server.child.kill("SIGTERM");
      await new Promise((resolveExit) => {
        server.child.once("exit", resolveExit);
      });
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  function browserController(sessionId: string) {
    const ledger = new BoundedBrowserRequestLedger();
    const transport = new HttpCompanionTransport({
      origin: server.origin,
      ledger,
      post: async (url, body, signal) => {
        const response = await fetch(url, {
          body,
          cache: "no-store",
          credentials: "omit",
          headers: { "content-type": "application/json", origin: server.origin },
          method: "POST",
          signal,
        });
        return response.text();
      },
    });
    const controller = new CompanionWebController({ sessionId, transport });
    return { controller, ledger };
  }

  /** Mirrors the page's sampleWorkingSet() field-for-field. */
  function workingSetSampler(
    controller: CompanionWebController,
    ledger: BoundedBrowserRequestLedger,
    usage: () => { residentConversationCount: number; residentRecordCount: number; residentEntryCount: number } | null,
  ) {
    return () => {
      const currentUsage = usage();
      const ledgerSnapshot = ledger.snapshot;
      return {
        residentConversations: currentUsage?.residentConversationCount ?? 0,
        residentRecords: currentUsage?.residentRecordCount ?? 0,
        residentEntries: currentUsage?.residentEntryCount ?? 0,
        renderedRows: controller.workingSetSnapshot.renderMountedTimelineRowCount,
        retainedClientRecords:
          controller.snapshot.client.conversations.length +
          (controller.snapshot.client.page?.entries.length ?? 0) +
          controller.snapshot.client.searchResults.length +
          (controller.snapshot.client.code === null ? 0 : 1),
        cacheEntries: ledgerSnapshot.cacheEntryCount,
        cacheBytes: ledgerSnapshot.cacheTotalBytes,
        artifactBytes: controller.workingSetSnapshot.renderEstimatedArtifactBytes,
      };
    };
  }

  it("serves the shared probe module to the page instead of hardcoded loops", async () => {
    const probesAsset = await fetch(`${server.origin}/vendor/@elatura/companion-web/probes.js`);
    expect(probesAsset.status).toBe(200);
    const appJs = await fetch(`${server.origin}/app.js`).then((response) => response.text());
    expect(appJs).toContain("/vendor/@elatura/companion-web/probes.js");
    expect(appJs).not.toMatch(/round < \d+|cycle < \d+/u);
  });

  it("emits switch-probe samples within the schema window over real HTTP", async () => {
    const sessionInfo = await fetch(`${server.origin}/companion/v1/session`)
      .then((response) => response.json()) as { sessionId: string };
    const { controller, ledger } = browserController(sessionInfo.sessionId);
    let lastUsage: { residentConversationCount: number; residentRecordCount: number; residentEntryCount: number } | null = null;

    await controller.list(null, 100);
    const ids = controller.snapshot.client.conversations.map((item) => item.id);
    expect(ids).toEqual(["synthetic-10000"]);

    const outcome = await runSwitchProbe({
      conversationIds: ids,
      openConversation: async (conversationId) => {
        const opened = await controller.open(conversationId);
        lastUsage = opened.usage ?? lastUsage;
      },
      sampleWorkingSet: workingSetSampler(controller, ledger, () => lastUsage),
    });

    // Cardinality contract: derived plan and emitted evidence agree and fall
    // inside the shipped schema min/max.
    expect(outcome.plan.cycles).toBe(SWITCH_PROBE_ROUNDS);
    expect(outcome.samples.length).toBe(outcome.plan.samples);
    expect(outcome.samples.length).toBe(8);
    expect(outcome.samples.length).toBeGreaterThanOrEqual(MINIMUM_PLATEAU_SAMPLES);
    expect(outcome.samples.length).toBeLessThanOrEqual(MAXIMUM_PROBE_SAMPLES);
    for (const sample of outcome.samples) {
      for (const value of Object.values(sample)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(value)).toBe(true);
      }
    }

    // Every raw sample line survives transcription, bound to the header.
    const lines = probeTranscriptLines(outcome.plan, outcome.samples);
    expect(lines[0]).toBe(
      `switch-probe rounds=8 conversations=1 warmup-opens=${switchProbeWarmupOpens(1)} cycles=8 samples=8`,
    );
    expect(lines.length - 1).toBe(outcome.samples.length);
    lines.slice(1).forEach((line, index) => {
      expect(line.startsWith(`${index} {`)).toBe(true);
    });

    // Warm-up works: recorded samples observe the cache at steady state.
    const cacheEntries = new Set(outcome.samples.map((s) => s.cacheEntries));
    expect(cacheEntries.size).toBe(1);
  }, 60_000);

  it("emits open/close-probe samples on the schema ceiling over real HTTP", async () => {
    const sessionInfo = await fetch(`${server.origin}/companion/v1/session`)
      .then((response) => response.json()) as { sessionId: string };
    const { controller, ledger } = browserController(sessionInfo.sessionId);
    let lastUsage: { residentConversationCount: number; residentRecordCount: number; residentEntryCount: number } | null = null;

    await controller.list(null, 100);
    const id = controller.snapshot.client.conversations[0]!.id;

    const outcome = await runOpenCloseProbe({
      conversationId: id,
      openConversation: async (conversationId) => {
        const opened = await controller.open(conversationId);
        lastUsage = opened.usage ?? lastUsage;
      },
      closeConversation: async (conversationId) => {
        await controller.close(conversationId);
      },
      sampleWorkingSet: workingSetSampler(controller, ledger, () => lastUsage),
    });

    expect(outcome.plan.cycles).toBe(OPEN_CLOSE_PROBE_CYCLES);
    expect(outcome.samples.length).toBe(outcome.plan.samples);
    expect(outcome.samples.length).toBe(OPEN_CLOSE_PROBE_CYCLES * SAMPLES_PER_OPEN_CLOSE_CYCLE);
    expect(outcome.samples.length).toBeLessThanOrEqual(MAXIMUM_PROBE_SAMPLES);
    // The volatile counters the issue requires to return to zero do so
    // within the prescribed cycle count too.
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);

    const lines = probeTranscriptLines(outcome.plan, outcome.samples);
    expect(lines[0]).toBe(
      `open-close-probe cycles=${OPEN_CLOSE_PROBE_CYCLES} warmup-cycles=${openCloseProbeWarmupCycles()} samples-per-cycle=2 samples=32`,
    );
    expect(lines.length - 1).toBe(outcome.samples.length);
    // Steady state: cache occupancy identical in every recorded sample.
    const cacheEntries = new Set(outcome.samples.map((s) => s.cacheEntries));
    expect(cacheEntries.size).toBe(1);
  }, 60_000);

  it("validates the emitted probes through the shipped manifest contract and CLI", async () => {
    const sessionInfo = await fetch(`${server.origin}/companion/v1/session`)
      .then((response) => response.json()) as { sessionId: string };
    const { controller, ledger } = browserController(sessionInfo.sessionId);
    let lastUsage: { residentConversationCount: number; residentRecordCount: number; residentEntryCount: number } | null = null;
    const sampleWorkingSet = workingSetSampler(controller, ledger, () => lastUsage);

    await controller.list(null, 100);
    const listed = controller.snapshot.client.conversations[0]!;

    const switchOutcome = await runSwitchProbe({
      conversationIds: [listed.id],
      openConversation: async (conversationId) => {
        const opened = await controller.open(conversationId);
        lastUsage = opened.usage ?? lastUsage;
      },
      sampleWorkingSet,
    });
    const openCloseOutcome = await runOpenCloseProbe({
      conversationId: listed.id,
      openConversation: async (conversationId) => {
        const opened = await controller.open(conversationId);
        lastUsage = opened.usage ?? lastUsage;
      },
      closeConversation: async (conversationId) => {
        await controller.close(conversationId);
      },
      sampleWorkingSet,
    });

    const usageNow = lastUsage ?? {
      residentConversationCount: 0,
      residentRecordCount: 0,
      residentEntryCount: 0,
    };
    const ledgerSnapshot = ledger.snapshot;
    const manifest = {
      schemaVersion: 1,
      runId: "00000000-0000-4000-8000-00000000e083",
      recordedAt: new Date().toISOString(),
      fixture: {
        id: listed.id,
        entryCount: listed.entryCount,
        textCodeUnits: 0,
        codeBlockCount: 0,
      },
      client: { revision: "probe-emission-contract", protocolVersion: 1 },
      environment: { platformClass: "desktop", browserClass: "chromium", versionToken: "contract-test" },
      timingsMs: { initialUsableMs: null, pageOlderMs: null, pageNewerMs: null, searchMs: null },
      peakProcessBytes: null,
      residentCompanion: {
        conversations: usageNow.residentConversationCount,
        records: usageNow.residentRecordCount,
        entries: usageNow.residentEntryCount,
        textCodeUnits: 0,
        serializedBytes: 0,
      },
      retainedClient: {
        metadataRecords: controller.snapshot.client.conversations.length,
        timelineEntries: controller.snapshot.client.page?.entries.length ?? 0,
        searchResults: controller.snapshot.client.searchResults.length,
        codeBlocks: controller.snapshot.client.code === null ? 0 : 1,
        pendingRequests: 0,
      },
      renderedSurface: {
        timelineRows: controller.workingSetSnapshot.renderMountedTimelineRowCount,
        domNodes: null,
        estimatedArtifactBytes: controller.workingSetSnapshot.renderEstimatedArtifactBytes,
      },
      requestCacheLedger: {
        dispatchedRequests: ledgerSnapshot.dispatchedRequestCount,
        completedRequests: ledgerSnapshot.completedRequestCount,
        cancelledRequests: ledgerSnapshot.cancelledRequestCount,
        failedRequests: ledgerSnapshot.failedRequestCount,
        refusedOverLimitRequests: ledgerSnapshot.refusedOverLimitRequestCount,
        cacheEntries: ledgerSnapshot.cacheEntryCount,
        cacheTotalBytes: ledgerSnapshot.cacheTotalBytes,
      },
      probes: {
        switchProbe: { cycles: switchOutcome.plan.cycles, samples: switchOutcome.samples },
        openCloseProbe: { cycles: openCloseOutcome.plan.cycles, samples: openCloseOutcome.samples },
      },
      integrity: { observedStates: [], truncatedResponseCount: 0, overLimitRefusalCount: 0 },
      privacy: {
        contentCaptured: false,
        urlsCaptured: false,
        transcriptTextCaptured: false,
        screenshotsCaptured: false,
      },
    };

    // Parser admission proves the emitted cardinalities satisfy the schema's
    // min/max together with truthful cycle provenance.
    const parsed = parseCompanionBrowserRunManifest(manifest);
    expect(parsed.probes.switchProbe.samples.length).toBe(8);
    expect(parsed.probes.openCloseProbe.samples.length).toBe(32);
    const verdict = evaluateCompanionBrowserPlateau(parsed);
    expect(verdict.failures).toEqual([]);

    // The exact validation command an operator runs accepts the artifact.
    const path = join(scratch, "run-emission.json");
    writeFileSync(path, JSON.stringify(manifest));
    try {
      const cli = spawnSync(process.execPath, [CHECK_SCRIPT, path], { encoding: "utf8" });
      expect(cli.status).toBe(0);
      expect(cli.stdout).toContain("pass fixture=synthetic-10000");
    } finally {
      rmSync(path, { force: true });
    }
  }, 120_000);
});
