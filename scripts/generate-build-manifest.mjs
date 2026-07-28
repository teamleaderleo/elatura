// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

async function adapterVersions() {
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

const lockBytes = await readFile(join(ROOT, "package-lock.json"));
const capabilityBytes = await readFile(join(ROOT, "security/capabilities.json"));
const extensionManifest = JSON.parse(await readFile(join(ROOT, "extension/firefox/dist/manifest.json"), "utf8"));
const extension = await digestDirectory(join(ROOT, "extension/firefox/dist"));

const manifest = {
  schemaVersion: 1,
  revision: sourceRevision(),
  dependencyLockSha256: sha256(lockBytes),
  capabilityPolicySha256: sha256(capabilityBytes),
  extensionSha256: extension.digest,
  extensionFiles: extension.files,
  requestedPermissions: [...(extensionManifest.permissions ?? [])].sort(),
  requestedHostPermissions: [...(extensionManifest.host_permissions ?? [])].sort(),
  adapterVersions: await adapterVersions(),
};

const outputPath = join(ROOT, "artifacts/build-manifest.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${relative(ROOT, outputPath)} ${sha256(await readFile(outputPath))}\n`);
