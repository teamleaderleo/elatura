// SPDX-License-Identifier: MPL-2.0
import { constants, lstat, open, opendir } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export const DEFAULT_BASELINE_INPUT_LIMITS = Object.freeze({
  maxDepth: 4,
  maxDirectories: 16,
  maxEntriesPerDirectory: 128,
  maxFiles: 96,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 16_777_216,
});

export class BaselineInputBundleError extends Error {
  constructor(code, entryIndex = null) {
    super(`Baseline input rejected: ${code}${entryIndex === null ? "" : ` (entry ${entryIndex})`}.`);
    this.name = "BaselineInputBundleError";
    this.code = code;
    this.entryIndex = entryIndex;
  }
}

function limitsWithDefaults(limits = {}) {
  const merged = { ...DEFAULT_BASELINE_INPUT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Invalid baseline input limit: ${name}.`);
    }
  }
  return merged;
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

async function inspect(pathname, depth, state) {
  const entryIndex = state.nextEntryIndex++;
  let details;
  try {
    details = await lstat(pathname);
  } catch {
    throw new BaselineInputBundleError("entry-unreadable", entryIndex);
  }

  if (details.isSymbolicLink()) {
    throw new BaselineInputBundleError("symbolic-link", entryIndex);
  }

  if (details.isFile()) {
    if (extname(pathname).toLowerCase() !== ".json") {
      throw new BaselineInputBundleError("unexpected-file-type", entryIndex);
    }
    if (details.size > state.limits.maxFileBytes) {
      throw new BaselineInputBundleError("file-too-large", entryIndex);
    }
    if (!state.seenFiles.has(pathname)) {
      state.seenFiles.add(pathname);
      state.totalBytes += details.size;
      if (state.files.length + 1 > state.limits.maxFiles) {
        throw new BaselineInputBundleError("too-many-files", entryIndex);
      }
      if (state.totalBytes > state.limits.maxTotalBytes) {
        throw new BaselineInputBundleError("bundle-too-large", entryIndex);
      }
      state.files.push({
        path: pathname,
        size: details.size,
        device: details.dev,
        inode: details.ino,
        entryIndex,
      });
    }
    return;
  }

  if (!details.isDirectory()) {
    throw new BaselineInputBundleError("unsupported-entry-type", entryIndex);
  }
  if (depth > state.limits.maxDepth) {
    throw new BaselineInputBundleError("directory-depth-exceeded", entryIndex);
  }
  state.directoryCount += 1;
  if (state.directoryCount > state.limits.maxDirectories) {
    throw new BaselineInputBundleError("too-many-directories", entryIndex);
  }

  let directory;
  try {
    directory = await opendir(pathname);
  } catch {
    throw new BaselineInputBundleError("entry-unreadable", entryIndex);
  }

  let count = 0;
  const children = [];
  try {
    for await (const child of directory) {
      count += 1;
      if (count > state.limits.maxEntriesPerDirectory) {
        throw new BaselineInputBundleError("too-many-directory-entries", entryIndex);
      }
      children.push(resolve(pathname, child.name));
    }
  } catch (error) {
    if (error instanceof BaselineInputBundleError) throw error;
    throw new BaselineInputBundleError("entry-unreadable", entryIndex);
  }

  children.sort();
  for (const child of children) await inspect(child, depth + 1, state);
}

export async function collectBaselineInputFiles(pathnames, options = {}) {
  if (!Array.isArray(pathnames) || pathnames.length === 0) {
    throw new BaselineInputBundleError("missing-input");
  }
  const limits = limitsWithDefaults(options.limits);
  const roots = [...new Set(pathnames.map((pathname) => resolve(pathname)))];
  const outputPath = options.outputPath === undefined || options.outputPath === null
    ? null
    : resolve(options.outputPath);

  if (outputPath !== null) {
    for (const root of roots) {
      let details;
      try {
        details = await lstat(root);
      } catch {
        throw new BaselineInputBundleError("entry-unreadable");
      }
      if ((details.isDirectory() && isWithin(root, outputPath)) || root === outputPath) {
        throw new BaselineInputBundleError("output-inside-input");
      }
    }
  }

  const state = {
    limits,
    files: [],
    seenFiles: new Set(),
    totalBytes: 0,
    directoryCount: 0,
    nextEntryIndex: 1,
  };
  for (const root of roots) await inspect(root, 0, state);
  state.files.sort((left, right) => left.path.localeCompare(right.path));
  return state.files;
}

async function readBounded(entry, maxFileBytes) {
  let handle;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    handle = await open(entry.path, constants.O_RDONLY | noFollow);
    const details = await handle.stat();
    if (!details.isFile()) throw new BaselineInputBundleError("unsupported-entry-type", entry.entryIndex);
    if (details.dev !== entry.device || details.ino !== entry.inode || details.size !== entry.size) {
      throw new BaselineInputBundleError("entry-changed", entry.entryIndex);
    }
    if (details.size > maxFileBytes) {
      throw new BaselineInputBundleError("file-too-large", entry.entryIndex);
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const remaining = maxFileBytes + 1 - total;
      if (remaining <= 0) throw new BaselineInputBundleError("file-too-large", entry.entryIndex);
      const buffer = Buffer.alloc(Math.min(65_536, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if (total !== details.size) throw new BaselineInputBundleError("entry-changed", entry.entryIndex);
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof BaselineInputBundleError) throw error;
    throw new BaselineInputBundleError("entry-unreadable", entry.entryIndex);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readBaselineJsonEntry(entry, options = {}) {
  const limits = limitsWithDefaults(options.limits);
  const bytes = await readBounded(entry, limits.maxFileBytes);
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    throw new BaselineInputBundleError("invalid-utf8", entry.entryIndex);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BaselineInputBundleError("invalid-json", entry.entryIndex);
  }
}

export async function readBaselinePlan(pathname, options = {}) {
  const limits = limitsWithDefaults(options.limits);
  const entries = await collectBaselineInputFiles([pathname], {
    limits: { ...limits, maxFiles: 1, maxTotalBytes: limits.maxFileBytes },
  });
  if (entries.length !== 1) throw new BaselineInputBundleError("missing-plan");
  return readBaselineJsonEntry(entries[0], { limits });
}
