// SPDX-License-Identifier: MPL-2.0
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  LIVE_LANE_MEMORY_PRESSURE_CLASSES,
  LIVE_LANE_RESOURCE_SAMPLER_PHASES,
  createLiveLaneSamplerState,
  parseLiveLaneSamplerState,
} from "./live-application-lane-resource-sampler.mjs";

function usage() {
  return [
    "Usage: npm run live-lane:sampler:state -- <state.json> [options]",
    "",
    "Options:",
    `  --phase <${LIVE_LANE_RESOURCE_SAMPLER_PHASES.join("|")}>`,
    "  --lane <1..8|clear>",
    "  --browser-root-pid <pid|clear>",
    "  --elatura-root-pid <pid|clear>",
    `  --memory-pressure <${LIVE_LANE_MEMORY_PRESSURE_CLASSES.join("|")}>`,
    "  --at <canonical UTC timestamp>   deterministic/operator clock override",
    "",
    "Omitted options preserve an existing valid state. A new file starts with",
    "phase=launch, no root PIDs, no lane ordinal, and memory pressure unknown.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [path, ...rest] = argv;
  if (!path || path.startsWith("--")) throw new TypeError("arguments-invalid");
  const output = {
    help: false,
    path: resolve(path),
    phase: undefined,
    laneOrdinal: undefined,
    browserRootPid: undefined,
    externalElaturaRootPid: undefined,
    memoryPressureClass: undefined,
    updatedAt: undefined,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new TypeError("arguments-invalid");
    if (key === "--phase") output.phase = value;
    else if (key === "--lane") output.laneOrdinal = parseNullablePositive(value, 8, "lane-invalid");
    else if (key === "--browser-root-pid") {
      output.browserRootPid = parseNullablePositive(value, 4_194_304, "browser-pid-invalid");
    } else if (key === "--elatura-root-pid") {
      output.externalElaturaRootPid = parseNullablePositive(value, 4_194_304, "elatura-pid-invalid");
    } else if (key === "--memory-pressure") output.memoryPressureClass = value;
    else if (key === "--at") output.updatedAt = value;
    else throw new TypeError("arguments-invalid");
    index += 1;
  }
  return output;
}

function parseNullablePositive(value, maximum, code) {
  if (value === "clear") return null;
  if (!/^[1-9][0-9]*$/u.test(value)) throw new TypeError(code);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new TypeError(code);
  return number;
}

async function readExisting(path) {
  try {
    return parseLiveLaneSamplerState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw new TypeError("existing-state-invalid");
  }
}

async function writeAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`live-lane-sampler-state: ${error instanceof Error ? error.message : "arguments-invalid"}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  try {
    const existing = await readExisting(args.path);
    const next = createLiveLaneSamplerState({
      phase: args.phase ?? existing?.phase ?? "launch",
      laneOrdinal: args.laneOrdinal !== undefined ? args.laneOrdinal : existing?.laneOrdinal ?? null,
      browserRootPid:
        args.browserRootPid !== undefined
          ? args.browserRootPid
          : existing?.browserRootPid ?? null,
      externalElaturaRootPid:
        args.externalElaturaRootPid !== undefined
          ? args.externalElaturaRootPid
          : existing?.externalElaturaRootPid ?? null,
      memoryPressureClass:
        args.memoryPressureClass ?? existing?.memoryPressureClass ?? "unknown",
      updatedAt: args.updatedAt ?? new Date().toISOString(),
    });
    await writeAtomic(args.path, next);
    process.stdout.write(`${JSON.stringify({
      kind: "live-application-lane-sampler-state-update",
      valid: true,
      phase: next.phase,
      laneOrdinal: next.laneOrdinal,
      browserRoot: next.browserRootPid === null ? "unset" : "set",
      externalElaturaRoot: next.externalElaturaRootPid === null ? "unset" : "set",
      memoryPressureClass: next.memoryPressureClass,
      updatedAt: next.updatedAt,
    })}\n`);
  } catch (error) {
    const code = error instanceof Error ? error.message : "operation-failed";
    process.stderr.write(`live-lane-sampler-state: ${code}\n`);
    process.exitCode = 2;
  }
}

main();
