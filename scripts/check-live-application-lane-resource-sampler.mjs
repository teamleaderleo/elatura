// SPDX-License-Identifier: MPL-2.0
import { lstat, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS,
  LIVE_LANE_RESOURCE_SAMPLER_VERSION,
  canonicalSamplerTimestamp,
  validateResourceSample,
} from "./live-application-lane-resource-sampler.mjs";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_LINES = 10_002;

function usage() {
  return [
    "Usage: npm run live-lane:sampler:check -- <samples.jsonl> [--extract <samples.json>]",
    "",
    "Validates the content-free sampler sidecar and reports spacing/root-state diagnostics.",
    "--extract writes only the resourceSample objects for insertion into a run manifest.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [input, ...rest] = argv;
  if (!input || input.startsWith("--")) throw new TypeError("arguments-invalid");
  let extract = null;
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key !== "--extract" || extract !== null || !value || value.startsWith("--")) {
      throw new TypeError("arguments-invalid");
    }
    extract = resolve(value);
    index += 1;
  }
  const inputPath = resolve(input);
  if (extract === inputPath) throw new TypeError("input-and-extract-must-differ");
  return { help: false, input: inputPath, extract };
}

function exactRecord(value, label, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} is invalid`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} is invalid`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} is invalid`);
  }
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} is invalid`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function exactEnum(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function parseHeader(value) {
  const input = exactRecord(value, "sampler header", [
    "schemaVersion",
    "kind",
    "startedAt",
    "samplePeriodMs",
    "platform",
    "processSource",
    "targetHostDefinition",
    "rssAccounting",
    "cpuAccounting",
    "rootSelection",
    "privacy",
  ]);
  if (
    input.schemaVersion !== LIVE_LANE_RESOURCE_SAMPLER_VERSION ||
    input.kind !== "live-application-lane-resource-sampler-header" ||
    input.samplePeriodMs !== LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS ||
    input.processSource !== "ps-numeric-pid-ppid-rss-cpu-v1" ||
    input.targetHostDefinition !== "browser-tree-plus-external-elatura-tree" ||
    input.rssAccounting !== "sum-process-rss-bytes" ||
    input.cpuAccounting !== "sum-process-percent-one-logical-core" ||
    input.rootSelection !== "explicit-control-file-pids"
  ) {
    throw new TypeError("sampler header is invalid");
  }
  exactEnum(input.platform, ["macos", "linux"], "sampler platform");
  canonicalSamplerTimestamp(input.startedAt, "sampler start time");
  const privacy = exactRecord(input.privacy, "sampler privacy", [
    "processCommandLinesCaptured",
    "processNamesCaptured",
    "applicationContentCaptured",
    "urlsCaptured",
    "credentialsCaptured",
    "freeFormNotesCaptured",
  ]);
  if (Object.values(privacy).some((entry) => entry !== false)) {
    throw new TypeError("sampler privacy is invalid");
  }
  return input;
}

function parseSampleLine(value) {
  const input = exactRecord(value, "sampler sample line", [
    "schemaVersion",
    "kind",
    "capturedAt",
    "roots",
    "sample",
  ]);
  if (
    input.schemaVersion !== LIVE_LANE_RESOURCE_SAMPLER_VERSION ||
    input.kind !== "live-application-lane-resource-sampler-sample"
  ) {
    throw new TypeError("sampler sample line is invalid");
  }
  canonicalSamplerTimestamp(input.capturedAt, "sample capture time");
  const roots = exactRecord(input.roots, "sampler root states", ["browser", "externalElatura"]);
  exactEnum(roots.browser, ["unset", "present", "missing"], "browser root state");
  exactEnum(
    roots.externalElatura,
    ["unset", "present", "missing"],
    "external Elatura root state",
  );
  validateResourceSample(input.sample);
  return { capturedAt: input.capturedAt, roots, sample: input.sample };
}

function parseFooter(value) {
  const input = exactRecord(value, "sampler footer", [
    "schemaVersion",
    "kind",
    "stoppedAt",
    "sampleCount",
    "stopReason",
    "errorCode",
  ]);
  if (
    input.schemaVersion !== LIVE_LANE_RESOURCE_SAMPLER_VERSION ||
    input.kind !== "live-application-lane-resource-sampler-footer"
  ) {
    throw new TypeError("sampler footer is invalid");
  }
  canonicalSamplerTimestamp(input.stoppedAt, "sampler stop time");
  nonNegativeInteger(input.sampleCount, "sampler sample count", 10_000);
  exactEnum(input.stopReason, ["duration", "signal", "error"], "sampler stop reason");
  if (input.stopReason === "error") {
    exactEnum(
      input.errorCode,
      ["state-invalid", "process-snapshot-failed", "process-tree-overlap", "output-failed"],
      "sampler error code",
    );
  } else if (input.errorCode !== null) {
    throw new TypeError("sampler footer is incoherent");
  }
  return input;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function readInput(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES) {
    throw new TypeError("input-invalid");
  }
  return readFile(path, "utf8");
}

async function writeExtract(path, samples) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(samples, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`live-lane-sampler-check: ${error instanceof Error ? error.message : "arguments-invalid"}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  try {
    const text = await readInput(args.input);
    const rawLines = text.split(/\r?\n/u);
    if (rawLines.at(-1) === "") rawLines.pop();
    if (rawLines.length < 3 || rawLines.length > MAX_LINES) {
      throw new TypeError("line-count-invalid");
    }
    const values = rawLines.map((line) => JSON.parse(line));
    const header = parseHeader(values[0]);
    const footer = parseFooter(values.at(-1));
    const samples = values.slice(1, -1).map(parseSampleLine);
    if (samples.length !== footer.sampleCount) throw new TypeError("sample-count-mismatch");
    if (footer.stopReason === "error") throw new TypeError("sampler-reported-error");

    const headerMs = Date.parse(header.startedAt);
    const footerMs = Date.parse(footer.stoppedAt);
    let previousElapsed = -1;
    let previousCapturedMs = headerMs;
    const intervals = [];
    let browserMissingSamples = 0;
    let externalElaturaMissingSamples = 0;
    const phases = {};
    for (const entry of samples) {
      const elapsed = entry.sample.elapsedMs;
      const capturedMs = Date.parse(entry.capturedAt);
      if (elapsed <= previousElapsed || capturedMs < previousCapturedMs || capturedMs < headerMs) {
        throw new TypeError("sample-order-invalid");
      }
      if (previousElapsed >= 0) intervals.push(elapsed - previousElapsed);
      previousElapsed = elapsed;
      previousCapturedMs = capturedMs;
      if (entry.roots.browser === "missing") browserMissingSamples += 1;
      if (entry.roots.externalElatura === "missing") externalElaturaMissingSamples += 1;
      phases[entry.sample.phase] = (phases[entry.sample.phase] ?? 0) + 1;
    }
    if (footerMs < previousCapturedMs || footerMs < headerMs) {
      throw new TypeError("sampler-time-order-invalid");
    }

    if (args.extract !== null) {
      await writeExtract(args.extract, samples.map((entry) => entry.sample));
    }

    const spacing = intervals.length === 0
      ? { minimumMs: null, medianMs: null, maximumMs: null }
      : {
          minimumMs: Math.min(...intervals),
          medianMs: median(intervals),
          maximumMs: Math.max(...intervals),
        };
    process.stdout.write(`${JSON.stringify({
      kind: "live-application-lane-resource-sampler-check",
      valid: true,
      samplePeriodMs: header.samplePeriodMs,
      sampleCount: samples.length,
      stopReason: footer.stopReason,
      spacing,
      browserMissingSamples,
      externalElaturaMissingSamples,
      phases,
      extractWritten: args.extract !== null,
      privacy: "content-free-process-aggregates",
    }, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof SyntaxError
      ? "json-invalid"
      : error instanceof Error
        ? error.message
        : "validation-failed";
    process.stdout.write(`${JSON.stringify({
      kind: "live-application-lane-resource-sampler-check",
      valid: false,
      issues: [{ code }],
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

main().catch(() => {
  process.stderr.write("live-lane-sampler-check: operation-failed\n");
  process.exitCode = 2;
});
