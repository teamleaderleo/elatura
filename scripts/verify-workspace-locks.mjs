// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRepositoryPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) return null;
  if (posix.isAbsolute(value)) return null;
  const normalized = posix.normalize(value).replace(/^\.\//u, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function filesystemPath(root, repositoryPath) {
  const absolute = resolve(root, ...repositoryPath.split("/"));
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return absolute.startsWith(rootPrefix) ? absolute : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function maybeReadPackage(root, repositoryPath) {
  const absolute = filesystemPath(root, repositoryPath);
  if (!absolute) return null;
  try {
    const packageJson = await readJson(join(absolute, "package.json"));
    if (!isRecord(packageJson) || typeof packageJson.name !== "string" || packageJson.name.length === 0) return null;
    if (typeof packageJson.version !== "string" || packageJson.version.length === 0) return null;
    return { path: repositoryPath, name: packageJson.name, version: packageJson.version };
  } catch {
    return null;
  }
}

async function discoverWorkspacePackages(root, workspaces) {
  const findings = [];
  const packages = [];
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return { findings: ["package.json workspaces-must-be-a-non-empty-array"], packages };
  }

  for (const rawPattern of workspaces) {
    const pattern = normalizeRepositoryPath(rawPattern);
    if (!pattern) {
      findings.push("package.json unsafe-workspace-pattern");
      continue;
    }

    if (!pattern.includes("*")) {
      const packageMetadata = await maybeReadPackage(root, pattern);
      if (!packageMetadata) findings.push(`package.json ${pattern} workspace-package-missing`);
      else packages.push(packageMetadata);
      continue;
    }

    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      findings.push(`package.json ${pattern} unsupported-workspace-pattern`);
      continue;
    }

    const parentPath = pattern.slice(0, -2);
    const parentAbsolute = filesystemPath(root, parentPath);
    if (!parentAbsolute) {
      findings.push(`package.json ${pattern} unsafe-workspace-pattern`);
      continue;
    }

    let entries;
    try {
      entries = await readdir(parentAbsolute, { withFileTypes: true });
    } catch {
      findings.push(`package.json ${pattern} workspace-directory-missing`);
      continue;
    }

    let matched = 0;
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const packageMetadata = await maybeReadPackage(root, `${parentPath}/${entry.name}`);
      if (!packageMetadata) continue;
      packages.push(packageMetadata);
      matched += 1;
    }
    if (matched === 0) findings.push(`package.json ${pattern} matched-no-packages`);
  }

  const paths = new Set();
  const names = new Set();
  for (const workspace of packages) {
    if (paths.has(workspace.path)) findings.push(`package.json ${workspace.path} duplicate-workspace-path`);
    if (names.has(workspace.name)) findings.push(`package.json ${workspace.name} duplicate-workspace-name`);
    paths.add(workspace.path);
    names.add(workspace.name);
  }

  return { findings, packages };
}

function verifyWorkspaceLockGraph(lock, workspaces) {
  const findings = [];
  if (!isRecord(lock) || !isRecord(lock.packages)) return ["package-lock.json packages-map-missing"];

  const workspaceByPath = new Map(workspaces.map((workspace) => [workspace.path, workspace]));
  const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const linkedTargets = new Map();

  for (const workspace of workspaces) {
    const packageEntry = lock.packages[workspace.path];
    if (!isRecord(packageEntry)) {
      findings.push(`package-lock.json ${workspace.path} workspace-package-entry-missing`);
    } else {
      if (packageEntry.name !== workspace.name) {
        findings.push(`package-lock.json ${workspace.path} workspace-package-name-mismatch`);
      }
      if (packageEntry.version !== workspace.version) {
        findings.push(`package-lock.json ${workspace.path} workspace-package-version-mismatch`);
      }
    }

    const expectedLinkPath = `node_modules/${workspace.name}`;
    const linkEntry = lock.packages[expectedLinkPath];
    if (!isRecord(linkEntry) || linkEntry.link !== true) {
      findings.push(`package-lock.json ${expectedLinkPath} workspace-link-missing`);
    } else if (normalizeRepositoryPath(linkEntry.resolved) !== workspace.path) {
      findings.push(`package-lock.json ${expectedLinkPath} workspace-link-target-mismatch`);
    }
  }

  for (const [lockPath, rawEntry] of Object.entries(lock.packages)) {
    if (!isRecord(rawEntry) || rawEntry.link !== true) continue;
    if (!lockPath.startsWith("node_modules/")) {
      findings.push(`package-lock.json ${lockPath || "<root>"} workspace-link-path-invalid`);
      continue;
    }

    const target = normalizeRepositoryPath(rawEntry.resolved);
    if (!target) {
      findings.push(`package-lock.json ${lockPath} workspace-link-target-unsafe`);
      continue;
    }

    const workspace = workspaceByPath.get(target);
    if (!workspace) {
      findings.push(`package-lock.json ${lockPath} workspace-link-target-undeclared`);
      continue;
    }

    const linkedName = lockPath.slice("node_modules/".length);
    if (linkedName !== workspace.name || workspaceByName.get(linkedName)?.path !== target) {
      findings.push(`package-lock.json ${lockPath} workspace-link-name-mismatch`);
    }

    const existing = linkedTargets.get(target);
    if (existing && existing !== lockPath) {
      findings.push(`package-lock.json ${lockPath} duplicate-workspace-link-target`);
    } else {
      linkedTargets.set(target, lockPath);
    }
  }

  return [...new Set(findings)].sort();
}

function runSelfTests() {
  const workspaces = [{ path: "packages/core", name: "@elatura/core", version: "0.0.0" }];
  const goodLock = {
    packages: {
      "packages/core": { name: "@elatura/core", version: "0.0.0" },
      "node_modules/@elatura/core": { resolved: "packages/core", link: true },
    },
  };
  assert.deepEqual(verifyWorkspaceLockGraph(goodLock, workspaces), []);

  const corruptions = [
    ["unsafe target", "node_modules/@elatura/core", { resolved: "../outside", link: true }, "workspace-link-target-mismatch"],
    ["undeclared target", "node_modules/@elatura/core", { resolved: "packages/other", link: true }, "workspace-link-target-mismatch"],
    ["name mismatch", "node_modules/@elatura/wrong", { resolved: "packages/core", link: true }, "workspace-link-name-mismatch"],
    ["not a link", "node_modules/@elatura/core", { resolved: "packages/core", link: false }, "workspace-link-missing"],
  ];

  for (const [name, path, entry, expected] of corruptions) {
    const lock = structuredClone(goodLock);
    lock.packages[path] = entry;
    if (path !== "node_modules/@elatura/core") delete lock.packages["node_modules/@elatura/core"];
    assert(
      verifyWorkspaceLockGraph(lock, workspaces).some((finding) => finding.includes(expected)),
      `${name} workspace corruption escaped verification`,
    );
  }

  const duplicate = structuredClone(goodLock);
  duplicate.packages["node_modules/@elatura/alias"] = { resolved: "packages/core", link: true };
  assert(
    verifyWorkspaceLockGraph(duplicate, workspaces).some((finding) => finding.includes("duplicate-workspace-link-target")),
  );

  assert.equal(normalizeRepositoryPath("packages/core"), "packages/core");
  assert.equal(normalizeRepositoryPath("../outside"), null);
  assert.equal(normalizeRepositoryPath("/absolute"), null);
  assert.equal(normalizeRepositoryPath("packages\\core"), null);
}

runSelfTests();
const packageJson = await readJson(join(ROOT, "package.json"));
const lock = await readJson(join(ROOT, "package-lock.json"));
const discovery = await discoverWorkspacePackages(ROOT, packageJson.workspaces);
const findings = [...discovery.findings, ...verifyWorkspaceLockGraph(lock, discovery.packages)].sort();

if (findings.length > 0) {
  process.stderr.write(`Workspace lock verification failed with ${findings.length} finding(s):\n- ${findings.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Workspace lock verification passed for ${discovery.packages.length} declared package(s).\n`);
}
