// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";

const ORDER_ROWS = [
  ["ES", "CS", "CRE", "CRS", "FE", "FS"],
  ["CS", "CRS", "ES", "FS", "CRE", "FE"],
  ["CRS", "FS", "CS", "FE", "ES", "CRE"],
  ["FS", "FE", "CRS", "CRE", "CS", "ES"],
  ["FE", "CRE", "FS", "ES", "CRS", "CS"],
  ["CRE", "ES", "FE", "CS", "FS", "CRS"],
];

const STAGES = [
  ["chatgpt-single", "chatgpt", "chatgpt-pathological-a", "single-lane", 1, [1, 2, 3, 4, 5]],
  ["chatgpt-switch-8", "chatgpt", "chatgpt-switch-8", "switch-8", 8, [1, 3, 5]],
  ["gdocs-single", "google-docs", "docs-large-text-v1", "single-lane", 1, [1, 3, 5]],
  ["gdocs-switch-8", "google-docs", "docs-switch-8-v1", "switch-8", 8, [1, 3, 5]],
];

const BROWSERS = {
  ES: ["Edge", "blink-v8"],
  CS: ["Chrome", "blink-v8"],
  CRS: ["Chromium", "blink-v8"],
  FS: ["Firefox", "gecko-spidermonkey"],
};

const PROTOCOL = {
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
};

const PRIVACY_KEYS = [
  "applicationContentCaptured",
  "titlesCaptured",
  "urlsCaptured",
  "credentialsCaptured",
  "screenshotsCaptured",
  "rawDomCaptured",
  "freeFormNotesCaptured",
];

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,95}$/u;
const TOKEN = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

function usage() {
  return "Usage: node scripts/verify-live-application-lane-plan.mjs <plan.json>";
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function issue(issues, code, key = null) {
  issues.push({ code, key });
}

function expectedSubruns(conditionCode, blockNumber) {
  if (conditionCode !== "FE" && conditionCode !== "CRE") return [{ ordinal: 1, mode: "none" }];
  const modes = blockNumber % 2 === 1 ? ["passive", "managed"] : ["managed", "passive"];
  return modes.map((mode, index) => ({ ordinal: index + 1, mode }));
}

function verifyPrivacy(plan, issues) {
  const privacy = plan.privacy;
  if (!privacy || typeof privacy !== "object" || Array.isArray(privacy)) {
    issue(issues, "invalid-privacy");
    return;
  }
  const keys = Object.keys(privacy).sort();
  if (!sameArray(keys, [...PRIVACY_KEYS].sort())) issue(issues, "privacy-keys-mismatch");
  for (const key of PRIVACY_KEYS) if (privacy[key] !== false) issue(issues, "privacy-flag-violation", key);
}

function verifyBrowsers(plan, issues) {
  if (!plan.browsers || typeof plan.browsers !== "object" || Array.isArray(plan.browsers)) {
    issue(issues, "invalid-browsers");
    return;
  }
  if (!sameArray(Object.keys(plan.browsers).sort(), Object.keys(BROWSERS).sort())) issue(issues, "browser-keys-mismatch");
  for (const [code, [product, engineFamily]] of Object.entries(BROWSERS)) {
    const browser = plan.browsers[code];
    if (!browser || browser.product !== product || browser.engineFamily !== engineFamily) {
      issue(issues, "browser-identity-mismatch", code);
      continue;
    }
    if (!VERSION.test(browser.version ?? "")) issue(issues, "browser-version-invalid", code);
    if (!VERSION.test(browser.buildToken ?? "")) issue(issues, "browser-build-invalid", code);
  }
}

function verifyElatura(plan, issues) {
  const elatura = plan.elatura;
  if (!elatura || typeof elatura !== "object" || Array.isArray(elatura)) {
    issue(issues, "invalid-elatura");
    return;
  }
  if (!VERSION.test(elatura.revision ?? "")) issue(issues, "elatura-revision-invalid");
  if (!TOKEN.test(elatura.firefoxInterventionToken ?? "")) issue(issues, "firefox-intervention-invalid");
  if (!TOKEN.test(elatura.chromiumInterventionToken ?? "")) issue(issues, "chromium-intervention-invalid");
  if (elatura.chromiumTransport !== "extension-only" && elatura.chromiumTransport !== "extension-cdp") {
    issue(issues, "chromium-transport-invalid");
  }
}

function verifyProtocol(plan, issues) {
  const protocol = plan.protocol;
  if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) {
    issue(issues, "invalid-protocol");
    return;
  }
  if (!sameArray(Object.keys(protocol).sort(), Object.keys(PROTOCOL).sort())) issue(issues, "protocol-keys-mismatch");
  for (const [key, value] of Object.entries(PROTOCOL)) if (protocol[key] !== value) issue(issues, "protocol-value-mismatch", key);
}

function verifyStages(plan, issues) {
  let physicalRunCount = 0;
  if (!Array.isArray(plan.stages) || plan.stages.length !== STAGES.length) {
    issue(issues, "stage-count-mismatch");
    return physicalRunCount;
  }
  for (let stageIndex = 0; stageIndex < STAGES.length; stageIndex += 1) {
    const [stageName, application, workloadToken, pattern, laneCount, rows] = STAGES[stageIndex];
    const stage = plan.stages[stageIndex];
    const stageKey = String(stageName);
    if (
      !stage ||
      stage.stage !== stageName ||
      stage.application !== application ||
      stage.workloadToken !== workloadToken ||
      stage.pattern !== pattern ||
      stage.laneCount !== laneCount ||
      stage.blockCount !== rows.length ||
      !Array.isArray(stage.blocks) ||
      stage.blocks.length !== rows.length
    ) {
      issue(issues, "stage-definition-mismatch", stageKey);
      continue;
    }
    for (let blockIndex = 0; blockIndex < rows.length; blockIndex += 1) {
      const blockNumber = blockIndex + 1;
      const rowNumber = rows[blockIndex];
      const order = ORDER_ROWS[rowNumber - 1];
      const block = stage.blocks[blockIndex];
      const blockKey = `${stageKey}|${blockNumber}`;
      if (
        !block ||
        block.number !== blockNumber ||
        block.orderRow !== rowNumber ||
        !sameArray(block.conditionOrder, order) ||
        !Array.isArray(block.slots) ||
        block.slots.length !== 6
      ) {
        issue(issues, "block-definition-mismatch", blockKey);
        continue;
      }
      for (let conditionIndex = 0; conditionIndex < order.length; conditionIndex += 1) {
        const code = order[conditionIndex];
        const slot = block.slots[conditionIndex];
        const expected = expectedSubruns(code, blockNumber);
        const slotKey = `${blockKey}|${conditionIndex + 1}`;
        if (
          !slot ||
          slot.conditionOrdinal !== conditionIndex + 1 ||
          slot.conditionCode !== code ||
          !Array.isArray(slot.physicalSubruns) ||
          slot.physicalSubruns.length !== expected.length
        ) {
          issue(issues, "slot-definition-mismatch", slotKey);
          continue;
        }
        for (let subrunIndex = 0; subrunIndex < expected.length; subrunIndex += 1) {
          const actualSubrun = slot.physicalSubruns[subrunIndex];
          const expectedSubrun = expected[subrunIndex];
          if (actualSubrun?.ordinal !== expectedSubrun.ordinal || actualSubrun?.mode !== expectedSubrun.mode) {
            issue(issues, "subrun-definition-mismatch", `${slotKey}|${subrunIndex + 1}`);
          }
        }
        physicalRunCount += expected.length;
      }
    }
  }
  return physicalRunCount;
}

async function main() {
  const planPath = process.argv[2];
  if (!planPath || process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = planPath ? 0 : 2;
    return;
  }
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const issues = [];
  if (plan.schemaVersion !== 1 || plan.kind !== "live-application-lane-plan") issue(issues, "invalid-plan-kind");
  if (typeof plan.sessionId !== "string" || plan.sessionId.length > 64) issue(issues, "invalid-session-id");
  const generatedMs = typeof plan.generatedAt === "string" ? Date.parse(plan.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedMs) || new Date(generatedMs).toISOString() !== plan.generatedAt) issue(issues, "invalid-generated-at");
  verifyPrivacy(plan, issues);
  verifyBrowsers(plan, issues);
  verifyElatura(plan, issues);
  verifyProtocol(plan, issues);
  const physicalRunCount = verifyStages(plan, issues);
  if (physicalRunCount !== 112) issue(issues, "physical-run-count-mismatch", String(physicalRunCount));
  const unique = [...new Map(issues.map((item) => [`${item.code}|${item.key ?? ""}`, item])).values()]
    .sort((left, right) => `${left.code}|${left.key ?? ""}`.localeCompare(`${right.code}|${right.key ?? ""}`));
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "live-application-lane-plan-verification",
    sessionId: plan.sessionId ?? null,
    valid: unique.length === 0,
    physicalRunCount,
    issues: unique,
  }, null, 2)}\n`);
  process.exitCode = unique.length === 0 ? 0 : 2;
}

main().catch((error) => {
  process.stderr.write(`live-lane-plan-verify: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 2;
});
