// SPDX-License-Identifier: MPL-2.0
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { summarizeObservationReports } from "../benchmarks/dist/observation.js";

function usage() {
  console.error(`Usage: npm run analyze:reports -- <file-or-directory> [...] [--out summary.json]\n\nEvery JSON input is privacy-validated and reconciled before statistics are produced. Directories are searched recursively for .json files.`);
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
  if (positional.length === 0) throw new Error("Provide at least one report file or directory.");
  const resolvedOutputPath = outputPath ? resolve(outputPath) : null;
  const paths = [...new Set((await Promise.all(positional.map(collect))).flat())]
    .filter((pathname) => pathname !== resolvedOutputPath)
    .sort();
  if (paths.length === 0) throw new Error("No JSON report files were found.");
  const reports = [];
  for (const pathname of paths) {
    try {
      reports.push(JSON.parse(await readFile(pathname, "utf8")));
    } catch (error) {
      throw new Error(`${pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const json = `${JSON.stringify(summarizeObservationReports(reports), null, 2)}\n`;
  if (resolvedOutputPath) {
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, json, "utf8");
  } else process.stdout.write(json);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
