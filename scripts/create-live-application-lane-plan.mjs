// SPDX-License-Identifier: MPL-2.0
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

const DOCS_FIXTURES = Object.freeze([
  Object.freeze({
    id: "docs-large-text-v1",
    documentCount: 1,
    paragraphCount: 4_800,
    anchorCount: 10,
    textCodeUnits: 772_800,
    sha256: Object.freeze([
      "sha256:c466eec37b1b635904d1c39d7b97ea88d6cd1c9a0657c1ebb6b25e9af66e551c",
    ]),
  }),
  Object.freeze({
    id: "docs-switch-8-v1",
    documentCount: 8,
    paragraphCount: 1_800,
    anchorCount: 10,
    textCodeUnits: 289_800,
    sha256: Object.freeze([
      "sha256:f5855ab3fb7d1f082e9841753b14520d1b84a7361b1acbec9faaf41f8fda93dd",
      "sha256:2c5e137297acb20a4d185f464b92a0017b65f49c737fc211f02cc25c6990c200",
      "sha256:a3005ba93509e00008d7b0af9c947e1fb63711787971d2058568b04c0709419c",
      "sha256:124af5d8aea35dd77ceff59bb94824f5d1fa71f1d0988f7f4e5d0e35f341bc71",
      "sha256:23205c768b72d5e3855e16eb8b585fb4e56101b3fe5cb16935066af968f36de1",
      "sha256:e1100c8d5e890db2c103b7102610426e77195e94dcaa56b053be46de0cd1961d",
      "sha256:f3c535dc04b8d2326cd7bfb2d2b0dfa2306e216ba7c10f7dcb79a38a9596df67",
      "sha256:f74e2b179019635a324cee7a86ddbba886c14a192f5d2ec138aff10086c556f5",
    ]),
  }),
]);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

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
  "chromium-transport",
  "gdocs-manifest",
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
    "  --chromium-transport extension-only|extension-cdp",
    "  --gdocs-manifest <path-to-#122-generated-manifest.json>",
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

function chromiumTransport(value) {
  if (value !== "extension-only" && value !== "extension-cdp") {
    throw new Error("--chromium-transport must be extension-only or extension-cdp");
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

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function expectedDocsFileName(fixture, documentOrdinal) {
  if (fixture.documentCount === 1) return `${fixture.id}.txt`;
  return `${fixture.id}-${String(documentOrdinal + 1).padStart(2, "0")}.txt`;
}

async function verifyGoogleDocsFixtureManifest(pathValue) {
  const manifestPath = resolve(pathValue);
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("--gdocs-manifest must contain valid JSON");
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.generator !== "google-docs-workload-v1" ||
    !Array.isArray(manifest.fixtures) ||
    manifest.fixtures.length !== DOCS_FIXTURES.length
  ) {
    throw new Error("--gdocs-manifest does not match google-docs-workload-v1");
  }

  const root = dirname(manifestPath);
  const identities = {};
  for (let fixtureIndex = 0; fixtureIndex < DOCS_FIXTURES.length; fixtureIndex += 1) {
    const expected = DOCS_FIXTURES[fixtureIndex];
    const actual = manifest.fixtures[fixtureIndex];
    if (
      !actual ||
      actual.id !== expected.id ||
      !Array.isArray(actual.files) ||
      actual.files.length !== expected.documentCount
    ) {
      throw new Error(`--gdocs-manifest fixture ${expected.id} is malformed`);
    }
    const perDocumentTextCodeUnits = [];
    for (let documentOrdinal = 0; documentOrdinal < expected.documentCount; documentOrdinal += 1) {
      const file = actual.files[documentOrdinal];
      const expectedFileName = expectedDocsFileName(expected, documentOrdinal);
      const expectedSha256 = expected.sha256[documentOrdinal];
      if (
        !file ||
        file.fileName !== expectedFileName ||
        file.documentOrdinal !== documentOrdinal ||
        file.paragraphCount !== expected.paragraphCount ||
        file.anchorCount !== expected.anchorCount ||
        file.textCodeUnits !== expected.textCodeUnits ||
        file.sha256 !== expectedSha256 ||
        typeof file.sha256 !== "string" ||
        !SHA256.test(file.sha256)
      ) {
        throw new Error(`--gdocs-manifest file identity mismatch for ${expectedFileName}`);
      }
      const fileBytes = await readFile(resolve(root, expectedFileName));
      const text = fileBytes.toString("utf8");
      if (text.length !== expected.textCodeUnits || sha256(fileBytes) !== expectedSha256) {
        throw new Error(`Google Docs fixture bytes do not match #122 for ${expectedFileName}`);
      }
      perDocumentTextCodeUnits.push(expected.textCodeUnits);
    }
    identities[expected.id] = Object.freeze({
      documentCount: expected.documentCount,
      totalTextCodeUnits: expected.textCodeUnits * expected.documentCount,
      perDocumentTextCodeUnits: Object.freeze(perDocumentTextCodeUnits),
    });
  }

  return Object.freeze({
    generator: "google-docs-workload-v1",
    manifestSha256: sha256(manifestBytes),
    largeText: identities["docs-large-text-v1"],
    switch8: identities["docs-switch-8-v1"],
  });
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

async function createPlan(values) {
  exactKeys(values);
  const version = (key) => versionToken(values.get(key), key);
  const googleDocs = await verifyGoogleDocsFixtureManifest(values.get("gdocs-manifest"));
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
      chromiumTransport: chromiumTransport(values.get("chromium-transport")),
    },
    fixtures: { googleDocs },
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
    const plan = await createPlan(parsed.values);
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
