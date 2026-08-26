// SPDX-License-Identifier: MPL-2.0
import {
  collectLiveLaneJsonFiles,
  compileLiveLaneValidators,
  parseLiveLaneJson,
} from "./live-application-lane-utils.mjs";

function usage() {
  return "Usage: node scripts/validate-live-application-lane-artifacts.mjs <plan.json> <final-directory>";
}

function issue(issues, code, key) {
  issues.push({ code, key });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.length !== 2) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const [planPath, directory] = args;
  const validators = await compileLiveLaneValidators();
  const issues = [];

  const parsedPlan = await parseLiveLaneJson(planPath);
  if (!parsedPlan.ok) {
    issue(issues, "plan-json-invalid", "plan");
  } else if (!validators.plan(parsedPlan.value)) {
    issue(issues, "plan-schema-invalid", "plan");
  }

  const files = await collectLiveLaneJsonFiles(directory);
  if (files === null) {
    issue(issues, "artifact-directory-invalid", "artifacts");
  } else {
    for (let index = 0; index < files.length; index += 1) {
      const key = `artifact-${String(index + 1).padStart(3, "0")}`;
      const parsed = await parseLiveLaneJson(files[index]);
      if (!parsed.ok) {
        issue(issues, "artifact-json-invalid", key);
        continue;
      }
      const kind = parsed.value?.kind;
      if (kind === "live-application-lane-run") {
        if (!validators.run(parsed.value)) issue(issues, "run-schema-invalid", key);
      } else if (kind === "live-application-lane-projection-ledger") {
        if (!validators.projection(parsed.value)) issue(issues, "projection-schema-invalid", key);
      } else {
        issue(issues, "artifact-kind-invalid", key);
      }
    }
  }

  const unique = [...new Map(issues.map((entry) => [`${entry.code}|${entry.key}`, entry])).values()]
    .sort((left, right) => `${left.code}|${left.key}`.localeCompare(`${right.code}|${right.key}`));
  if (unique.length === 0) return;

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "live-application-lane-schema-admission",
    valid: false,
    issues: unique,
  }, null, 2)}\n`);
  process.exitCode = 2;
}

main().catch(() => {
  process.stderr.write("live-lane-schema-admission: validator-initialization-failed\n");
  process.exitCode = 2;
});
