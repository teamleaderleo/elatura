// SPDX-License-Identifier: MPL-2.0
import Ajv2020 from "ajv/dist/2020.js";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE_LANE_MAX_FILES = 256;
export const LIVE_LANE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const LIVE_LANE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const LIVE_LANE_STAGES = Object.freeze([
  "chatgpt-single",
  "chatgpt-switch-8",
  "gdocs-single",
  "gdocs-switch-8",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PLAN_SCHEMA = fileURLToPath(
  new URL("../benchmarks/schema/live-application-lane-plan-v1.schema.json", import.meta.url),
);
const RUN_SCHEMA = fileURLToPath(
  new URL("../benchmarks/schema/live-application-lane-run-v1.schema.json", import.meta.url),
);
const PROJECTION_SCHEMA = fileURLToPath(
  new URL("../benchmarks/schema/live-application-lane-projection-v1.schema.json", import.meta.url),
);

export async function compileLiveLaneValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uuid", {
    type: "string",
    validate(value) {
      return UUID.test(value);
    },
  });
  const [planSchema, runSchema, projectionSchema] = await Promise.all(
    [PLAN_SCHEMA, RUN_SCHEMA, PROJECTION_SCHEMA].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
  return Object.freeze({
    plan: ajv.compile(planSchema),
    run: ajv.compile(runSchema),
    projection: ajv.compile(projectionSchema),
  });
}

export async function collectLiveLaneJsonFiles(directory) {
  let rootStat;
  try {
    rootStat = await lstat(directory);
  } catch {
    return null;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;

  const names = (await readdir(directory)).sort();
  if (names.length > LIVE_LANE_MAX_FILES) return null;
  const files = [];
  let totalBytes = 0;
  for (const name of names) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || extname(name) !== ".json") return null;
    if (stat.size > LIVE_LANE_MAX_FILE_BYTES) return null;
    totalBytes += stat.size;
    if (totalBytes > LIVE_LANE_MAX_TOTAL_BYTES) return null;
    files.push(path);
  }
  return Object.freeze(files);
}

export async function parseLiveLaneJson(path) {
  try {
    return Object.freeze({ ok: true, value: JSON.parse(await readFile(path, "utf8")) });
  } catch {
    return Object.freeze({ ok: false, value: null });
  }
}

export function canonicalLiveLaneMs(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

export function liveLaneRunKey(run) {
  return [
    run?.block?.stage,
    run?.block?.number,
    run?.block?.conditionOrdinal,
    run?.block?.physicalSubrunOrdinal,
  ].join("|");
}

export function plannedLiveLaneSubruns(plan, selectedStage = null) {
  const output = [];
  for (const stageRecord of plan?.stages ?? []) {
    if (selectedStage !== null && stageRecord?.stage !== selectedStage) continue;
    for (const block of stageRecord?.blocks ?? []) {
      for (const slot of block?.slots ?? []) {
        for (const subrun of slot?.physicalSubruns ?? []) {
          output.push(Object.freeze({
            key: [
              stageRecord.stage,
              block.number,
              slot.conditionOrdinal,
              subrun.ordinal,
            ].join("|"),
            stage: stageRecord.stage,
            application: stageRecord.application,
            workloadToken: stageRecord.workloadToken,
            pattern: stageRecord.pattern,
            laneCount: stageRecord.laneCount,
            blockNumber: block.number,
            conditionOrdinal: slot.conditionOrdinal,
            conditionCode: slot.conditionCode,
            physicalSubrunOrdinal: subrun.ordinal,
            elaturaMode: subrun.mode,
          }));
        }
      }
    }
  }
  return Object.freeze(output);
}

export function expectedLiveLaneCondition(plan, planned) {
  const code = planned.conditionCode;
  const stockCode = code === "FE" ? "FS" : code === "CRE" ? "CRS" : code;
  const browser = plan?.browsers?.[stockCode];
  if (!browser) throw new TypeError("planned browser identity is missing");

  if (code === "FE") {
    return Object.freeze({
      code,
      browserProduct: browser.product,
      engineFamily: browser.engineFamily,
      browserVersion: browser.version,
      browserBuildToken: browser.buildToken,
      elatura: Object.freeze({
        present: true,
        mode: planned.elaturaMode,
        transport: "firefox-extension",
        revision: plan.elatura.revision,
        interventionToken: plan.elatura.firefoxInterventionToken,
      }),
    });
  }
  if (code === "CRE") {
    return Object.freeze({
      code,
      browserProduct: browser.product,
      engineFamily: browser.engineFamily,
      browserVersion: browser.version,
      browserBuildToken: browser.buildToken,
      elatura: Object.freeze({
        present: true,
        mode: planned.elaturaMode,
        transport: plan.elatura.chromiumTransport === "extension-cdp"
          ? "chromium-extension-cdp"
          : "chromium-extension",
        revision: plan.elatura.revision,
        interventionToken: plan.elatura.chromiumInterventionToken,
      }),
    });
  }
  return Object.freeze({
    code,
    browserProduct: browser.product,
    engineFamily: browser.engineFamily,
    browserVersion: browser.version,
    browserBuildToken: browser.buildToken,
    elatura: Object.freeze({
      present: false,
      mode: "none",
      transport: "none",
      revision: null,
      interventionToken: null,
    }),
  });
}

export function liveLaneRunMatchesPlannedSlot(plan, planned, run) {
  let condition;
  try {
    condition = expectedLiveLaneCondition(plan, planned);
  } catch {
    return false;
  }
  return (
    run?.sessionId === plan?.sessionId &&
    liveLaneRunKey(run) === planned.key &&
    run?.condition?.code === condition.code &&
    run?.condition?.browserProduct === condition.browserProduct &&
    run?.condition?.engineFamily === condition.engineFamily &&
    run?.condition?.browserVersion === condition.browserVersion &&
    run?.condition?.browserBuildToken === condition.browserBuildToken &&
    run?.condition?.elatura?.present === condition.elatura.present &&
    run?.condition?.elatura?.mode === condition.elatura.mode &&
    run?.condition?.elatura?.transport === condition.elatura.transport &&
    run?.condition?.elatura?.revision === condition.elatura.revision &&
    run?.condition?.elatura?.interventionToken === condition.elatura.interventionToken &&
    run?.workload?.application === planned.application &&
    run?.workload?.token === planned.workloadToken &&
    run?.workload?.pattern === planned.pattern &&
    run?.workload?.laneCount === planned.laneCount
  );
}
