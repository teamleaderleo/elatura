// SPDX-License-Identifier: MPL-2.0
/**
 * Runs the held-out #114 comparison with two fresh ephemeral Codex workers.
 *
 * The broad control receives a complete local JSONL representation. The
 * bounded worker receives only the viewport CLI and its fixed loopback
 * endpoint. Raw worker transcripts remain in a temporary directory and are
 * deleted unless --keep-scratch is supplied; the emitted result contains only
 * bounded synthetic/accounting fields accepted by the benchmark contract.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELD_OUT_VIEWPORT_GOLD,
  buildHeldOutViewportRepresentation,
  createLoopbackServer,
} from "./run-synthetic-companion-loopback.mjs";
import { createAgentViewportClient } from "./query-agent-viewport.mjs";
import {
  gradeAgentViewportBenchmark,
  parseAgentViewportBenchmarkResult,
} from "../benchmarks/dist/agent-viewport-benchmark.js";
import { parseViewportEnvelopes } from "./viewport-benchmark-measurement.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL = "gpt-5.6-luna";
const ANSWER_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "approvedProfile",
    "rollbackThreshold",
    "rollbackCadence",
    "recoveryCommand",
    "action",
    "evidence",
    "sourceFreshness",
    "provenanceVerified",
    "omissionExplicit",
    "zeroAuthority",
  ],
  properties: {
    approvedProfile: { type: "string", maxLength: 128 },
    rollbackThreshold: { type: "integer", minimum: 0, maximum: 1_000 },
    rollbackCadence: { type: "string", maxLength: 128 },
    recoveryCommand: { type: "string", maxLength: 512 },
    action: { type: "string", maxLength: 128 },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["approvedProfile", "rollbackPolicy", "recoveryCommand"],
      properties: {
        approvedProfile: { type: "string", maxLength: 512 },
        rollbackPolicy: { type: "string", maxLength: 512 },
        recoveryCommand: { type: "string", maxLength: 512 },
      },
    },
    sourceFreshness: { enum: ["fresh", "stale", "drifted", "UNKNOWN"] },
    provenanceVerified: { type: "boolean" },
    omissionExplicit: { type: "boolean" },
    zeroAuthority: { type: "boolean" },
  },
});

const TASK = `Recover one justified action from an enormous synthetic conversation.

Find the approved profile by searching the exact marker APPROVED_PROFILE_LINK and following its stated bounded direction. Find the rollback threshold and cadence by searching ROLLBACK_THRESHOLD_LINK and following its stated bounded direction. Find the exact recovery command by searching RECOVERY_COMMAND_LINK and retrieving its code resource. Ignore entries explicitly labelled DECOY.

Return the exact approved profile, numeric rollback threshold, rollback cadence, exact recovery command, and these exact evidence entry ids. The action token must be use-approved-profile-and-rollback-only-at-threshold. Verify source freshness and provenance. Report whether omission stayed explicit and whether the surface granted zero submission/navigation/click authority. Do not infer missing values.`;

function parseArguments(argv) {
  const parsed = {
    model: DEFAULT_MODEL,
    output: join(REPO_ROOT, "artifacts", "agent-viewport-dogfood-v1.json"),
    keepScratch: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--model") parsed.model = argv[++index];
    else if (argument === "--output") parsed.output = resolve(argv[++index]);
    else if (argument === "--keep-scratch") parsed.keepScratch = true;
    else if (argument === "--help") parsed.help = true;
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  if (typeof parsed.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(parsed.model)) {
    throw new TypeError("--model must be a bounded model token.");
  }
  return parsed;
}

function canonicalTimestamp() {
  return new Date().toISOString();
}

function tokenFromUuid(prefix) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonLines(path, entries) {
  const serialized = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await writeFile(path, serialized, "utf8");
  return Buffer.byteLength(serialized);
}

async function prepareBroadWorkspace(root, representation) {
  await mkdir(root, { recursive: true });
  const sourcePath = join(root, "conversation.jsonl");
  const sourceBytes = await writeJsonLines(sourcePath, representation.entries);
  const metadata = {
    version: representation.version,
    adapter: representation.adapter,
    provenance: representation.provenance,
    entryCount: representation.entries.length,
    omission: { kind: "none", completeRepresentation: true },
    authority: { readOnly: true, submission: false, navigation: false, click: false },
  };
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  await writeFile(join(root, "source-metadata.json"), metadataText, "utf8");
  await writeFile(join(root, "answer-schema.json"), `${JSON.stringify(ANSWER_SCHEMA, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "README.md"),
    `${TASK}\n\nThe complete representation is conversation.jsonl (one entry per line); source-metadata.json carries provenance, freshness, omission, and authority. Use ordinary local rg/sed/jq-style inspection. Do not inspect files outside this directory.\n`,
    "utf8",
  );
  return { sourceBytes: sourceBytes + Buffer.byteLength(metadataText), sourcePath };
}

async function prepareBoundedWorkspace(root, origin) {
  await mkdir(root, { recursive: true });
  await mkdir(join(root, "node_modules", "@elatura", "core"), { recursive: true });
  await cp(join(REPO_ROOT, "packages", "core", "dist"), join(root, "node_modules", "@elatura", "core", "dist"), {
    recursive: true,
  });
  await cp(
    join(REPO_ROOT, "packages", "core", "package.json"),
    join(root, "node_modules", "@elatura", "core", "package.json"),
  );
  await cp(join(REPO_ROOT, "scripts", "query-agent-viewport.mjs"), join(root, "query-agent-viewport.mjs"));
  const wrapper = `#!/bin/sh\noperation="$1"\nshift\nexec node "$(dirname "$0")/query-agent-viewport.mjs" "$operation" --origin ${origin} --conversation ${HELD_OUT_VIEWPORT_GOLD.conversationId} "$@"\n`;
  await writeFile(join(root, "viewport"), wrapper, "utf8");
  await chmod(join(root, "viewport"), 0o755);
  await writeFile(join(root, "answer-schema.json"), `${JSON.stringify(ANSWER_SCHEMA, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "README.md"),
    `${TASK}\n\nThe raw representation is unavailable. Use only ./viewport. Start with ./viewport --help and ./viewport status. Available operations are status, search, open, page-before, page-after, get-entry, get-resource, jump-back, and close. Every operation emits one JSON envelope. Do not inspect files outside this directory.\n`,
    "utf8",
  );
}

function runProcess(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("close", (exitCode) => resolveRun({ exitCode, stdout, stderr }));
  });
}

function parseCodexEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") events.push(value);
    } catch {
      // Non-JSON noise is excluded from the content-safe benchmark summary.
    }
  }
  return events;
}

function commandRecords(events) {
  return events
    .filter((event) => event.type === "item.completed" && event.item?.type === "command_execution")
    .map((event) => event.item);
}

function finalAnswer(events) {
  const messages = events.filter(
    (event) => event.type === "item.completed" && event.item?.type === "agent_message",
  );
  const text = messages.at(-1)?.item?.text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function threadId(events) {
  const value = events.find((event) => event.type === "thread.started")?.thread_id;
  if (typeof value !== "string") return "thread-missing";
  return `thread-${sha256(value).slice(0, 16)}`;
}

function entryIdsIn(text) {
  return new Set(text.match(/synthetic-2g-[0-9]+-(?:root|user|assistant|hidden|branch)/gu) ?? []);
}

function objective(answer) {
  const facts = answer?.approvedProfile === HELD_OUT_VIEWPORT_GOLD.approvedProfile.profile &&
    answer?.rollbackThreshold === HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.threshold &&
    answer?.rollbackCadence === HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.cadence;
  const resource = answer?.recoveryCommand === HELD_OUT_VIEWPORT_GOLD.recoveryCommand.command;
  const action = answer?.action === "use-approved-profile-and-rollback-only-at-threshold";
  const evidence = answer?.evidence?.approvedProfile === HELD_OUT_VIEWPORT_GOLD.approvedProfile.factEntryId &&
    answer?.evidence?.rollbackPolicy === HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.factEntryId &&
    answer?.evidence?.recoveryCommand === HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId;
  const criterion = (observed) => ({ expected: true, observed, exact: observed });
  return { facts: criterion(facts), resource: criterion(resource), action: criterion(action), evidence: criterion(evidence) };
}

function explicitness(route, answer, envelopes) {
  if (route === "broad-control") {
    return {
      provenance: answer?.provenanceVerified === true,
      omission: answer?.omissionExplicit === true,
      freshness: answer?.sourceFreshness === "fresh",
      zeroAuthority: answer?.zeroAuthority === true,
    };
  }
  const successful = envelopes.filter((envelope) => envelope.ok === true);
  return {
    provenance: successful.length > 0 && successful.every((envelope) => envelope.source?.provenance !== "UNKNOWN"),
    omission: successful.length > 0 && successful.every((envelope) => envelope.omission?.explicit === true),
    freshness: successful.length > 0 && successful.every((envelope) => envelope.source?.freshness !== "UNKNOWN"),
    zeroAuthority: successful.length > 0 && successful.every((envelope) =>
      envelope.readOnly?.authority === "zero" && envelope.readOnly?.submission === false &&
      envelope.readOnly?.navigation === false && envelope.readOnly?.click === false),
  };
}

async function runWorker({ route, cwd, model, sourceBytesAccessible, sourceEntriesAccessible }) {
  const prompt = `${await readFile(join(cwd, "README.md"), "utf8")}\nReturn only the requested JSON object.`;
  // Codex's read-only sandbox disables networking, including loopback.  The
  // bounded route needs loopback access to the synthetic companion, so give it
  // a workspace-confined writable sandbox with networking enabled.  Its
  // workspace contains only synthetic task files, and the viewport client
  // independently refuses every non-loopback origin.  The broad control has no
  // network requirement and remains read-only.
  const sandboxArguments = route === "bounded-viewport"
    ? ["--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true"]
    : ["--sandbox", "read-only"];
  const started = Date.now();
  const result = await runProcess("codex", [
    "exec",
    "--ephemeral",
    "--json",
    "--skip-git-repo-check",
    ...sandboxArguments,
    "--ignore-user-config",
    "-c", 'model_reasoning_effort="medium"',
    "--model", model,
    "--cd", cwd,
    "--output-schema", join(cwd, "answer-schema.json"),
    prompt,
  ], { cwd });
  const wallTimeMs = Math.max(0, Date.now() - started);
  const events = parseCodexEvents(result.stdout);
  await writeFile(join(cwd, "codex-events.jsonl"), result.stdout, "utf8");
  await writeFile(join(cwd, "codex-stderr.txt"), result.stderr, "utf8");
  const commands = commandRecords(events);
  const outputs = commands.map((command) => String(command.aggregated_output ?? "")).join("");
  const answer = finalAnswer(events);
  const exposedIds = entryIdsIn(outputs);
  const envelopes = parseViewportEnvelopes(commands);
  const relevant = new Set([
    HELD_OUT_VIEWPORT_GOLD.approvedProfile.clueEntryId,
    HELD_OUT_VIEWPORT_GOLD.approvedProfile.factEntryId,
    HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.clueEntryId,
    HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.factEntryId,
    HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId,
  ]);
  const irrelevantEntries = [...exposedIds].filter((id) => !relevant.has(id)).length;
  const operationCount = (operation) => envelopes.filter((envelope) => envelope.operation === operation).length;
  const objectiveResult = objective(answer);
  const exact = Object.values(objectiveResult).every((criterion) => criterion.exact);
  const retainedSamples = envelopes
    .map((envelope) => envelope.companionUsage)
    .filter((usage) => usage && typeof usage === "object");
  const maximum = (key) => Math.max(0, ...retainedSamples.map((usage) => Number(usage[key]) || 0));
  const final = retainedSamples.at(-1) ?? {};
  const visibility = explicitness(route, answer, envelopes);
  return {
    route,
    worker: {
      workerId: tokenFromUuid(route === "broad-control" ? "worker-control" : "worker-bounded"),
      threadId: threadId(events),
      fresh: true,
    },
    sourceState: "fresh",
    outcome: exact ? "success" : "incorrect",
    objective: objectiveResult,
    metrics: {
      wallTimeMs,
      steps: events.filter((event) => event.type === "item.completed").length,
      toolCalls: commands.length,
      sourceBytesAccessible,
      sourceEntriesAccessible,
      agentVisibleBytes: Buffer.byteLength(prompt) + Buffer.byteLength(outputs),
      uniqueEntriesExposed: exposedIds.size,
      searches: route === "bounded-viewport"
        ? operationCount("search")
        : commands.filter((command) => /\b(?:rg|grep)\b/u.test(command.command ?? "")).length,
      opens: route === "bounded-viewport" ? operationCount("open") : 0,
      expansions: route === "bounded-viewport"
        ? operationCount("page-before") + operationCount("page-after")
        : 0,
      resourceCalls: route === "bounded-viewport" ? operationCount("get-resource") : 0,
      jumpBackCalls: route === "bounded-viewport" ? operationCount("jump-back") : 0,
      irrelevantEntries,
      irrelevantExpansions: route === "bounded-viewport"
        ? envelopes.filter((envelope) => (envelope.operation === "page-before" || envelope.operation === "page-after") &&
          ![...entryIdsIn(JSON.stringify(envelope))].some((id) => relevant.has(id))).length
        : 0,
    },
    retained: {
      maxEntries: route === "bounded-viewport" ? maximum("residentEntryCount") : 0,
      finalEntries: route === "bounded-viewport" ? Number(final.residentEntryCount) || 0 : 0,
      maxBytes: route === "bounded-viewport" ? maximum("residentSerializedBytes") : 0,
      finalBytes: route === "bounded-viewport" ? Number(final.residentSerializedBytes) || 0 : 0,
    },
    plateau: { stable: route === "broad-control", samples: route === "broad-control" ? 2 : 0 },
    explicitness: visibility,
    diagnostics: {
      processExitCode: result.exitCode,
      stderrDigest: sha256(result.stderr),
      eventCount: events.length,
    },
  };
}

function secondHalfNotGreater(samples, key) {
  const midpoint = Math.floor(samples.length / 2);
  const first = samples.slice(0, midpoint).map((sample) => sample[key]);
  const second = samples.slice(midpoint).map((sample) => sample[key]);
  return Math.max(...second) <= Math.max(...first);
}

async function runPlateau(origin) {
  const client = createAgentViewportClient({ origin });
  async function exerciseCycle(recordSample) {
    const approved = await client.execute("search", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      query: HELD_OUT_VIEWPORT_GOLD.approvedProfile.query,
      limit: 3,
    });
    const opened = await client.execute("open", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      anchorEntryId: HELD_OUT_VIEWPORT_GOLD.approvedProfile.clueEntryId,
      before: 0,
      after: 0,
    });
    await client.execute("page-after", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      cursor: opened.envelope.region.cursor,
      limit: 50,
    });
    await client.execute("get-resource", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      entryId: HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId,
      blockIndex: 0,
    });
    const peak = approved.envelope.companionUsage;
    const beforeClose = (await client.execute("status", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
    })).envelope.companionUsage;
    const peakSample = {
      entries: Math.max(peak.residentEntryCount, beforeClose.residentEntryCount),
      bytes: Math.max(peak.residentSerializedBytes, beforeClose.residentSerializedBytes),
    };
    const closed = await client.execute("close", { conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId });
    const closedSample = {
      entries: closed.envelope.companionUsage.residentEntryCount,
      bytes: closed.envelope.companionUsage.residentSerializedBytes,
    };
    if (recordSample) return [peakSample, closedSample];
    return [];
  }
  // Generation-bound cursors include the decimal generation. Warm past the
  // one-to-two-digit transition so serialized-byte plateau evidence measures
  // retained-set growth rather than token-width growth.
  for (let warmup = 0; warmup < 16; warmup += 1) await exerciseCycle(false);
  const samples = [];
  for (let cycle = 0; cycle < 16; cycle += 1) {
    samples.push(...await exerciseCycle(true));
  }
  return {
    stable: secondHalfNotGreater(samples, "entries") && secondHalfNotGreater(samples, "bytes") &&
      samples.at(-1)?.entries === 0 && samples.at(-1)?.bytes === 0,
    samples,
  };
}

async function negativeTrial(scenarioId, operation) {
  const server = await createLoopbackServer({
    host: "127.0.0.1",
    scenarioIds: [scenarioId],
    sessionToken: `negative-${scenarioId}`,
  });
  await server.start();
  try {
    const client = createAgentViewportClient({ origin: server.origin() });
    const status = await client.execute("status", { conversationId: scenarioId });
    const attempted = await client.execute(operation, {
      conversationId: scenarioId,
      query: "synthetic-negative-probe",
      limit: 1,
    });
    return {
      scenario: scenarioId,
      statusFreshness: status.envelope.source.freshness,
      queryOk: attempted.envelope.ok,
      queryFreshness: attempted.envelope.source.freshness,
      queryProvenance: attempted.envelope.source.provenance === "UNKNOWN" ? "UNKNOWN" : "validated",
      contentEntriesReturned: attempted.envelope.region?.entries?.length ?? attempted.envelope.result?.results?.length ?? 0,
    };
  } finally {
    await server.stop();
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write("Usage: node scripts/run-agent-viewport-dogfood.mjs [--model TOKEN] [--output PATH] [--keep-scratch]\n");
    return;
  }
  const scratch = await mkdtemp(join(tmpdir(), "elatura-agent-viewport-"));
  const representation = buildHeldOutViewportRepresentation();
  const server = await createLoopbackServer({
    host: "127.0.0.1",
    scenarioIds: [HELD_OUT_VIEWPORT_GOLD.conversationId],
    sessionToken: "agent-viewport-dogfood",
  });
  await server.start();
  try {
    const broadRoot = join(scratch, "broad-control");
    const boundedRoot = join(scratch, "bounded-viewport");
    const broad = await prepareBroadWorkspace(broadRoot, representation);
    await prepareBoundedWorkspace(boundedRoot, server.origin());
    const [control, bounded] = await Promise.all([
      runWorker({
        route: "broad-control",
        cwd: broadRoot,
        model: parsed.model,
        sourceBytesAccessible: broad.sourceBytes,
        sourceEntriesAccessible: representation.entries.length,
      }),
      runWorker({
        route: "bounded-viewport",
        cwd: boundedRoot,
        model: parsed.model,
        sourceBytesAccessible: 0,
        sourceEntriesAccessible: 0,
      }),
    ]);
    const plateau = await runPlateau(server.origin());
    bounded.plateau = { stable: plateau.stable, samples: plateau.samples.length };
    bounded.retained.maxEntries = Math.max(
      bounded.retained.maxEntries,
      ...plateau.samples.map((sample) => sample.entries),
    );
    bounded.retained.maxBytes = Math.max(
      bounded.retained.maxBytes,
      ...plateau.samples.map((sample) => sample.bytes),
    );
    bounded.retained.finalEntries = plateau.samples.at(-1)?.entries ?? 0;
    bounded.retained.finalBytes = plateau.samples.at(-1)?.bytes ?? 0;
    delete control.diagnostics;
    delete bounded.diagnostics;
    const result = {
      schemaVersion: 1,
      kind: "agent-viewport-benchmark",
      experimentId: "held-out-viewport-v1",
      generatedAt: canonicalTimestamp(),
      scenario: { id: HELD_OUT_VIEWPORT_GOLD.conversationId, entries: representation.entries.length },
      privacy: {
        responseBodiesCaptured: false,
        messageTextCaptured: false,
        queryStringsCaptured: false,
        rawIdentifiersCaptured: false,
        credentialsCaptured: false,
        remoteTranscriptStored: false,
        automaticSubmission: false,
        navigationAuthority: false,
        clickAuthority: false,
      },
      routes: [control, bounded],
    };
    const validated = parseAgentViewportBenchmarkResult(result);
    const grade = gradeAgentViewportBenchmark(validated);
    const negativeTrials = {
      stale: await negativeTrial("stale-source", "search"),
      drifted: await negativeTrial("drifted-source", "search"),
    };
    const report = { result: validated, grade, negativeTrials };
    await mkdir(dirname(parsed.output), { recursive: true });
    await writeFile(parsed.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const outputStat = await stat(parsed.output);
    process.stdout.write(`${JSON.stringify({
      output: parsed.output,
      outputBytes: outputStat.size,
      controlCorrect: control.outcome === "success",
      boundedCorrect: bounded.outcome === "success",
      controlVisibleBytes: control.metrics.agentVisibleBytes,
      boundedVisibleBytes: bounded.metrics.agentVisibleBytes,
      boundedEntriesExposed: bounded.metrics.uniqueEntriesExposed,
      boundedExpansions: bounded.metrics.expansions,
      plateauStable: plateau.stable,
      staleExplicit: negativeTrials.stale.statusFreshness === "stale",
      driftedRefused: negativeTrials.drifted.queryOk === false,
      scratch: parsed.keepScratch ? scratch : null,
    })}\n`);
  } finally {
    await server.stop();
    if (!parsed.keepScratch) await rm(scratch, { recursive: true, force: true });
  }
}

await main();
