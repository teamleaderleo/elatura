// SPDX-License-Identifier: MPL-2.0
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { summarizeBenchmarkMatrix } from "../benchmarks/dist/benchmark.js";

const MODES = new Set(["edge-stock", "firefox-stock", "firefox-observe"]);

function usage() {
  console.error(
    "Usage: npm run compare:benchmarks -- <file-or-directory> [...] [--baseline firefox-stock] [--out summary.json]\n\nInputs may mix benchmark-run manifests and observer report exports. Directories are searched recursively for .json files.",
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
let baselineMode = "firefox-stock";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--out") {
    outputPath = args[++index] ?? null;
    if (!outputPath) throw new Error("--out requires a path.");
  } else if (argument === "--baseline") {
    baselineMode = args[++index] ?? "";
    if (!MODES.has(baselineMode)) throw new Error("--baseline must name edge-stock, firefox-stock, or firefox-observe.");
  } else if (argument === "--help" || argument === "-h") {
    usage();
    process.exit(0);
  } else {
    positional.push(argument);
  }
}

try {
  if (positional.length === 0) throw new Error("Provide at least one manifest, report, or directory.");
  const resolvedOutputPath = outputPath ? resolve(outputPath) : null;
  const paths = [...new Set((await Promise.all(positional.map(collect))).flat())]
    .filter((pathname) => pathname !== resolvedOutputPath)
    .sort();
  if (paths.length === 0) throw new Error("No JSON inputs were found.");

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

  const json = `${JSON.stringify(summarizeBenchmarkMatrix(manifests, observations, baselineMode), null, 2)}\n`;
  if (resolvedOutputPath) {
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, json, "utf8");
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
