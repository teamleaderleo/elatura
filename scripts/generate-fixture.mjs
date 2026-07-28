// SPDX-License-Identifier: MPL-2.0
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateSyntheticConversation } from "../packages/fixtures/dist/index.js";

function usage() {
  console.error(`Usage: npm run generate:fixture -- [options]\n\nOptions:\n  --turns <n>             turn groups (default: 100)\n  --branches-every <n>    add an alternate branch every n turns (default: 0)\n  --hidden-per-turn <n>   hidden/tool-like nodes per turn (default: 0)\n  --payload-bytes <n>     bytes in each user/assistant message (default: 256)\n  --seed <n>              deterministic unsigned 32-bit seed (default: 1)\n  --no-unknown-fields     omit forward-compatibility fields\n  --out <path>            write JSON to a file instead of stdout\n`);
}

function integer(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} requires an integer.`);
  return parsed;
}

const options = {};
let outputPath = null;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  const next = () => {
    const value = args[++index];
    if (value === undefined) throw new Error(`${argument} requires a value.`);
    return value;
  };
  switch (argument) {
    case "--turns":
      options.turnGroups = integer(next(), argument);
      break;
    case "--branches-every":
      options.branchEvery = integer(next(), argument);
      break;
    case "--hidden-per-turn":
      options.hiddenNodesPerTurn = integer(next(), argument);
      break;
    case "--payload-bytes":
      options.payloadBytesPerMessage = integer(next(), argument);
      break;
    case "--seed":
      options.seed = integer(next(), argument);
      break;
    case "--no-unknown-fields":
      options.includeUnknownFields = false;
      break;
    case "--out":
      outputPath = next();
      break;
    case "--help":
    case "-h":
      usage();
      process.exit(0);
    default:
      throw new Error(`Unknown argument: ${argument}`);
  }
}

try {
  const json = `${JSON.stringify(generateSyntheticConversation(options), null, 2)}\n`;
  if (outputPath) {
    const resolved = resolve(outputPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, json, "utf8");
  } else process.stdout.write(json);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
