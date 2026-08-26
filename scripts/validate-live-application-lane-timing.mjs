// SPDX-License-Identifier: MPL-2.0
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const MAX_FILES = 256;
const STAGES = new Set([
  "chatgpt-single",
  "chatgpt-switch-8",
  "gdocs-single",
  "gdocs-switch-8",
]);

function canonicalMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

function issue(issues, code, key) {
  issues.push({ code, key });
}

function runKey(run) {
  return [
    run?.block?.stage,
    run?.block?.number,
    run?.block?.conditionOrdinal,
    run?.block?.physicalSubrunOrdinal,
  ].join("|");
}

function selectedStage(args) {
  let stage = null;
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] === "--stage") {
      const value = args[index + 1];
      if (!STAGES.has(value)) return null;
      stage = value;
      index += 1;
    } else if (args[index] === "--out") {
      index += 1;
    }
  }
  return stage;
}

function expectedKeys(plan, stage) {
  const keys = [];
  for (const stageRecord of plan.stages ?? []) {
    if (stage !== null && stageRecord?.stage !== stage) continue;
    for (const block of stageRecord?.blocks ?? []) {
      for (const slot of block?.slots ?? []) {
        for (const subrun of slot?.physicalSubruns ?? []) {
          keys.push([
            stageRecord.stage,
            block.number,
            slot.conditionOrdinal,
            subrun.ordinal,
          ].join("|"));
        }
      }
    }
  }
  return keys;
}

async function collectRuns(directory) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) return null;
  const names = (await readdir(directory)).sort();
  if (names.length > MAX_FILES) return null;
  const runs = new Map();
  for (const name of names) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || extname(name) !== ".json") return null;
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.kind !== "live-application-lane-run") continue;
    runs.set(runKey(parsed), parsed);
  }
  return runs;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.exitCode = 2;
    return;
  }
  const [planPath, directory] = args;
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const stage = selectedStage(args);
  const issues = [];
  const generatedAtMs = canonicalMs(plan.generatedAt);
  const cooldownMs = plan.protocol?.betweenPhysicalSubrunsMs;
  const runs = await collectRuns(directory);
  if (runs === null || generatedAtMs === null || !Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
    issue(issues, "timing-input-invalid", "session");
  } else {
    let previousRecordedAt = null;
    for (const key of expectedKeys(plan, stage)) {
      const run = runs.get(key);
      if (!run) {
        previousRecordedAt = null;
        continue;
      }
      const startedAtMs = canonicalMs(run.startedAt);
      const recordedAtMs = canonicalMs(run.recordedAt);
      if (startedAtMs === null) issue(issues, "invalid-started-at", key);
      if (recordedAtMs === null) {
        previousRecordedAt = null;
        continue;
      }
      if (startedAtMs === null) {
        previousRecordedAt = null;
        continue;
      }
      if (startedAtMs <= generatedAtMs) issue(issues, "started-before-plan", key);
      if (recordedAtMs <= startedAtMs) {
        issue(issues, "run-time-order-violation", key);
        previousRecordedAt = null;
        continue;
      }
      if (previousRecordedAt !== null && startedAtMs - previousRecordedAt < cooldownMs) {
        issue(issues, "inter-run-cooldown-violation", key);
      }
      previousRecordedAt = recordedAtMs;
    }
  }

  const unique = [...new Map(issues.map((entry) => [`${entry.code}|${entry.key}`, entry])).values()]
    .sort((left, right) => `${left.code}|${left.key}`.localeCompare(`${right.code}|${right.key}`));
  if (unique.length === 0) return;
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "live-application-lane-timing-admission",
    valid: false,
    issues: unique,
  }, null, 2)}\n`);
  process.exitCode = 2;
}

main().catch(() => {
  process.stderr.write("live-lane-timing-admission: validation-failed\n");
  process.exitCode = 2;
});
