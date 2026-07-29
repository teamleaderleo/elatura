// SPDX-License-Identifier: MPL-2.0
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBenchmarkSession } from "../benchmarks/dist/session.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(
    "Usage: npm run baseline:check -- <session-plan.json> <manifest-or-report-or-directory> [...] [--out readiness.json]",
  );
}

async function collect(pathname) {
  const resolved = resolve(pathname);
  const details = await stat(resolved);
  if (details.isFile()) return extname(resolved).toLowerCase() === ".json" ? [resolved] : [];
  if (!details.isDirectory()) return [];
  const entries = await readdir(resolved, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => collect(join(resolved, entry.name))));
  return nested.flat();
}

function classify(value, pathname) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${pathname}: expected one JSON object.`);
  }
  if (typeof value.runId === "string" && typeof value.navigation === "string") return "manifest";
  if (value.mode === "observe" && typeof value.run === "object" && value.run !== null) return "observation";
  throw new TypeError(`${pathname}: unsupported JSON input.`);
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
  const paths = [...new Set((await Promise.all(positional.slice(1).map(collect))).flat())]
    .filter((pathname) => pathname !== planPath && pathname !== resolvedOutputPath)
    .sort();
  if (paths.length === 0) throw new Error("No benchmark manifest or observation report JSON inputs were found.");

  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const manifests = [];
  const observations = [];
  for (const pathname of paths) {
    let input;
    try {
      input = JSON.parse(await readFile(pathname, "utf8"));
    } catch (error) {
      throw new Error(`${pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (classify(input, pathname) === "manifest") manifests.push(input);
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
