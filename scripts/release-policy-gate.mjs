// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function workflowText() {
  const directory = join(ROOT, ".github/workflows");
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !new Set([".yml", ".yaml"]).has(extname(entry.name))) continue;
    chunks.push(await readFile(join(directory, entry.name), "utf8"));
  }
  return chunks.join("\n");
}

const [policy, extensionManifest, amoMetadata, packageJson, candidateScript, workflows] = await Promise.all([
  readJson(join(ROOT, "release/firefox-release-policy.json")),
  readJson(join(ROOT, "extension/firefox/static/manifest.json")),
  readJson(join(ROOT, "release/amo-metadata.json")),
  readJson(join(ROOT, "package.json")),
  readFile(join(ROOT, "scripts/create-firefox-release-candidate.mjs"), "utf8"),
  workflowText(),
]);

assert.equal(policy.schemaVersion, 1);
assert.equal(policy.defaultDistribution, "none");
assert.equal(policy.addonId, extensionManifest.browser_specific_settings?.gecko?.id);
assert.deepEqual(policy.channels.development, {
  artifact: "temporary-extension",
  mozillaSigningRequired: false,
  distribution: "none",
});
assert.deepEqual(policy.channels.reviewCandidate, {
  artifact: "unsigned-zip",
  mozillaSigningRequired: false,
  distribution: "none",
});
for (const [name, expectedChannel, expectedDistribution] of [
  ["unlistedAlpha", "unlisted", "limited-self-distribution"],
  ["listedProduction", "listed", "addons-mozilla-org"],
]) {
  const channel = policy.channels[name];
  assert.equal(channel.artifact, "mozilla-signed-xpi");
  assert.equal(channel.mozillaSigningRequired, true);
  assert.equal(channel.webExtChannel, expectedChannel);
  assert.equal(channel.distribution, expectedDistribution);
  assert.deepEqual(channel.requiresIssuesComplete, [3, 4]);
}

for (const field of [
  "allowedInRepository",
  "allowedInPullRequestCi",
  "allowedInOrdinaryBuildJobs",
  "allowedInLogs",
  "allowedInArtifacts",
]) {
  assert.equal(policy.credentials[field], false, `Release credential policy drifted: ${field}`);
}
assert.deepEqual(policy.credentials.requiredNames, ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"]);
assert.equal(policy.sourceReview.required, true);
assert.equal(policy.sourceReview.archiveKind, "human-readable-source");
assert.equal(policy.sourceReview.buildInstructions, "docs/amo-build-instructions.md");
assert.equal(policy.candidate.schemaVersion, 2);
assert.equal(policy.candidate.kind, "unsigned-firefox-release-candidate");
assert.equal(policy.candidate.installableClaimAllowed, false);
assert.equal(policy.candidate.signedClaimAllowed, false);
assert.equal(policy.candidate.deterministicBuildCheckRequired, true);
assert.equal(policy.candidate.adapterCompatibilityRegistryRequired, true);

assert.equal(amoMetadata.version?.license, "MPL-2.0");
assert.equal(typeof amoMetadata.summary?.["en-US"], "string");
assert.match(amoMetadata.version?.approval_notes ?? "", /observe-only/iu);
assert.match(amoMetadata.version?.approval_notes ?? "", /build instructions/iu);

const scripts = Object.entries(packageJson.scripts ?? {});
const packageAutomation = scripts.map(([name, value]) => `${name}: ${value}`).join("\n");
for (const forbidden of [
  /\bweb-ext\s+sign\b/iu,
  /\bweb-ext\s+submit\b/iu,
  /\bnpm\s+publish\b/iu,
  /\bWEB_EXT_API_(?:KEY|SECRET)\b/u,
  /\bAMO_JWT_(?:ISSUER|SECRET)\b/u,
]) {
  assert.doesNotMatch(
    `${packageAutomation}\n${workflows}`,
    forbidden,
    "Ordinary scripts and pull-request workflows must not sign, publish, or receive release credentials.",
  );
}
assert.doesNotMatch(
  workflows,
  /(?:^|\n)\s*(?:permissions:\s*write-all|[A-Za-z][A-Za-z-]*:\s*write)\b/iu,
  "Ordinary pull-request workflows must remain completely read-only.",
);
assert.doesNotMatch(
  workflows,
  /\$\{\{\s*secrets\./u,
  "Ordinary pull-request workflows must not receive repository or environment secrets.",
);

assert.match(packageJson.scripts?.["release:candidate:unsigned"] ?? "", /create-firefox-release-candidate/u);
assert.match(packageJson.scripts?.["release:candidate:smoke"] ?? "", /--channel=unlisted/u);
assert.match(candidateScript, /deterministicUnsignedBuild:\s*true/u);
assert.match(candidateScript, /adapterCompatibilityRegistry/u);
assert.match(candidateScript, /adapterCompatibilityRegistryVerified/u);
assert.match(candidateScript, /mozillaSigned:\s*false/u);
assert.match(candidateScript, /signedClaimAllowed:\s*false/u);
assert.match(candidateScript, /installableClaimAllowed:\s*false/u);
assert.match(candidateScript, /git[\s\S]*archive/u);
assert.match(candidateScript, /buildUnsignedTwice/u);
assert.doesNotMatch(candidateScript, /["'`]sign["'`]/u);
assert.doesNotMatch(candidateScript, /https?:\/\//u);

process.stdout.write(
  "Firefox release policy gate passed: unsigned candidates only, deterministic source/package/adapter evidence, and no signing credentials or publishing path in ordinary CI.\n",
);
