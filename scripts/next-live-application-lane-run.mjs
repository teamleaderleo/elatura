// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import {
  LIVE_LANE_STAGES,
  canonicalLiveLaneMs,
  collectLiveLaneJsonFiles,
  compileLiveLaneValidators,
  expectedLiveLaneCondition,
  liveLaneRunKey,
  liveLaneRunMatchesPlannedSlot,
  parseLiveLaneJson,
  plannedLiveLaneSubruns,
} from "./live-application-lane-utils.mjs";

function usage() {
  return [
    "Usage: npm run live-lane:next -- <plan.json> <stage-final-directory> --stage <stage> [--now <UTC>]",
    "",
    `Stages: ${LIVE_LANE_STAGES.join(", ")}`,
    "",
    "This is a progress/operator helper. Final evidence authority remains live-lane:check.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  if (argv.length < 4) throw new TypeError("arguments-invalid");
  const [planPath, directory, ...rest] = argv;
  if (!planPath || !directory || planPath.startsWith("--") || directory.startsWith("--")) {
    throw new TypeError("arguments-invalid");
  }
  let stage = null;
  let now = null;
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key === "--stage") {
      if (stage !== null || !LIVE_LANE_STAGES.includes(value)) throw new TypeError("stage-invalid");
      stage = value;
      index += 1;
    } else if (key === "--now") {
      if (now !== null || canonicalLiveLaneMs(value) === null) throw new TypeError("now-invalid");
      now = value;
      index += 1;
    } else {
      throw new TypeError("arguments-invalid");
    }
  }
  if (stage === null) throw new TypeError("stage-required");
  return { help: false, planPath, directory, stage, now };
}

function addIssue(issues, code, key) {
  issues.push(Object.freeze({ code, key }));
}

function normalizedIssues(issues) {
  return [...new Map(issues.map((entry) => [`${entry.code}|${entry.key}`, entry])).values()]
    .sort((left, right) => `${left.code}|${left.key}`.localeCompare(`${right.code}|${right.key}`));
}

function fail(issues) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "live-application-lane-next",
    valid: false,
    issues: normalizedIssues(issues),
  }, null, 2)}\n`);
  process.exitCode = 2;
}

function expectedProjectionShape(planned, projection) {
  if (projection?.logicalLanes?.length !== planned.laneCount) return false;
  const ordinals = new Set();
  for (const lane of projection.logicalLanes) {
    if (lane?.application !== planned.application) return false;
    if (!Number.isSafeInteger(lane?.laneOrdinal) || ordinals.has(lane.laneOrdinal)) return false;
    ordinals.add(lane.laneOrdinal);
    const shouldHaveElaturaLane = planned.conditionCode === "FE" || planned.conditionCode === "CRE";
    if (shouldHaveElaturaLane !== (lane?.elaturaLane !== null)) return false;
  }
  return ordinals.size === planned.laneCount;
}

function nextDescriptor(plan, planned, cooldown) {
  const condition = expectedLiveLaneCondition(plan, planned);
  return Object.freeze({
    slotKey: planned.key,
    blockNumber: planned.blockNumber,
    conditionOrdinal: planned.conditionOrdinal,
    physicalSubrunOrdinal: planned.physicalSubrunOrdinal,
    conditionCode: planned.conditionCode,
    browserProduct: condition.browserProduct,
    engineFamily: condition.engineFamily,
    browserVersion: condition.browserVersion,
    browserBuildToken: condition.browserBuildToken,
    elatura: condition.elatura,
    workload: Object.freeze({
      application: planned.application,
      token: planned.workloadToken,
      pattern: planned.pattern,
      laneCount: planned.laneCount,
    }),
    cooldown,
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`live-lane-next: ${error instanceof Error ? error.message : "arguments-invalid"}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const validators = await compileLiveLaneValidators();
  const issues = [];
  let plan;
  try {
    plan = JSON.parse(await readFile(args.planPath, "utf8"));
  } catch {
    addIssue(issues, "plan-json-invalid", "plan");
    fail(issues);
    return;
  }
  if (!validators.plan(plan)) {
    addIssue(issues, "plan-schema-invalid", "plan");
    fail(issues);
    return;
  }

  const planned = plannedLiveLaneSubruns(plan, args.stage);
  if (planned.length === 0) {
    addIssue(issues, "stage-plan-empty", "plan");
    fail(issues);
    return;
  }
  const plannedByKey = new Map(planned.map((entry) => [entry.key, entry]));

  const files = await collectLiveLaneJsonFiles(args.directory);
  if (files === null) {
    addIssue(issues, "artifact-directory-invalid", "artifacts");
    fail(issues);
    return;
  }

  const runsByKey = new Map();
  const runsById = new Map();
  const projectionsByRunId = new Map();
  for (let index = 0; index < files.length; index += 1) {
    const key = `artifact-${String(index + 1).padStart(3, "0")}`;
    const parsed = await parseLiveLaneJson(files[index]);
    if (!parsed.ok) {
      addIssue(issues, "artifact-json-invalid", key);
      continue;
    }
    const value = parsed.value;
    if (value?.kind === "live-application-lane-run") {
      if (!validators.run(value)) {
        addIssue(issues, "run-schema-invalid", key);
        continue;
      }
      const slotKey = liveLaneRunKey(value);
      const expected = plannedByKey.get(slotKey);
      if (!expected) {
        addIssue(issues, "unexpected-run-slot", slotKey);
        continue;
      }
      if (!liveLaneRunMatchesPlannedSlot(plan, expected, value)) {
        addIssue(issues, "run-plan-mismatch", slotKey);
        continue;
      }
      if (runsByKey.has(slotKey)) {
        addIssue(issues, "duplicate-run-slot", slotKey);
        continue;
      }
      if (runsById.has(value.runId)) {
        addIssue(issues, "duplicate-run-id", slotKey);
        continue;
      }
      runsByKey.set(slotKey, value);
      runsById.set(value.runId, value);
    } else if (value?.kind === "live-application-lane-projection-ledger") {
      if (!validators.projection(value)) {
        addIssue(issues, "projection-schema-invalid", key);
        continue;
      }
      if (value.sessionId !== plan.sessionId) {
        addIssue(issues, "projection-session-mismatch", key);
        continue;
      }
      if (projectionsByRunId.has(value.runId)) {
        addIssue(issues, "duplicate-projection-run", key);
        continue;
      }
      projectionsByRunId.set(value.runId, value);
    } else {
      addIssue(issues, "artifact-kind-invalid", key);
    }
  }

  for (const [slotKey, run] of runsByKey) {
    const projection = projectionsByRunId.get(run.runId);
    if (!projection) {
      addIssue(issues, "run-projection-pair-missing", slotKey);
      continue;
    }
    const expected = plannedByKey.get(slotKey);
    if (!expectedProjectionShape(expected, projection)) {
      addIssue(issues, "projection-plan-mismatch", slotKey);
    }
  }
  for (const [runId] of projectionsByRunId) {
    if (!runsById.has(runId)) addIssue(issues, "projection-run-pair-missing", "artifacts");
  }

  if (issues.length > 0) {
    fail(issues);
    return;
  }

  const completed = new Map();
  for (const [slotKey, run] of runsByKey) {
    if (projectionsByRunId.has(run.runId)) completed.set(slotKey, run);
  }

  let nextIndex = planned.findIndex((entry) => !completed.has(entry.key));
  if (nextIndex === -1) nextIndex = planned.length;
  for (let index = nextIndex + 1; index < planned.length; index += 1) {
    if (completed.has(planned[index].key)) {
      addIssue(issues, "out-of-order-artifacts", planned[index].key);
    }
  }
  if (issues.length > 0) {
    fail(issues);
    return;
  }

  const nowMs = args.now === null ? Date.now() : canonicalLiveLaneMs(args.now);
  if (!Number.isFinite(nowMs)) {
    addIssue(issues, "now-invalid", "clock");
    fail(issues);
    return;
  }
  const checkedAt = new Date(nowMs).toISOString();
  const progress = Object.freeze({
    expectedPhysicalSubruns: planned.length,
    completedPhysicalSubruns: completed.size,
    remainingPhysicalSubruns: planned.length - completed.size,
  });

  if (nextIndex === planned.length) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      kind: "live-application-lane-next",
      valid: true,
      stage: args.stage,
      checkedAt,
      authority: "progress-only",
      progress,
      state: "complete",
      next: null,
    }, null, 2)}\n`);
    return;
  }

  const cooldownRequiredMs = plan.protocol.betweenPhysicalSubrunsMs;
  let eligibleAt = null;
  let remainingMs = 0;
  if (nextIndex > 0) {
    const previous = completed.get(planned[nextIndex - 1].key);
    const previousRecordedAtMs = canonicalLiveLaneMs(previous?.recordedAt);
    if (previousRecordedAtMs === null) {
      addIssue(issues, "previous-recorded-at-invalid", planned[nextIndex - 1].key);
      fail(issues);
      return;
    }
    const eligibleAtMs = previousRecordedAtMs + cooldownRequiredMs;
    eligibleAt = new Date(eligibleAtMs).toISOString();
    remainingMs = Math.max(0, eligibleAtMs - nowMs);
  }
  const cooldown = Object.freeze({
    requiredMs: cooldownRequiredMs,
    eligibleAt,
    remainingMs,
  });

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "live-application-lane-next",
    valid: true,
    stage: args.stage,
    checkedAt,
    authority: "progress-only",
    progress,
    state: remainingMs > 0 ? "cooldown" : "ready",
    next: nextDescriptor(plan, planned[nextIndex], cooldown),
  }, null, 2)}\n`);
}

main().catch(() => {
  process.stderr.write("live-lane-next: operation-failed\n");
  process.exitCode = 2;
});
