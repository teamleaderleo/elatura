// SPDX-License-Identifier: MPL-2.0
/**
 * Validate issue #116 application-lane run manifests. Output is deliberately
 * limited to fixed classes and aggregate counts; lane keys, target tokens,
 * paths, browser-native ids, and application content are never printed.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseApplicationLaneRunManifest } from "../benchmarks/dist/application-lane-manifest.js";

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
    const manifest = parseApplicationLaneRunManifest(JSON.parse(text));
    process.stdout.write(
      `pass application=${manifest.lane.applicationClass} ` +
      `browser=${manifest.environment.browserClass} ` +
      `cohort=${manifest.environment.cohort} ` +
      `intervention=${manifest.environment.interventionLevel} ` +
      `samples=${manifest.resources.samples.length} ` +
      `episodes=${manifest.attention.episodes} ` +
      `privacy=content-free\n`,
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
      "Usage: npm run benchmark:application-lane -- <manifest.json> [more.json…]",
      "",
      "Inputs must satisfy benchmark-application-lane-run-v1.",
      "The validator never prints lane keys, target tokens, URLs, native browser ids,",
      "credentials, page content, or screenshot bytes.",
      "",
    ].join("\n"),
  );
  process.exitCode = 0;
} else {
  const results = await Promise.all(argv.map(checkOne));
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
