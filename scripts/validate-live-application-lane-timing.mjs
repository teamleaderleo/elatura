// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import {
  LIVE_LANE_STAGES,
  canonicalLiveLaneMs,
  collectLiveLaneJsonFiles,
  liveLaneRunKey,
  parseLiveLaneJson,
  plannedLiveLaneSubruns,
} from "./live-application-lane-utils.mjs";

function issue(issues, code, key) {
  issues.push({ code, key });
}

function selectedStage(args) {
  let stage = null;
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] === "--stage") {
      const value = args[index + 1];
      if (!LIVE_LANE_STAGES.includes(value)) return null;
      stage = value;
      index += 1;
    } else if (args[index] === "--out") {
      index += 1;
    }
  }
  return stage;
}

async function collectRuns(directory) {
  const files = await collectLiveLaneJsonFiles(directory);
  if (files === null) return null;
  const runs = new Map();
  for (const path of files) {
    const parsed = await parseLiveLaneJson(path);
    if (!parsed.ok) return null;
    if (parsed.value?.kind !== "live-application-lane-run") continue;
    runs.set(liveLaneRunKey(parsed.value), parsed.value);
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
  const generatedAtMs = canonicalLiveLaneMs(plan.generatedAt);
  const cooldownMs = plan.protocol?.betweenPhysicalSubrunsMs;
  const runs = await collectRuns(directory);
  if (runs === null || generatedAtMs === null || !Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
    issue(issues, "timing-input-invalid", "session");
  } else {
    let previousRecordedAt = null;
    for (const planned of plannedLiveLaneSubruns(plan, stage)) {
      const key = planned.key;
      const run = runs.get(key);
      if (!run) {
        previousRecordedAt = null;
        continue;
      }
      const startedAtMs = canonicalLiveLaneMs(run.startedAt);
      const recordedAtMs = canonicalLiveLaneMs(run.recordedAt);
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
