// SPDX-License-Identifier: MPL-2.0
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const MAX_FILES = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_SAMPLER_GAP_MS = 6000;
const STAGES = ["chatgpt-single", "chatgpt-switch-8", "gdocs-single", "gdocs-switch-8"];

const STOCK_IDENTITY = {
  ES: { planCode: "ES", product: "Edge", engineFamily: "blink-v8" },
  CS: { planCode: "CS", product: "Chrome", engineFamily: "blink-v8" },
  CRS: { planCode: "CRS", product: "Chromium", engineFamily: "blink-v8" },
  FS: { planCode: "FS", product: "Firefox", engineFamily: "gecko-spidermonkey" },
  FE: { planCode: "FS", product: "Firefox", engineFamily: "gecko-spidermonkey" },
  CRE: { planCode: "CRS", product: "Chromium", engineFamily: "blink-v8" },
};

const RUN_PROTOCOL_TO_PLAN = {
  samplePeriodMs: "samplePeriodMs",
  settleMs: "settleMs",
  steadyForegroundMs: "steadyForegroundMs",
  backgroundProbeCount: "singleLaneBackgroundProbeCount",
  backgroundProbeDwellMs: "singleLaneBackgroundDwellMs",
  switchWarmupRotations: "switchWarmupRotations",
  switchRecordedRotations: "switchRecordedRotations",
  switchDwellMs: "switchDwellMs",
  longBackgroundMs: "longBackgroundMs",
  switchTimeoutMs: "switchTimeoutMs",
  restartWaitMs: "restartWaitMs",
};

function usage() {
  return [
    "Usage: node scripts/check-live-application-lane-session.mjs <plan.json> <final-directory>",
    "       [--stage chatgpt-single|chatgpt-switch-8|gdocs-single|gdocs-switch-8]",
    "       [--out <new-path>]",
  ].join("\n");
}

function parseOptions(args) {
  if (args.length < 2) throw new Error(usage());
  const planPath = args[0];
  const directory = args[1];
  let stage = null;
  let outPath = null;
  for (let index = 2; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if ((option !== "--stage" && option !== "--out") || value === undefined || value.startsWith("--")) {
      throw new Error(usage());
    }
    if (option === "--stage") {
      if (stage !== null || !STAGES.includes(value)) throw new Error(usage());
      stage = value;
    } else {
      if (outPath !== null) throw new Error(usage());
      outPath = value;
    }
    index += 1;
  }
  return { planPath, directory, stage, outPath };
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function canonicalMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

function issue(issues, code, key = null) {
  issues.push({ code, key });
}

function expectedEntries(plan, issues) {
  const entries = [];
  if (!Array.isArray(plan.stages) || plan.stages.length !== 4) {
    issue(issues, "invalid-plan-stages");
    return entries;
  }
  for (let stageIndex = 0; stageIndex < plan.stages.length; stageIndex += 1) {
    const stage = record(plan.stages[stageIndex]);
    if (!stage || !Array.isArray(stage.blocks)) {
      issue(issues, "invalid-plan-stage", String(stageIndex + 1));
      continue;
    }
    for (const block of stage.blocks) {
      if (!record(block) || !Array.isArray(block.slots)) {
        issue(issues, "invalid-plan-block", `${stage.stage ?? "unknown"}`);
        continue;
      }
      for (const slot of block.slots) {
        if (!record(slot) || !Array.isArray(slot.physicalSubruns)) {
          issue(issues, "invalid-plan-slot", `${stage.stage}|${block.number ?? "?"}`);
          continue;
        }
        for (const subrun of slot.physicalSubruns) {
          const key = [stage.stage, block.number, slot.conditionOrdinal, subrun.ordinal].join("|");
          entries.push({ key, stageIndex, stage, block, slot, subrun });
        }
      }
    }
  }
  return entries;
}

async function collectJsonFiles(directory) {
  const rootStat = await lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("final input must be a real directory");
  const names = (await readdir(directory)).sort();
  if (names.length > MAX_FILES) throw new Error(`final directory exceeds ${MAX_FILES} entries`);
  const files = [];
  let totalBytes = 0;
  for (const name of names) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("final directory may contain regular files only");
    if (extname(name) !== ".json") throw new Error("final directory may contain JSON files only");
    if (stat.size > MAX_FILE_BYTES) throw new Error(`JSON file exceeds ${MAX_FILE_BYTES} bytes`);
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`final bundle exceeds ${MAX_TOTAL_BYTES} bytes`);
    files.push(path);
  }
  return files;
}

function runKey(run) {
  return [run?.block?.stage, run?.block?.number, run?.block?.conditionOrdinal, run?.block?.physicalSubrunOrdinal].join("|");
}

function same(value, expected) {
  return value === expected;
}

function checkBrowserIdentity(run, plan, expected, issues) {
  const condition = record(run.condition);
  const identityRule = STOCK_IDENTITY[expected.slot.conditionCode];
  if (!condition || !identityRule) {
    issue(issues, "invalid-condition", expected.key);
    return;
  }
  if (!same(condition.code, expected.slot.conditionCode)) issue(issues, "condition-code-mismatch", expected.key);
  const frozen = plan.browsers?.[identityRule.planCode];
  if (!record(frozen)) {
    issue(issues, "missing-plan-browser-identity", expected.key);
    return;
  }
  if (!same(condition.browserProduct, identityRule.product)) issue(issues, "browser-product-mismatch", expected.key);
  if (!same(condition.engineFamily, identityRule.engineFamily)) issue(issues, "engine-family-mismatch", expected.key);
  if (!same(condition.browserVersion, frozen.version)) issue(issues, "browser-version-mismatch", expected.key);
  if (!same(condition.browserBuildToken, frozen.buildToken)) issue(issues, "browser-build-mismatch", expected.key);

  const elatura = record(condition.elatura);
  if (!elatura) {
    issue(issues, "missing-elatura-identity", expected.key);
    return;
  }
  const isElatura = expected.slot.conditionCode === "FE" || expected.slot.conditionCode === "CRE";
  if (!isElatura) {
    if (elatura.present !== false || elatura.mode !== "none" || elatura.transport !== "none") {
      issue(issues, "stock-condition-has-elatura", expected.key);
    }
    if (elatura.revision !== null || elatura.interventionToken !== null) issue(issues, "stock-elatura-fields-present", expected.key);
    return;
  }
  if (elatura.present !== true) issue(issues, "elatura-missing", expected.key);
  if (!same(elatura.mode, expected.subrun.mode)) issue(issues, "elatura-subrun-mode-mismatch", expected.key);
  const transport = expected.slot.conditionCode === "FE" ? "firefox-extension" : "chromium-extension-cdp";
  if (!same(elatura.transport, transport)) issue(issues, "elatura-transport-mismatch", expected.key);
  if (!same(elatura.revision, plan.elatura?.revision)) issue(issues, "elatura-revision-mismatch", expected.key);
  const intervention = expected.slot.conditionCode === "FE"
    ? plan.elatura?.firefoxInterventionToken
    : plan.elatura?.chromiumInterventionToken;
  if (!same(elatura.interventionToken, intervention)) issue(issues, "elatura-intervention-mismatch", expected.key);
}

function checkWorkload(run, expected, issues) {
  const workload = record(run.workload);
  if (!workload) {
    issue(issues, "missing-workload", expected.key);
    return;
  }
  if (!same(workload.application, expected.stage.application)) issue(issues, "application-mismatch", expected.key);
  if (!same(workload.token, expected.stage.workloadToken)) issue(issues, "workload-token-mismatch", expected.key);
  if (!same(workload.pattern, expected.stage.pattern)) issue(issues, "workload-pattern-mismatch", expected.key);
  if (!same(workload.laneCount, expected.stage.laneCount)) issue(issues, "lane-count-mismatch", expected.key);
  if (expected.stage.application === "google-docs") {
    const fixture = workload.fixture;
    const recipe = {
      syntheticWords: 100000,
      headingCount: 200,
      tableCount: 20,
      tableRows: 20,
      tableColumns: 10,
    };
    if (!record(fixture) || Object.entries(recipe).some(([key, value]) => fixture[key] !== value)) {
      issue(issues, "gdocs-fixture-mismatch", expected.key);
    }
  } else if (workload.fixture !== null) {
    issue(issues, "unexpected-fixture", expected.key);
  }
}

function checkProtocol(run, plan, expected, issues) {
  const protocol = record(run.protocol);
  if (!protocol) {
    issue(issues, "missing-protocol", expected.key);
    return;
  }
  for (const [runKeyName, planKey] of Object.entries(RUN_PROTOCOL_TO_PLAN)) {
    if (protocol[runKeyName] !== plan.protocol?.[planKey]) issue(issues, `protocol-${runKeyName}-mismatch`, expected.key);
  }
}

function checkResourceSamples(run, expected, issues) {
  if (!Array.isArray(run.resourceSamples) || run.resourceSamples.length === 0) {
    issue(issues, "missing-resource-samples", expected.key);
    return;
  }
  let previous = null;
  for (const sample of run.resourceSamples) {
    if (!record(sample) || !Number.isInteger(sample.elapsedMs) || sample.elapsedMs < 0) {
      issue(issues, "invalid-resource-sample", expected.key);
      return;
    }
    if (previous !== null) {
      const gap = sample.elapsedMs - previous;
      if (gap <= 0) issue(issues, "nonmonotonic-resource-samples", expected.key);
      if (gap > MAX_SAMPLER_GAP_MS) issue(issues, "sampler-gap", expected.key);
    }
    previous = sample.elapsedMs;
  }
  const phases = new Set(run.resourceSamples.map((sample) => sample.phase));
  if (!phases.has("initial-hydration") || !phases.has("settle")) issue(issues, "missing-initial-resource-phase", expected.key);
  if (expected.stage.pattern === "single-lane" && !phases.has("steady-foreground")) issue(issues, "missing-steady-foreground", expected.key);
  if (expected.stage.pattern === "switch-8" && !phases.has("steady-switch")) issue(issues, "missing-steady-switch", expected.key);
}

function countSwitchClass(run, className) {
  return Array.isArray(run.switchEvents) ? run.switchEvents.filter((event) => event?.class === className).length : 0;
}

function checkSwitchEvents(run, expected, issues) {
  if (!Array.isArray(run.switchEvents)) {
    issue(issues, "missing-switch-events", expected.key);
    return;
  }
  if (expected.stage.pattern === "single-lane") {
    if (countSwitchClass(run, "single-background-return") !== 10) issue(issues, "single-background-probe-count", expected.key);
    return;
  }
  if (countSwitchClass(run, "warmup") !== 16) issue(issues, "switch-warmup-count", expected.key);
  if (countSwitchClass(run, "recorded-switch") !== 96) issue(issues, "recorded-switch-count", expected.key);
  if (countSwitchClass(run, "long-background-return") !== 8) issue(issues, "long-background-return-count", expected.key);
  for (const event of run.switchEvents) {
    if (event?.fidelityFailure === true) issue(issues, "switch-fidelity-failure", expected.key);
  }
}

function checkFidelity(run, expected, issues) {
  const fidelity = record(run.fidelity);
  if (!fidelity) {
    issue(issues, "missing-fidelity", expected.key);
    return;
  }
  for (const field of [
    "authoritativeApplicationPreserved",
    "interactionTargetAvailable",
    "expectedRegionPreserved",
    "normalControlsReachable",
    "failOpenTruthful",
  ]) {
    if (fidelity[field] !== true) issue(issues, `fidelity-${field}`, expected.key);
  }
  if (fidelity.automaticEffectCount !== 0) issue(issues, "fidelity-automatic-effect", expected.key);
  if (fidelity.silentDataLossCount !== 0) issue(issues, "fidelity-silent-data-loss", expected.key);
  if (fidelity.falseCompletionCount !== 0) issue(issues, "fidelity-false-completion", expected.key);
  if (run.recovery?.attempted !== true) issue(issues, "recovery-not-attempted", expected.key);
  if (run.recovery?.fidelityFailure === true) issue(issues, "recovery-fidelity-failure", expected.key);
}

function checkPrivacy(value, expectedKey, issues) {
  if (!record(value) || Object.values(value).some((item) => item !== false)) issue(issues, "privacy-flag-violation", expectedKey);
}

function checkOutcome(run, expected, issues) {
  if (run.outcome?.status !== "usable" || run.outcome?.failureCode !== null) {
    issue(issues, "run-not-usable", expected.key);
  }
}

function checkRun(run, plan, expected, issues) {
  if (run.schemaVersion !== 1 || run.kind !== "live-application-lane-run") issue(issues, "invalid-run-kind", expected.key);
  if (run.sessionId !== plan.sessionId) issue(issues, "session-id-mismatch", expected.key);
  if (run.block?.stage !== expected.stage.stage) issue(issues, "stage-mismatch", expected.key);
  if (run.block?.number !== expected.block.number) issue(issues, "block-number-mismatch", expected.key);
  if (run.block?.conditionOrdinal !== expected.slot.conditionOrdinal) issue(issues, "condition-ordinal-mismatch", expected.key);
  if (run.block?.physicalSubrunOrdinal !== expected.subrun.ordinal) issue(issues, "physical-subrun-ordinal-mismatch", expected.key);
  checkBrowserIdentity(run, plan, expected, issues);
  checkWorkload(run, expected, issues);
  checkProtocol(run, plan, expected, issues);
  checkResourceSamples(run, expected, issues);
  checkSwitchEvents(run, expected, issues);
  checkFidelity(run, expected, issues);
  checkOutcome(run, expected, issues);
  checkPrivacy(run.privacy, expected.key, issues);
}

function checkProjection(projection, run, expected, laneTokens, issues) {
  if (projection.schemaVersion !== 1 || projection.kind !== "live-application-lane-projection-ledger") {
    issue(issues, "invalid-projection-kind", expected.key);
    return;
  }
  if (projection.sessionId !== run.sessionId || projection.runId !== run.runId) issue(issues, "projection-link-mismatch", expected.key);
  if (!Array.isArray(projection.logicalLanes) || projection.logicalLanes.length !== expected.stage.laneCount) {
    issue(issues, "projection-lane-count-mismatch", expected.key);
  } else {
    const ordinals = projection.logicalLanes.map((lane) => lane?.laneOrdinal).sort((a, b) => a - b);
    for (let laneOrdinal = 1; laneOrdinal <= expected.stage.laneCount; laneOrdinal += 1) {
      if (ordinals[laneOrdinal - 1] !== laneOrdinal) issue(issues, "projection-lane-ordinal-mismatch", expected.key);
      const lane = projection.logicalLanes.find((item) => item?.laneOrdinal === laneOrdinal);
      if (!lane) continue;
      const tokenKey = `${expected.stage.stage}|${laneOrdinal}`;
      const prior = laneTokens.get(tokenKey);
      if (prior === undefined) laneTokens.set(tokenKey, lane.logicalLaneToken);
      else if (prior !== lane.logicalLaneToken) issue(issues, "logical-lane-token-drift", tokenKey);
      if (lane.application !== expected.stage.application) issue(issues, "projection-application-mismatch", expected.key);
      if (!Number.isInteger(lane.projectionGeneration) || lane.projectionGeneration < 1) issue(issues, "projection-generation-invalid", expected.key);
    }
  }
  checkPrivacy(projection.privacy, expected.key, issues);
  if (Array.isArray(projection.signals)) {
    for (const signal of projection.signals) {
      if (signal?.confidence === "unknown" && signal?.causedInspection === true) issue(issues, "unknown-confidence-caused-inspection", expected.key);
      if (signal?.freshness !== "fresh" && signal?.causedInspection === true) issue(issues, "nonfresh-signal-caused-inspection", expected.key);
    }
  } else {
    issue(issues, "projection-signals-missing", expected.key);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { planPath, directory, stage, outPath } = parseOptions(args);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const issues = [];
  if (plan.schemaVersion !== 1 || plan.kind !== "live-application-lane-plan") issue(issues, "invalid-plan-kind");
  const generatedAtMs = canonicalMs(plan.generatedAt);
  if (generatedAtMs === null) issue(issues, "invalid-plan-generated-at");
  checkPrivacy(plan.privacy, "plan", issues);

  const fullExpected = expectedEntries(plan, issues);
  if (fullExpected.length !== 112) issue(issues, "unexpected-plan-physical-run-count", String(fullExpected.length));
  const expected = stage === null ? fullExpected : fullExpected.filter((entry) => entry.stage.stage === stage);
  const expectedByKey = new Map(expected.map((entry) => [entry.key, entry]));

  const files = await collectJsonFiles(directory);
  const runs = [];
  const projections = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed?.kind === "live-application-lane-run") runs.push(parsed);
    else if (parsed?.kind === "live-application-lane-projection-ledger") projections.push(parsed);
    else issue(issues, "unexpected-json-kind");
  }

  const runsByKey = new Map();
  const runsById = new Map();
  for (const run of runs) {
    const key = runKey(run);
    if (runsByKey.has(key)) issue(issues, "duplicate-run-slot", key);
    else runsByKey.set(key, run);
    if (typeof run.runId !== "string" || runsById.has(run.runId)) issue(issues, "duplicate-or-invalid-run-id", key);
    else runsById.set(run.runId, run);
  }

  for (const key of runsByKey.keys()) if (!expectedByKey.has(key)) issue(issues, "unexpected-run-slot", key);
  for (const entry of expected) {
    const run = runsByKey.get(entry.key);
    if (!run) issue(issues, "missing-run-slot", entry.key);
    else checkRun(run, plan, entry, issues);
  }

  const projectionsByRunId = new Map();
  for (const projection of projections) {
    if (typeof projection.runId !== "string" || projectionsByRunId.has(projection.runId)) {
      issue(issues, "duplicate-or-invalid-projection-run-id");
    } else projectionsByRunId.set(projection.runId, projection);
  }
  const laneTokens = new Map();
  for (const entry of expected) {
    const run = runsByKey.get(entry.key);
    if (!run) continue;
    const projection = projectionsByRunId.get(run.runId);
    if (!projection) issue(issues, "missing-projection-ledger", entry.key);
    else checkProjection(projection, run, entry, laneTokens, issues);
  }
  for (const runId of projectionsByRunId.keys()) if (!runsById.has(runId)) issue(issues, "orphan-projection-ledger", runId);

  let previousRecordedAt = generatedAtMs;
  for (const entry of expected) {
    const run = runsByKey.get(entry.key);
    if (!run) continue;
    const recordedAtMs = canonicalMs(run.recordedAt);
    if (recordedAtMs === null) issue(issues, "invalid-recorded-at", entry.key);
    else {
      if (previousRecordedAt !== null && recordedAtMs <= previousRecordedAt) issue(issues, "execution-order-violation", entry.key);
      previousRecordedAt = recordedAtMs;
    }
  }

  const uniqueIssues = [...new Map(issues.map((item) => [`${item.code}|${item.key ?? ""}`, item])).values()]
    .sort((left, right) => `${left.code}|${left.key ?? ""}`.localeCompare(`${right.code}|${right.key ?? ""}`));
  const result = {
    schemaVersion: 1,
    kind: "live-application-lane-readiness",
    sessionId: plan.sessionId ?? null,
    scope: stage ?? "full",
    fullPlannedRunCount: fullExpected.length,
    expectedRunCount: expected.length,
    runCount: runs.length,
    projectionLedgerCount: projections.length,
    ready: uniqueIssues.length === 0,
    issues: uniqueIssues,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outPath, serialized, { encoding: "utf8", flag: "wx" });
  } else {
    process.stdout.write(serialized);
  }
  process.exitCode = result.ready ? 0 : 2;
}

main().catch((error) => {
  process.stderr.write(`live-lane-check: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 2;
});
