// SPDX-License-Identifier: MPL-2.0
import Ajv2020 from "ajv/dist/2020.js";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILES = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PLAN_SCHEMA = fileURLToPath(
  new URL("../benchmarks/schema/live-application-lane-plan-v1.schema.json", import.meta.url),
);
const RUN_SCHEMA = fileURLToPath(
  new URL("../benchmarks/schema/live-application-lane-run-v1.schema.json", import.meta.url),
);
const PROJECTION_SCHEMA = fileURLToPath(
  new URL("../benchmarks/schema/live-application-lane-projection-v1.schema.json", import.meta.url),
);

function usage() {
  return "Usage: node scripts/validate-live-application-lane-artifacts.mjs <plan.json> <final-directory>";
}

function issue(issues, code, key) {
  issues.push({ code, key });
}

async function compileValidators() {
  // The repository schemas are authoritative. Ajv strict mode additionally
  // lints schema authoring style and rejects valid Draft 2020-12 constructs
  // used by these reviewed schemas, so keep that orthogonal lint disabled.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uuid", {
    type: "string",
    validate(value) {
      return UUID.test(value);
    },
  });
  const [planSchema, runSchema, projectionSchema] = await Promise.all(
    [PLAN_SCHEMA, RUN_SCHEMA, PROJECTION_SCHEMA].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
  return {
    plan: ajv.compile(planSchema),
    run: ajv.compile(runSchema),
    projection: ajv.compile(projectionSchema),
  };
}

async function collectJsonFiles(directory) {
  const rootStat = await lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  const names = (await readdir(directory)).sort();
  if (names.length > MAX_FILES) return null;
  const files = [];
  let totalBytes = 0;
  for (const name of names) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || extname(name) !== ".json") return null;
    if (stat.size > MAX_FILE_BYTES) return null;
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) return null;
    files.push(path);
  }
  return files;
}

async function parseJson(path) {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return { ok: false, value: null };
  }
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
  const validators = await compileValidators();
  const issues = [];

  const parsedPlan = await parseJson(planPath);
  if (!parsedPlan.ok) {
    issue(issues, "plan-json-invalid", "plan");
  } else if (!validators.plan(parsedPlan.value)) {
    issue(issues, "plan-schema-invalid", "plan");
  }

  let files;
  try {
    files = await collectJsonFiles(directory);
  } catch {
    files = null;
  }
  if (files === null) {
    issue(issues, "artifact-directory-invalid", "artifacts");
  } else {
    for (let index = 0; index < files.length; index += 1) {
      const key = `artifact-${String(index + 1).padStart(3, "0")}`;
      const parsed = await parseJson(files[index]);
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
