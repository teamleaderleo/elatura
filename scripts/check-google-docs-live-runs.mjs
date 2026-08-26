// SPDX-License-Identifier: MPL-2.0
/**
 * Validates content-free Google Docs live-workload manifests for #118.
 *
 * This command checks admission/coherence only. Fidelity failures and high
 * memory values remain valid evidence and must be analyzed as observed results.
 * Failure output uses fixed tokens and never echoes manifest contents.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGoogleDocsLiveRunManifest } from "../benchmarks/dist/google-docs-live-manifest.js";

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
    const manifest = parseGoogleDocsLiveRunManifest(JSON.parse(text));
    process.stdout.write(
      `pass workload=${manifest.workload} variant=${manifest.variant} ` +
      `requested=${manifest.requestedDocumentCount} privacy=content-free\n`,
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
      "Usage: npm run benchmark:google-docs-live -- <manifest.json> [more.json…]",
      "",
      "Every input must satisfy benchmark-google-docs-live-run-v1 and its",
      "content-free run-plan coherence checks. Observed fidelity failures remain",
      "valid benchmark evidence and do not make the manifest schema-invalid.",
      "",
    ].join("\n"),
  );
  process.exitCode = 0;
} else {
  const results = await Promise.all(argv.map(checkOne));
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
