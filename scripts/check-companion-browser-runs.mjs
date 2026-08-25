// SPDX-License-Identifier: MPL-2.0
/**
 * Validates content-free synthetic companion browser run manifests against the
 * fixed schema-v1 contract and evaluates both plateau probes. Exits non-zero
 * when any manifest fails parsing or the bounded-plateau rule. Failure output
 * uses fixed tokens only; manifest values are never echoed.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCompanionBrowserPlateau,
  parseCompanionBrowserRunManifest,
} from "../benchmarks/dist/companion-browser-manifest.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveInputPath(value) {
  if (!value.endsWith(".json")) throw new TypeError("not-a-json-path");
  // Operators record manifests in scratch space outside the repository;
  // absolute paths are allowed and never echoed back with their contents.
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
    const manifest = parseCompanionBrowserRunManifest(JSON.parse(text));
    const verdict = evaluateCompanionBrowserPlateau(manifest);
    if (!verdict.ok) {
      const failures = verdict.failures
        .map((failure) => `${failure.code}:${failure.probe}:${failure.field}`)
        .join(",");
      process.stderr.write(`fail plateau ${failures}\n`);
      return false;
    }
    process.stdout.write(
      `pass fixture=${manifest.fixture.id} platform=${manifest.environment.platformClass} ` +
      `browser=${manifest.environment.browserClass} privacy=content-free\n`,
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
      "Usage: npm run benchmark:companion-browser -- <manifest.json> [more.json…]",
      "",
      "Every input must satisfy benchmark-companion-browser-run-v1 and reach a",
      "bounded plateau on both the switch probe and the open/close probe.",
      "",
    ].join("\n"),
  );
  process.exitCode = 0;
} else {
  const results = await Promise.all(argv.map(checkOne));
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
