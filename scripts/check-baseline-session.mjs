// SPDX-License-Identifier: MPL-2.0
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBenchmarkSession } from "../benchmarks/dist/session.js";
import {
  collectBaselineInputFiles,
  readBaselineJsonEntry,
  readBaselinePlan,
} from "./baseline-input-bundle.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(
    "Usage: npm run baseline:check -- <session-plan.json> <manifest-or-report-or-directory> [...] [--out readiness.json]",
  );
}

function classify(value, entryIndex) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Input entry ${entryIndex}: expected one JSON object.`);
  }
  if (typeof value.runId === "string" && typeof value.navigation === "string") return "manifest";
  if (value.mode === "observe" && typeof value.run === "object" && value.run !== null) return "observation";
  throw new TypeError(`Input entry ${entryIndex}: unsupported JSON input.`);
}

const positional = [];
let outputPath = null;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--out") {
    outputPath = args[++index] ?? null;
    if (!outputPath) throw new Error("--out requires a path.");
  } else if (argument === "--help" || argument === "-h") {
    usage();
    process.exit(0);
  } else {
    positional.push(argument);
  }
}

try {
  if (positional.length < 2) {
    throw new Error("Provide a session plan and at least one manifest/report file or directory.");
  }
  const planPath = resolve(positional[0]);
  const resolvedOutputPath = outputPath ? resolve(outputPath) : null;
  const entries = await collectBaselineInputFiles(positional.slice(1), {
    outputPath: resolvedOutputPath,
  });
  if (entries.length === 0) throw new Error("No benchmark manifest or observation report JSON inputs were found.");

  const plan = await readBaselinePlan(planPath);
  const manifests = [];
  const observations = [];
  for (const entry of entries) {
    const input = await readBaselineJsonEntry(entry);
    if (classify(input, entry.entryIndex) === "manifest") manifests.push(input);
    else observations.push(input);
  }

  const readiness = checkBenchmarkSession(plan, manifests, observations);
  const json = `${JSON.stringify(readiness, null, 2)}\n`;
  if (resolvedOutputPath) {
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, json, "utf8");
    process.stdout.write(`${relative(ROOT, resolvedOutputPath)}: ${readiness.ready ? "ready" : "not ready"}\n`);
  } else {
    process.stdout.write(json);
  }
  if (!readiness.ready) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
