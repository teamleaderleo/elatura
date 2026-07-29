// SPDX-License-Identifier: MPL-2.0
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createBenchmarkSessionPlan } from "../benchmarks/dist/session.js";
import { OBSERVATION_REPORT_SCHEMA_VERSION } from "../extension/firefox/dist/report.js";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const MEMORY_METHODS = new Set(["activity-monitor", "task-manager", "ps"]);

function usage() {
  console.error(
    "Usage: npm run baseline:plan -- --edge-version <version> --firefox-version <version> --memory-method <activity-monitor|task-manager|ps> [--client-navigation] [--out path]",
  );
}

const options = {
  edgeVersion: null,
  firefoxVersion: null,
  memoryMethod: null,
  includeClientNavigation: false,
  outputPath: "artifacts/live-baseline/session-plan.json",
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--edge-version") options.edgeVersion = args[++index] ?? null;
  else if (argument === "--firefox-version") options.firefoxVersion = args[++index] ?? null;
  else if (argument === "--memory-method") options.memoryMethod = args[++index] ?? null;
  else if (argument === "--client-navigation") options.includeClientNavigation = true;
  else if (argument === "--out") options.outputPath = args[++index] ?? "";
  else if (argument === "--help" || argument === "-h") {
    usage();
    process.exit(0);
  } else {
    throw new Error(`Unsupported baseline plan argument: ${argument}`);
  }
}

try {
  if (!options.edgeVersion || !options.firefoxVersion) {
    throw new Error("Both --edge-version and --firefox-version are required.");
  }
  if (!options.memoryMethod || !MEMORY_METHODS.has(options.memoryMethod)) {
    throw new Error("--memory-method must be activity-monitor, task-manager, or ps.");
  }
  if (!options.outputPath) throw new Error("--out requires a path.");

  const extensionManifest = JSON.parse(
    await readFile(resolve(ROOT, "extension/firefox/dist/manifest.json"), "utf8"),
  );
  const plan = createBenchmarkSessionPlan({
    sessionId: randomUUID(),
    generatedAt: new Date().toISOString(),
    edgeVersion: options.edgeVersion,
    firefoxVersion: options.firefoxVersion,
    observerExtensionVersion: extensionManifest.version,
    observerReportSchemaVersion: OBSERVATION_REPORT_SCHEMA_VERSION,
    memoryMethod: options.memoryMethod,
    includeClientNavigation: options.includeClientNavigation,
  });
  const outputPath = resolve(ROOT, options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${relative(ROOT, outputPath)}: ${plan.slots.length} content-free run slots; session ${plan.sessionId}\n`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
