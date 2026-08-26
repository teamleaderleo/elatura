// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";

export const LIVE_LANE_RESOURCE_SAMPLER_VERSION = 1;
export const LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS = 2_000;
export const LIVE_LANE_RESOURCE_SAMPLER_PHASES = Object.freeze([
  "launch",
  "initial-hydration",
  "settle",
  "steady-foreground",
  "background-probe",
  "switch-warmup",
  "steady-switch",
  "long-background",
  "long-background-return",
  "attention",
  "recovery",
]);
export const LIVE_LANE_MEMORY_PRESSURE_CLASSES = Object.freeze([
  "normal",
  "warn",
  "critical",
  "unknown",
]);

const MAX_PID = 4_194_304;
const MAX_CPU_PERCENT = 102_400;
const MAX_PROCESS_ROWS = 32_768;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PS_ROW = /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)$/u;

export function canonicalSamplerTimestamp(value, label = "sampler timestamp") {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function parseLiveLaneSamplerState(value) {
  const input = exactRecord(value, "live-lane sampler state", [
    "schemaVersion",
    "phase",
    "laneOrdinal",
    "browserRootPid",
    "externalElaturaRootPid",
    "memoryPressureClass",
    "updatedAt",
  ]);
  if (input.schemaVersion !== LIVE_LANE_RESOURCE_SAMPLER_VERSION) {
    throw new TypeError("live-lane sampler state version is invalid");
  }
  return Object.freeze({
    schemaVersion: LIVE_LANE_RESOURCE_SAMPLER_VERSION,
    phase: exactEnum(input.phase, LIVE_LANE_RESOURCE_SAMPLER_PHASES, "sampler phase"),
    laneOrdinal: nullableLaneOrdinal(input.laneOrdinal),
    browserRootPid: nullablePid(input.browserRootPid, "browser root pid"),
    externalElaturaRootPid: nullablePid(
      input.externalElaturaRootPid,
      "external Elatura root pid",
    ),
    memoryPressureClass: exactEnum(
      input.memoryPressureClass,
      LIVE_LANE_MEMORY_PRESSURE_CLASSES,
      "memory pressure class",
    ),
    updatedAt: canonicalSamplerTimestamp(input.updatedAt, "sampler state update time"),
  });
}

export function createLiveLaneSamplerState({
  phase = "launch",
  laneOrdinal = null,
  browserRootPid = null,
  externalElaturaRootPid = null,
  memoryPressureClass = "unknown",
  updatedAt = new Date().toISOString(),
} = {}) {
  return parseLiveLaneSamplerState({
    schemaVersion: LIVE_LANE_RESOURCE_SAMPLER_VERSION,
    phase,
    laneOrdinal,
    browserRootPid,
    externalElaturaRootPid,
    memoryPressureClass,
    updatedAt,
  });
}

export function parseNumericPsProcessTable(text) {
  if (typeof text !== "string") throw new TypeError("process snapshot is invalid");
  const rows = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (rows.length >= MAX_PROCESS_ROWS) throw new TypeError("process snapshot is too large");
    const match = PS_ROW.exec(line);
    if (!match) throw new TypeError("process snapshot row is invalid");
    const pid = positiveIntegerAtMost(Number(match[1]), MAX_PID, "process pid");
    const parentPid = nonNegativeIntegerAtMost(Number(match[2]), MAX_PID, "process parent pid");
    const rssKiB = nonNegativeIntegerAtMost(
      Number(match[3]),
      Number.MAX_SAFE_INTEGER / 1024,
      "process rss",
    );
    const cpuPercent = finiteNumberInRange(Number(match[4]), 0, MAX_CPU_PERCENT, "process cpu");
    if (seen.has(pid)) throw new TypeError("process snapshot contains a duplicate pid");
    seen.add(pid);
    rows.push(Object.freeze({ pid, parentPid, rssBytes: rssKiB * 1024, cpuPercent }));
  }
  return Object.freeze(rows);
}

export function readNumericPsProcessTable({
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  if (platform !== "darwin" && platform !== "linux") {
    throw new TypeError("live-lane resource sampler platform is unsupported");
  }
  const result = spawn(
    "ps",
    ["-axo", "pid=,ppid=,rss=,%cpu="],
    {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (
    result === null ||
    result.status !== 0 ||
    typeof result.stdout !== "string" ||
    result.error
  ) {
    throw new TypeError("numeric process snapshot failed");
  }
  return parseNumericPsProcessTable(result.stdout);
}

export function aggregateLiveLaneProcessSnapshot(rowsInput, stateInput, elapsedMsInput) {
  const rows = validateProcessRows(rowsInput);
  const state = parseLiveLaneSamplerState(stateInput);
  const elapsedMs = nonNegativeIntegerAtMost(elapsedMsInput, 86_400_000, "sample elapsed time");

  const browser = treeForRoot(rows, state.browserRootPid);
  const external = treeForRoot(rows, state.externalElaturaRootPid);
  const overlap = intersect(browser.pids, external.pids);
  if (overlap.size > 0) throw new TypeError("browser and external Elatura process trees overlap");

  const targetPids = new Set([...browser.pids, ...external.pids]);
  const target = aggregateRows(rows, targetPids);
  const browserStats = aggregateRows(rows, browser.pids);
  const externalStats = aggregateRows(rows, external.pids);

  return Object.freeze({
    sample: Object.freeze({
      elapsedMs,
      phase: state.phase,
      laneOrdinal: state.laneOrdinal,
      targetHostRssBytes: target.rssBytes,
      browserTreeRssBytes: browserStats.rssBytes,
      externalElaturaRssBytes:
        state.externalElaturaRootPid === null ? null : externalStats.rssBytes,
      targetHostCpuPercent: target.cpuPercent,
      browserTreeCpuPercent: browserStats.cpuPercent,
      externalElaturaCpuPercent:
        state.externalElaturaRootPid === null ? null : externalStats.cpuPercent,
      targetHostProcessCount: target.processCount,
      browserTreeProcessCount: browserStats.processCount,
      externalElaturaProcessCount: externalStats.processCount,
      memoryPressureClass: state.memoryPressureClass,
    }),
    roots: Object.freeze({
      browser: browser.status,
      externalElatura: external.status,
    }),
  });
}

export function createLiveLaneSamplerHeader({
  startedAt,
  platform,
  samplePeriodMs = LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS,
} = {}) {
  if (platform !== "darwin" && platform !== "linux") {
    throw new TypeError("live-lane resource sampler platform is unsupported");
  }
  if (samplePeriodMs !== LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS) {
    throw new TypeError("live-lane resource sampler period is invalid");
  }
  return Object.freeze({
    schemaVersion: LIVE_LANE_RESOURCE_SAMPLER_VERSION,
    kind: "live-application-lane-resource-sampler-header",
    startedAt: canonicalSamplerTimestamp(startedAt, "sampler start time"),
    samplePeriodMs: LIVE_LANE_RESOURCE_SAMPLE_PERIOD_MS,
    platform: platform === "darwin" ? "macos" : "linux",
    processSource: "ps-numeric-pid-ppid-rss-cpu-v1",
    targetHostDefinition: "browser-tree-plus-external-elatura-tree",
    rssAccounting: "sum-process-rss-bytes",
    cpuAccounting: "sum-process-percent-one-logical-core",
    rootSelection: "explicit-control-file-pids",
    privacy: Object.freeze({
      processCommandLinesCaptured: false,
      processNamesCaptured: false,
      applicationContentCaptured: false,
      urlsCaptured: false,
      credentialsCaptured: false,
      freeFormNotesCaptured: false,
    }),
  });
}

export function createLiveLaneSamplerSampleLine({ capturedAt, aggregate }) {
  if (aggregate === null || typeof aggregate !== "object") {
    throw new TypeError("sampler aggregate is invalid");
  }
  validateResourceSample(aggregate.sample);
  const roots = exactRecord(aggregate.roots, "sampler root states", ["browser", "externalElatura"]);
  return Object.freeze({
    schemaVersion: LIVE_LANE_RESOURCE_SAMPLER_VERSION,
    kind: "live-application-lane-resource-sampler-sample",
    capturedAt: canonicalSamplerTimestamp(capturedAt, "sample capture time"),
    roots: Object.freeze({
      browser: exactEnum(roots.browser, ["unset", "present", "missing"], "browser root state"),
      externalElatura: exactEnum(
        roots.externalElatura,
        ["unset", "present", "missing"],
        "external Elatura root state",
      ),
    }),
    sample: aggregate.sample,
  });
}

export function createLiveLaneSamplerFooter({
  stoppedAt,
  sampleCount,
  stopReason,
  errorCode = null,
} = {}) {
  const reason = exactEnum(stopReason, ["duration", "signal", "error"], "sampler stop reason");
  if ((reason === "error") !== (errorCode !== null)) {
    throw new TypeError("sampler stop reason and error code are incoherent");
  }
  if (errorCode !== null) {
    exactEnum(
      errorCode,
      [
        "state-invalid",
        "process-snapshot-failed",
        "process-tree-overlap",
        "output-failed",
      ],
      "sampler error code",
    );
  }
  return Object.freeze({
    schemaVersion: LIVE_LANE_RESOURCE_SAMPLER_VERSION,
    kind: "live-application-lane-resource-sampler-footer",
    stoppedAt: canonicalSamplerTimestamp(stoppedAt, "sampler stop time"),
    sampleCount: nonNegativeIntegerAtMost(sampleCount, 10_000, "sampler sample count"),
    stopReason: reason,
    errorCode,
  });
}

export function validateResourceSample(value) {
  const input = exactRecord(value, "resource sample", [
    "elapsedMs",
    "phase",
    "laneOrdinal",
    "targetHostRssBytes",
    "browserTreeRssBytes",
    "externalElaturaRssBytes",
    "targetHostCpuPercent",
    "browserTreeCpuPercent",
    "externalElaturaCpuPercent",
    "targetHostProcessCount",
    "browserTreeProcessCount",
    "externalElaturaProcessCount",
    "memoryPressureClass",
  ]);
  nonNegativeIntegerAtMost(input.elapsedMs, 86_400_000, "sample elapsed time");
  exactEnum(input.phase, LIVE_LANE_RESOURCE_SAMPLER_PHASES, "sample phase");
  nullableLaneOrdinal(input.laneOrdinal);
  nonNegativeIntegerAtMost(input.targetHostRssBytes, Number.MAX_SAFE_INTEGER, "target rss");
  nonNegativeIntegerAtMost(input.browserTreeRssBytes, Number.MAX_SAFE_INTEGER, "browser rss");
  nullableNonNegativeInteger(input.externalElaturaRssBytes, "external Elatura rss");
  finiteNumberInRange(input.targetHostCpuPercent, 0, MAX_CPU_PERCENT, "target cpu");
  finiteNumberInRange(input.browserTreeCpuPercent, 0, MAX_CPU_PERCENT, "browser cpu");
  nullableFiniteNumber(input.externalElaturaCpuPercent, 0, MAX_CPU_PERCENT, "external Elatura cpu");
  nonNegativeIntegerAtMost(input.targetHostProcessCount, 4096, "target process count");
  nonNegativeIntegerAtMost(input.browserTreeProcessCount, 4096, "browser process count");
  nonNegativeIntegerAtMost(input.externalElaturaProcessCount, 4096, "external process count");
  exactEnum(input.memoryPressureClass, LIVE_LANE_MEMORY_PRESSURE_CLASSES, "memory pressure class");
  return value;
}

function validateProcessRows(value) {
  if (!Array.isArray(value) || value.length > MAX_PROCESS_ROWS) {
    throw new TypeError("process snapshot is invalid");
  }
  const seen = new Set();
  const output = [];
  for (const row of value) {
    const input = exactRecord(row, "process snapshot row", ["pid", "parentPid", "rssBytes", "cpuPercent"]);
    const pid = positiveIntegerAtMost(input.pid, MAX_PID, "process pid");
    if (seen.has(pid)) throw new TypeError("process snapshot contains a duplicate pid");
    seen.add(pid);
    output.push(Object.freeze({
      pid,
      parentPid: nonNegativeIntegerAtMost(input.parentPid, MAX_PID, "process parent pid"),
      rssBytes: nonNegativeIntegerAtMost(input.rssBytes, Number.MAX_SAFE_INTEGER, "process rss"),
      cpuPercent: finiteNumberInRange(input.cpuPercent, 0, MAX_CPU_PERCENT, "process cpu"),
    }));
  }
  return Object.freeze(output);
}

function treeForRoot(rows, rootPid) {
  if (rootPid === null) return Object.freeze({ status: "unset", pids: new Set() });
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  if (!byPid.has(rootPid)) return Object.freeze({ status: "missing", pids: new Set() });
  const children = new Map();
  for (const row of rows) {
    const bucket = children.get(row.parentPid) ?? [];
    bucket.push(row.pid);
    children.set(row.parentPid, bucket);
  }
  const pids = new Set();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pids.has(pid)) continue;
    pids.add(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return Object.freeze({ status: "present", pids });
}

function aggregateRows(rows, pids) {
  let rssBytes = 0;
  let cpuPercent = 0;
  let processCount = 0;
  for (const row of rows) {
    if (!pids.has(row.pid)) continue;
    rssBytes += row.rssBytes;
    cpuPercent += row.cpuPercent;
    processCount += 1;
  }
  if (!Number.isSafeInteger(rssBytes)) throw new TypeError("aggregate rss exceeds safe integer range");
  return Object.freeze({
    rssBytes,
    cpuPercent: Number(cpuPercent.toFixed(3)),
    processCount,
  });
}

function intersect(left, right) {
  const output = new Set();
  for (const value of left) if (right.has(value)) output.add(value);
  return output;
}

function exactRecord(value, label, keys) {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new TypeError();
    }
    const output = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError();
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
}

function exactEnum(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nullableLaneOrdinal(value) {
  if (value === null) return null;
  return positiveIntegerAtMost(value, 8, "lane ordinal");
}

function nullablePid(value, label) {
  if (value === null) return null;
  return positiveIntegerAtMost(value, MAX_PID, label);
}

function positiveIntegerAtMost(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nonNegativeIntegerAtMost(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nullableNonNegativeInteger(value, label) {
  if (value === null) return null;
  return nonNegativeIntegerAtMost(value, Number.MAX_SAFE_INTEGER, label);
}

function finiteNumberInRange(value, minimum, maximum, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nullableFiniteNumber(value, minimum, maximum, label) {
  if (value === null) return null;
  return finiteNumberInRange(value, minimum, maximum, label);
}
