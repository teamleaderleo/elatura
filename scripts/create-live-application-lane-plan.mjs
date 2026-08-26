// SPDX-License-Identifier: MPL-2.0
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const ORDER_ROWS = [
  ["ES", "CS", "CRE", "CRS", "FE", "FS"],
  ["CS", "CRS", "ES", "FS", "CRE", "FE"],
  ["CRS", "FS", "CS", "FE", "ES", "CRE"],
  ["FS", "FE", "CRS", "CRE", "CS", "ES"],
  ["FE", "CRE", "FS", "ES", "CRS", "CS"],
  ["CRE", "ES", "FE", "CS", "FS", "CRS"],
];

const STAGES = [
  {
    stage: "chatgpt-single",
    application: "chatgpt",
    workloadToken: "chatgpt-pathological-a",
    pattern: "single-lane",
    laneCount: 1,
    rows: [1, 2, 3, 4, 5],
  },
  {
    stage: "chatgpt-switch-8",
    application: "chatgpt",
    workloadToken: "chatgpt-switch-8",
    pattern: "switch-8",
    laneCount: 8,
    rows: [1, 3, 5],
  },
  {
    stage: "gdocs-single",
    application: "google-docs",
    workloadToken: "docs-large-text-v1",
    pattern: "single-lane",
    laneCount: 1,
    rows: [1, 3, 5],
  },
  {
    stage: "gdocs-switch-8",
    application: "google-docs",
    workloadToken: "docs-switch-8-v1",
    pattern: "switch-8",
    laneCount: 8,
    rows: [1, 3, 5],
  },
];

const REQUIRED = [
  "edge-version",
  "edge-build",
  "chrome-version",
  "chrome-build",
  "chromium-version",
  "chromium-build",
  "firefox-version",
  "firefox-build",
  "elatura-revision",
  "firefox-intervention",
  "chromium-intervention",
];

function usage() {
  return [
    "Usage: node scripts/create-live-application-lane-plan.mjs <options>",
    "Required options:",
    "  --edge-version <token> --edge-build <token>",
    "  --chrome-version <token> --chrome-build <token>",
    "  --chromium-version <token> --chromium-build <token>",
    "  --firefox-version <token> --firefox-build <token>",
    "  --elatura-revision <token>",
    "  --firefox-intervention <lowercase-token>",
    "  --chromium-intervention <lowercase-token>",
    "Optional: --out <new-path>",
  ].join("\n");
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true, values };
    if (!arg.startsWith("--")) throw new Error(`unexpected positional argument at ${index + 1}`);
    const key = arg.slice(2);
    if (values.has(key)) throw new Error(`duplicate option --${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    values.set(key, value);
    index += 1;
  }
  return { help: false, values };
}

function versionToken(value, option) {
  if (typeof value !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,95}$/u.test(value)) {
    throw new Error(`--${option} must be a bounded version token`);
  }
  return value;
}

function lowerToken(value, option) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value)) {
    throw new Error(`--${option} must be a bounded lowercase token`);
  }
  return value;
}

function exactKeys(values) {
  const allowed = new Set([...REQUIRED, "out"]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`unsupported option --${key}`);
  }
  for (const key of REQUIRED) {
    if (!values.has(key)) throw new Error(`missing required option --${key}`);
  }
}

function subruns(conditionCode, blockNumber) {
  if (conditionCode !== "FE" && conditionCode !== "CRE") {
    return [{ ordinal: 1, mode: "none" }];
  }
  const modes = blockNumber % 2 === 1 ? ["passive", "managed"] : ["managed", "passive"];
  return modes.map((mode, index) => ({ ordinal: index + 1, mode }));
}

function stagePlan(stage) {
  return {
    stage: stage.stage,
    application: stage.application,
    workloadToken: stage.workloadToken,
    pattern: stage.pattern,
    laneCount: stage.laneCount,
    blockCount: stage.rows.length,
    blocks: stage.rows.map((rowNumber, blockIndex) => {
      const order = ORDER_ROWS[rowNumber - 1];
      return {
        number: blockIndex + 1,
        orderRow: rowNumber,
        conditionOrder: [...order],
        slots: order.map((conditionCode, conditionIndex) => ({
          conditionOrdinal: conditionIndex + 1,
          conditionCode,
          physicalSubruns: subruns(conditionCode, blockIndex + 1),
        })),
      };
    }),
  };
}

function createPlan(values) {
  exactKeys(values);
  const version = (key) => versionToken(values.get(key), key);
  return {
    schemaVersion: 1,
    kind: "live-application-lane-plan",
    sessionId: randomUUID(),
    generatedAt: new Date().toISOString(),
    browsers: {
      ES: {
        product: "Edge",
        engineFamily: "blink-v8",
        version: version("edge-version"),
        buildToken: version("edge-build"),
      },
      CS: {
        product: "Chrome",
        engineFamily: "blink-v8",
        version: version("chrome-version"),
        buildToken: version("chrome-build"),
      },
      CRS: {
        product: "Chromium",
        engineFamily: "blink-v8",
        version: version("chromium-version"),
        buildToken: version("chromium-build"),
      },
      FS: {
        product: "Firefox",
        engineFamily: "gecko-spidermonkey",
        version: version("firefox-version"),
        buildToken: version("firefox-build"),
      },
    },
    elatura: {
      revision: version("elatura-revision"),
      firefoxInterventionToken: lowerToken(values.get("firefox-intervention"), "firefox-intervention"),
      chromiumInterventionToken: lowerToken(
        values.get("chromium-intervention"),
        "chromium-intervention",
      ),
    },
    protocol: {
      samplePeriodMs: 2000,
      betweenPhysicalSubrunsMs: 60000,
      settleMs: 120000,
      steadyForegroundMs: 600000,
      singleLaneBackgroundProbeCount: 10,
      singleLaneBackgroundDwellMs: 30000,
      switchLaneCount: 8,
      switchWarmupRotations: 2,
      switchRecordedRotations: 12,
      switchDwellMs: 15000,
      longBackgroundMs: 300000,
      switchTimeoutMs: 15000,
      restartWaitMs: 60000,
    },
    stages: STAGES.map(stagePlan),
    privacy: {
      applicationContentCaptured: false,
      titlesCaptured: false,
      urlsCaptured: false,
      credentialsCaptured: false,
      screenshotsCaptured: false,
      rawDomCaptured: false,
      freeFormNotesCaptured: false,
    },
  };
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const plan = createPlan(parsed.values);
    const serialized = `${JSON.stringify(plan, null, 2)}\n`;
    const out = parsed.values.get("out");
    if (out) {
      await writeFile(out, serialized, { encoding: "utf8", flag: "wx" });
    } else {
      process.stdout.write(serialized);
    }
  } catch (error) {
    process.stderr.write(`live-lane-plan: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
  }
}

await main();
