// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "extension/firefox/dist");
const OUTPUT = join(ROOT, "artifacts/firefox-release");
const FIXED_TIME = new Date("2000-01-01T00:00:00.000Z");
const CHANNELS = new Set(["listed", "unlisted"]);
const LEGACY_CREDENTIAL_NAMES = ["AMO_JWT_ISSUER", "AMO_JWT_SECRET"];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function fileMetadata(path) {
  const content = await readFile(path);
  return { bytes: content.byteLength, sha256: sha256(content) };
}

function parseChannel(argv) {
  let channel = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--smoke") continue;
    if (argument?.startsWith("--channel=")) {
      channel = argument.slice("--channel=".length);
      continue;
    }
    if (argument === "--channel") {
      channel = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported release-candidate argument: ${argument}`);
  }
  if (!channel || !CHANNELS.has(channel)) {
    throw new Error("Pass exactly one explicit --channel=listed or --channel=unlisted intent.");
  }
  return channel;
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function requireCleanTrackedWorktree() {
  const changes = git(["status", "--porcelain", "--untracked-files=no"]).trim();
  if (changes.length > 0) {
    throw new Error("Release candidates require a clean tracked Git worktree.");
  }
}

function rejectSigningCredentials(policy) {
  const configured = [
    ...(policy.credentials?.requiredNames ?? []),
    ...LEGACY_CREDENTIAL_NAMES,
  ].filter((name) => typeof process.env[name] === "string" && process.env[name].length > 0);
  if (configured.length > 0) {
    throw new Error(
      `Unsigned candidate generation refuses signing credentials: ${configured.sort().join(", ")}.`,
    );
  }
}

async function walk(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = [];
  const directories = [directory];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(path);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return { files, directories };
}

async function normalizeDistTimestamps() {
  const tree = await walk(DIST);
  for (const file of tree.files) await utimes(file, FIXED_TIME, FIXED_TIME);
  for (const directory of [...tree.directories].reverse()) {
    await utimes(directory, FIXED_TIME, FIXED_TIME);
  }
}

async function digestDirectory(directory) {
  const tree = await walk(directory);
  const entries = [];
  for (const absolutePath of tree.files) {
    const content = await readFile(absolutePath);
    entries.push({
      path: relative(directory, absolutePath).replaceAll("\\", "/"),
      bytes: content.byteLength,
      sha256: sha256(content),
    });
  }
  const canonical = entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join("");
  return { digest: sha256(canonical), entries };
}

function runWebExtBuild(artifactsDirectory, filename) {
  const webExt = join(ROOT, "node_modules/web-ext/bin/web-ext.js");
  execFileSync(
    process.execPath,
    [
      webExt,
      "build",
      "--source-dir",
      DIST,
      "--artifacts-dir",
      artifactsDirectory,
      "--filename",
      filename,
      "--overwrite-dest",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
}

async function buildUnsignedTwice(filename) {
  const firstDirectory = join(OUTPUT, ".unsigned-a");
  const secondDirectory = join(OUTPUT, ".unsigned-b");
  await Promise.all([
    rm(firstDirectory, { recursive: true, force: true }),
    rm(secondDirectory, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(firstDirectory, { recursive: true }),
    mkdir(secondDirectory, { recursive: true }),
  ]);

  runWebExtBuild(firstDirectory, filename);
  runWebExtBuild(secondDirectory, filename);

  const firstPath = join(firstDirectory, filename);
  const secondPath = join(secondDirectory, filename);
  const [first, second] = await Promise.all([readFile(firstPath), readFile(secondPath)]);
  const firstHash = sha256(first);
  const secondHash = sha256(second);
  if (firstHash !== secondHash || !first.equals(second)) {
    throw new Error("Unsigned Firefox package is not reproducible across two normalized builds.");
  }

  const finalPath = join(OUTPUT, filename);
  await rm(finalPath, { force: true });
  await rename(firstPath, finalPath);
  await Promise.all([
    rm(firstDirectory, { recursive: true, force: true }),
    rm(secondDirectory, { recursive: true, force: true }),
  ]);
  return finalPath;
}

function createSourceArchive(revision, shortRevision) {
  const filename = `elatura-source-${shortRevision}.zip`;
  const output = join(OUTPUT, filename);
  git([
    "archive",
    "--format=zip",
    `--prefix=elatura-source-${shortRevision}/`,
    `--output=${output}`,
    revision,
  ]);
  return output;
}

const channel = parseChannel(process.argv.slice(2));
requireCleanTrackedWorktree();

const policyPath = join(ROOT, "release/firefox-release-policy.json");
const metadataPath = join(ROOT, "release/amo-metadata.json");
const buildManifestPath = join(ROOT, "artifacts/build-manifest.json");
const [policyBytes, metadataBytes, buildManifestBytes] = await Promise.all([
  readFile(policyPath),
  readFile(metadataPath),
  readFile(buildManifestPath),
]);
const policy = JSON.parse(policyBytes.toString("utf8"));
const buildManifest = JSON.parse(buildManifestBytes.toString("utf8"));
rejectSigningCredentials(policy);

const revision = buildManifest.revision;
if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision)) {
  throw new Error("Build manifest revision must be a full Git commit SHA.");
}
git(["cat-file", "-e", `${revision}^{commit}`]);
const checkedOutRevision = git(["rev-parse", "HEAD"]).trim();
if (checkedOutRevision !== revision) {
  throw new Error("Build manifest revision must match the checked-out source revision.");
}

const extensionManifestPath = join(DIST, "manifest.json");
const extensionManifest = JSON.parse(await readFile(extensionManifestPath, "utf8"));
const addonId = extensionManifest.browser_specific_settings?.gecko?.id;
if (addonId !== policy.addonId) {
  throw new Error("Release policy add-on id does not match the built extension manifest.");
}
if (typeof extensionManifest.version !== "string" || extensionManifest.version.length === 0) {
  throw new Error("Built extension manifest must contain a version.");
}

await mkdir(OUTPUT, { recursive: true });
await normalizeDistTimestamps();
const dist = await digestDirectory(DIST);
if (dist.digest !== buildManifest.extensionSha256) {
  throw new Error("Built extension digest does not match artifacts/build-manifest.json.");
}

const shortRevision = revision.slice(0, 12);
const unsignedFilename = `elatura-observer-${extensionManifest.version}-${shortRevision}-unsigned.zip`;
const unsignedPath = await buildUnsignedTwice(unsignedFilename);
const sourcePath = createSourceArchive(revision, shortRevision);

const [unsigned, source, build, releasePolicy, amoMetadata] = await Promise.all([
  fileMetadata(unsignedPath),
  fileMetadata(sourcePath),
  fileMetadata(buildManifestPath),
  fileMetadata(policyPath),
  fileMetadata(metadataPath),
]);

const candidate = {
  schemaVersion: policy.candidate?.schemaVersion,
  kind: policy.candidate?.kind,
  revision,
  requestedFutureAmoChannel: channel,
  extension: {
    id: addonId,
    version: extensionManifest.version,
    builtDirectorySha256: dist.digest,
  },
  distribution: {
    mozillaSigned: false,
    installableClaimAllowed: false,
    publicDistributionAllowed: false,
    label: "unsigned-review-only",
  },
  unsignedPackage: {
    path: relative(ROOT, unsignedPath).replaceAll("\\", "/"),
    ...unsigned,
  },
  sourceArchive: {
    path: relative(ROOT, sourcePath).replaceAll("\\", "/"),
    ...source,
  },
  buildManifest: {
    path: relative(ROOT, buildManifestPath).replaceAll("\\", "/"),
    ...build,
  },
  releasePolicy: {
    path: relative(ROOT, policyPath).replaceAll("\\", "/"),
    ...releasePolicy,
  },
  amoMetadata: {
    path: relative(ROOT, metadataPath).replaceAll("\\", "/"),
    ...amoMetadata,
  },
  gates: {
    cleanTrackedWorktree: true,
    deterministicUnsignedBuild: true,
    signingCredentialsAbsent: true,
    sourceArchiveRequired: policy.sourceReview?.required === true,
    transformCapabilityEnabled: false,
  },
};

if (
  candidate.schemaVersion !== 1 ||
  candidate.kind !== "unsigned-firefox-release-candidate" ||
  candidate.distribution.mozillaSigned !== false ||
  candidate.distribution.installableClaimAllowed !== false
) {
  throw new Error("Release policy does not permit an unsigned review candidate.");
}

const candidatePath = join(OUTPUT, "release-candidate.json");
await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
const reread = JSON.parse(await readFile(candidatePath, "utf8"));
if (JSON.stringify(reread) !== JSON.stringify(candidate)) {
  throw new Error("Release-candidate manifest did not round-trip deterministically.");
}

const candidateMetadata = await fileMetadata(candidatePath);
process.stdout.write(
  `${relative(ROOT, candidatePath)} ${candidateMetadata.sha256} (${channel}, unsigned review only)\n`,
);
