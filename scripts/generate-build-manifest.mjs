// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u;
const EXPECTED_IDENTITY_NAMES = ["inspection", "synthetic-transform"];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function digestDirectory(directory) {
  const files = (await walk(directory)).sort();
  const entries = [];
  for (const absolutePath of files) {
    const content = await readFile(absolutePath);
    entries.push({
      path: relative(directory, absolutePath).replaceAll("\\", "/"),
      bytes: content.byteLength,
      sha256: sha256(content),
    });
  }
  const canonical = entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join("");
  return { digest: sha256(canonical), files: entries };
}

function sourceRevision() {
  const candidate = process.env.ELATURA_REVISION ?? process.env.GITHUB_SHA;
  const revision = candidate ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("Build revision must be a full 40-character Git commit SHA.");
  return revision;
}

async function adapterPackageVersions() {
  const packageRoot = join(ROOT, "packages");
  const directories = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("adapter-"))
    .map((entry) => entry.name)
    .sort();
  const versions = {};
  for (const directory of directories) {
    const packageJson = JSON.parse(await readFile(join(packageRoot, directory, "package.json"), "utf8"));
    versions[packageJson.name ?? directory] = packageJson.version;
  }
  return versions;
}

function exactKeys(value, allowed, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) {
    throw new Error(`${path} fields do not match the compatibility registry contract.`);
  }
}

function parseCompatibilityRegistry(input) {
  exactKeys(input, ["schemaVersion", "identities"], "$registry");
  if (input.schemaVersion !== 1 || !Array.isArray(input.identities)) {
    throw new Error("Adapter compatibility registry schema is unsupported.");
  }
  if (input.identities.length !== EXPECTED_IDENTITY_NAMES.length) {
    throw new Error("Adapter compatibility registry must contain every expected identity exactly once.");
  }
  const names = new Set();
  const pairs = new Set();
  const entries = input.identities.map((entry, index) => {
    exactKeys(entry, ["name", "id", "version"], `$registry.identities[${index}]`);
    if (typeof entry.name !== "string" || !EXPECTED_IDENTITY_NAMES.includes(entry.name)) {
      throw new Error("Adapter compatibility identity name is unsupported.");
    }
    if (typeof entry.id !== "string" || !TOKEN.test(entry.id)) {
      throw new Error("Adapter compatibility id must be a bounded local token.");
    }
    if (typeof entry.version !== "string" || !VERSION.test(entry.version)) {
      throw new Error("Adapter compatibility version must be a bounded local token.");
    }
    const pair = `${entry.id}\0${entry.version}`;
    if (names.has(entry.name) || pairs.has(pair)) {
      throw new Error("Adapter compatibility registry identities must be unique.");
    }
    names.add(entry.name);
    pairs.add(pair);
    return { name: entry.name, id: entry.id, version: entry.version };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (EXPECTED_IDENTITY_NAMES.some((name) => !names.has(name))) {
    throw new Error("Adapter compatibility registry is incomplete.");
  }
  return entries;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function adapterCompatibilityProvenance() {
  const registryPath = join(ROOT, "packages/adapter-chatgpt/src/compatibility-identities.json");
  const registryBytes = await readFile(registryPath);
  const entries = parseCompatibilityRegistry(JSON.parse(registryBytes.toString("utf8")));
  const canonicalBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, identities: entries })}\n`, "utf8");

  const [identityModule, contractsModule, syntheticModule] = await Promise.all([
    import(pathToFileURL(join(ROOT, "packages/adapter-chatgpt/dist/identities.js")).href),
    import(pathToFileURL(join(ROOT, "packages/adapter-chatgpt/dist/contracts.js")).href),
    import(pathToFileURL(join(ROOT, "packages/adapter-chatgpt/dist/synthetic.js")).href),
  ]);
  const exportedEntries = identityModule.ADAPTER_COMPATIBILITY_IDENTITIES?.map((entry) => ({
    name: entry.name,
    id: entry.id,
    version: entry.version,
  }));
  if (!sameJson(exportedEntries, entries)) {
    throw new Error("Compiled adapter compatibility identities differ from the source registry.");
  }

  const inspection = entries.find((entry) => entry.name === "inspection");
  const synthetic = entries.find((entry) => entry.name === "synthetic-transform");
  const syntheticAdapter = syntheticModule.createSyntheticChatGptPipelineAdapter();
  if (
    !inspection ||
    contractsModule.chatGptAdapter?.id !== inspection.id ||
    contractsModule.chatGptAdapter?.version !== inspection.version ||
    contractsModule.chatGptAdapterVersionPolicy?.adapterId !== inspection.id ||
    contractsModule.chatGptAdapterVersionPolicy?.currentVersion !== inspection.version
  ) {
    throw new Error("Inspection adapter exports differ from the compatibility registry.");
  }
  if (
    !synthetic ||
    syntheticAdapter.id !== synthetic.id ||
    syntheticAdapter.version !== synthetic.version ||
    syntheticModule.SYNTHETIC_CHATGPT_ADAPTER_ID !== synthetic.id ||
    syntheticModule.SYNTHETIC_CHATGPT_ADAPTER_VERSION !== synthetic.version
  ) {
    throw new Error("Synthetic adapter exports differ from the compatibility registry.");
  }

  return {
    schemaVersion: 1,
    sha256: sha256(canonicalBytes),
    identities: entries,
  };
}

const lockBytes = await readFile(join(ROOT, "package-lock.json"));
const capabilityBytes = await readFile(join(ROOT, "security/capabilities.json"));
const extensionManifest = JSON.parse(await readFile(join(ROOT, "extension/firefox/dist/manifest.json"), "utf8"));
const extension = await digestDirectory(join(ROOT, "extension/firefox/dist"));
const compatibility = await adapterCompatibilityProvenance();

const manifest = {
  schemaVersion: 3,
  revision: sourceRevision(),
  dependencyLockSha256: sha256(lockBytes),
  capabilityPolicySha256: sha256(capabilityBytes),
  extensionSha256: extension.digest,
  extensionFiles: extension.files,
  requestedPermissions: [...(extensionManifest.permissions ?? [])].sort(),
  requestedHostPermissions: [...(extensionManifest.host_permissions ?? [])].sort(),
  adapterPackageVersions: await adapterPackageVersions(),
  adapterCompatibilityRegistry: compatibility,
};

const outputPath = join(ROOT, "artifacts/build-manifest.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${relative(ROOT, outputPath)} ${sha256(await readFile(outputPath))}\n`);
