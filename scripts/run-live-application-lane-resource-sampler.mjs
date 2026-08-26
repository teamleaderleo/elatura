// SPDX-License-Identifier: MPL-2.0
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS,
  aggregateLiveLaneProcessSnapshot,
  createLiveLaneSamplerFooter,
  createLiveLaneSamplerHeader,
  createLiveLaneSamplerSampleLine,
  parseLiveLaneSamplerState,
  readNumericPsProcessTable,
} from "./live-application-lane-resource-sampler.mjs";

const MAX_SAMPLES = 10_000;
const MAX_DURATION_MS = 86_400_000;

function usage() {
  return [
    "Usage: npm run live-lane:sampler -- --state <state.json> --out <samples.jsonl> [--duration-ms <1..86400000>]",
    "",
    `Sampling period is fixed at ${LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS} ms by the #116 protocol.`,
    "The state file supplies phase/lane plus explicit browser and external-Elatura root PIDs.",
    "Stop an unbounded run with SIGINT or SIGTERM; the collector writes a graceful footer.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  let state = null;
  let out = null;
  let durationMs = null;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new TypeError("arguments-invalid");
    if (key === "--state") {
      if (state !== null) throw new TypeError("arguments-invalid");
      state = resolve(value);
    } else if (key === "--out") {
      if (out !== null) throw new TypeError("arguments-invalid");
      out = resolve(value);
    } else if (key === "--duration-ms") {
      if (durationMs !== null || !/^[1-9][0-9]*$/u.test(value)) {
        throw new TypeError("duration-invalid");
      }
      durationMs = Number(value);
      if (!Number.isSafeInteger(durationMs) || durationMs > MAX_DURATION_MS) {
        throw new TypeError("duration-invalid");
      }
    } else {
      throw new TypeError("arguments-invalid");
    }
    index += 1;
  }
  if (state === null || out === null) throw new TypeError("arguments-invalid");
  if (state === out) throw new TypeError("state-and-output-must-differ");
  return { help: false, state, out, durationMs };
}

async function readState(path) {
  try {
    return parseLiveLaneSamplerState(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new TypeError("state-invalid");
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(0, milliseconds)));
}

function errorCode(error) {
  if (!(error instanceof Error)) return "process-snapshot-failed";
  if (error.message === "state-invalid") return "state-invalid";
  if (error.message.includes("process trees overlap")) return "process-tree-overlap";
  if (error.message === "sample-limit") return "sample-limit";
  return "process-snapshot-failed";
}

async function appendJson(handle, value) {
  await handle.appendFile(`${JSON.stringify(value)}\n`, "utf8");
  await handle.sync();
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`live-lane-sampler: ${error instanceof Error ? error.message : "arguments-invalid"}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (process.platform !== "darwin" && process.platform !== "linux") {
    process.stderr.write("live-lane-sampler: unsupported-platform\n");
    process.exitCode = 2;
    return;
  }

  // Validate the control file before creating the evidence sidecar.
  try {
    await readState(args.state);
  } catch {
    process.stderr.write("live-lane-sampler: state-invalid\n");
    process.exitCode = 2;
    return;
  }

  let handle;
  try {
    handle = await open(args.out, "wx", 0o600);
  } catch {
    process.stderr.write("live-lane-sampler: output-open-failed\n");
    process.exitCode = 2;
    return;
  }

  const startedAt = new Date().toISOString();
  const startedMonotonicMs = performance.now();
  let sampleCount = 0;
  let requestedStop = null;
  let fatalCode = null;

  const requestSignalStop = () => {
    if (requestedStop === null) requestedStop = "signal";
  };
  process.once("SIGINT", requestSignalStop);
  process.once("SIGTERM", requestSignalStop);

  try {
    await appendJson(
      handle,
      createLiveLaneSamplerHeader({
        startedAt,
        platform: process.platform,
      }),
    );

    while (requestedStop === null) {
      const sampleStartedMonotonicMs = performance.now();
      const elapsedMs = Math.max(0, Math.round(sampleStartedMonotonicMs - startedMonotonicMs));
      try {
        if (sampleCount >= MAX_SAMPLES) throw new TypeError("sample-limit");
        const state = await readState(args.state);
        const rows = readNumericPsProcessTable();
        const aggregate = aggregateLiveLaneProcessSnapshot(rows, state, elapsedMs);
        await appendJson(
          handle,
          createLiveLaneSamplerSampleLine({
            capturedAt: new Date().toISOString(),
            aggregate,
          }),
        );
        sampleCount += 1;
      } catch (error) {
        fatalCode = errorCode(error);
        requestedStop = "error";
        break;
      }

      const elapsedAfterSampleMs = performance.now() - startedMonotonicMs;
      if (args.durationMs !== null && elapsedAfterSampleMs >= args.durationMs) {
        requestedStop = "duration";
        break;
      }
      const nextDeadlineMs = startedMonotonicMs + sampleCount * LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS;
      await sleep(nextDeadlineMs - performance.now());
      if (
        args.durationMs !== null &&
        performance.now() - startedMonotonicMs >= args.durationMs
      ) {
        requestedStop = "duration";
      }
    }

    const stopReason = requestedStop ?? "signal";
    await appendJson(
      handle,
      createLiveLaneSamplerFooter({
        stoppedAt: new Date().toISOString(),
        sampleCount,
        stopReason,
        errorCode: stopReason === "error" ? fatalCode : null,
      }),
    );
  } catch {
    fatalCode = "output-failed";
    process.stderr.write("live-lane-sampler: output-failed\n");
  } finally {
    process.removeListener("SIGINT", requestSignalStop);
    process.removeListener("SIGTERM", requestSignalStop);
    await handle.close().catch(() => {});
  }

  if (fatalCode !== null) {
    if (fatalCode !== "output-failed") {
      process.stderr.write(`live-lane-sampler: ${fatalCode}\n`);
    }
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`${JSON.stringify({
    kind: "live-application-lane-resource-sampler-complete",
    startedAt,
    stoppedAt: new Date().toISOString(),
    sampleCount,
    stopReason: requestedStop ?? "signal",
    samplePeriodMs: LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS,
  })}\n`);
}

main().catch(() => {
  process.stderr.write("live-lane-sampler: operation-failed\n");
  process.exitCode = 2;
});
