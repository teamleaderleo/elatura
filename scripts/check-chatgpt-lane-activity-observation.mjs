// SPDX-License-Identifier: MPL-2.0
/**
 * Validates content-free ChatGPT live activity diagnostics for #116.
 *
 * This command performs admission only. It never turns an observation into
 * lifecycle authority and never echoes lane references or application data.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChatGptLaneActivityObservationV1 } from "@elatura/adapter-chatgpt/lane-activity";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveInputPath(value) {
  if (!value.endsWith(".json")) throw new TypeError("not-a-json-path");
  if (isAbsolute(value)) return value;
  const absolute = resolve(REPO_ROOT, value);
  if (!absolute.startsWith(`${REPO_ROOT}/`)) {
    throw new TypeError("path-escapes-repository");
  }
  return absolute;
}

async function checkOne(argument) {
  let path;
  try {
    path = resolveInputPath(argument);
  } catch (error) {
    process.stderr.write(`refuse ${error.message}\n`);
    return false;
  }

  try {
    const text = await readFile(path, "utf8");
    const observation = parseChatGptLaneActivityObservationV1(JSON.parse(text));
    process.stdout.write(
      `pass source=${observation.source} confidence=${observation.confidence} privacy=content-free\n`,
    );
    return true;
  } catch (error) {
    const token =
      error instanceof SyntaxError || error instanceof TypeError
        ? "schema-invalid"
        : "read-refused";
    process.stderr.write(`fail ${token}\n`);
    return false;
  }
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help")) {
  process.stdout.write(
    [
      "Usage: npm run benchmark:chatgpt-activity -- <diagnostic.json> [more.json…]",
      "",
      "Every input must satisfy the exact @elatura/adapter-chatgpt/lane-activity",
      "observation contract. Validation grants zero lifecycle, work, or dispatch authority.",
      "Keep these diagnostics outside live-lane resource-stage final/ directories.",
      "",
    ].join("\n"),
  );
  process.exitCode = 0;
} else {
  const results = await Promise.all(argv.map(checkOne));
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
