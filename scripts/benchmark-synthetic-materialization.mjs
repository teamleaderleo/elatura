// SPDX-License-Identifier: MPL-2.0
import { generateSyntheticConversation } from "../packages/fixtures/dist/index.js";
import { runSyntheticChatGptPipeline } from "../packages/adapter-chatgpt/dist/synthetic.js";

function integer(value, name, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}.`);
  }
  return parsed;
}

const options = {
  turns: 2_000,
  branchEvery: 20,
  payloadBytes: 256,
  maxGroups: 24,
  iterations: 5,
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  const next = () => {
    const value = args[++index];
    if (value === undefined) throw new Error(`${flag} requires a value.`);
    return value;
  };
  switch (flag) {
    case "--turns": options.turns = integer(next(), flag, 1); break;
    case "--branches-every": options.branchEvery = integer(next(), flag); break;
    case "--payload-bytes": options.payloadBytes = integer(next(), flag); break;
    case "--max-groups": options.maxGroups = integer(next(), flag, 1); break;
    case "--iterations": options.iterations = integer(next(), flag, 1); break;
    default: throw new Error(`Unknown argument: ${flag}`);
  }
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
  return { min: sorted[0] ?? 0, median, max: sorted.at(-1) ?? 0 };
}

const fixture = generateSyntheticConversation({
  turnGroups: options.turns,
  branchEvery: options.branchEvery,
  payloadBytesPerMessage: options.payloadBytes,
  seed: 1,
});
const budgets = {
  maxElapsedMs: 60_000,
  maxInputBytes: 1024 * 1024 * 1024,
  maxNodes: 2_000_000,
  maxRecursionDepth: 128,
  maxOperations: 20_000_000,
  maxAllocatedBytes: 1024 * 1024 * 1024,
};

const durationsMs = [];
const heapDeltas = [];
let selectedNodeCount = 0;
let omittedNodeCount = 0;
let allocatedBytes = 0;
let operations = 0;

for (let iteration = 0; iteration < options.iterations; iteration += 1) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = runSyntheticChatGptPipeline(
    fixture,
    { maxGroups: options.maxGroups },
    { budgets },
  );
  const elapsed = performance.now() - startedAt;
  const heapAfter = process.memoryUsage().heapUsed;
  if (result.kind !== "transformed") {
    throw new Error(`Synthetic benchmark passed through: ${result.outcome.reasonCode}`);
  }
  durationsMs.push(elapsed);
  heapDeltas.push(Math.max(0, heapAfter - heapBefore));
  selectedNodeCount = result.output.elatura_snapshot.selectedNodeCount;
  omittedNodeCount = result.output.elatura_snapshot.omittedNodeCount;
  allocatedBytes = result.diagnostic.budget.usage.allocatedBytes;
  operations = result.diagnostic.budget.usage.operations;
}

const report = {
  schemaVersion: 1,
  synthetic: true,
  fixture: {
    turnGroups: options.turns,
    branchEvery: options.branchEvery,
    payloadBytesPerMessage: options.payloadBytes,
    inputNodeCount: Object.keys(fixture.mapping).length,
  },
  policy: { maxGroups: options.maxGroups },
  iterations: options.iterations,
  output: { selectedNodeCount, omittedNodeCount },
  pipelineUsage: { allocatedBytes, operations },
  durationMs: distribution(durationsMs),
  heapDeltaBytes: distribution(heapDeltas),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
