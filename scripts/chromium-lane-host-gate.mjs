// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "extension/chromium/static/manifest.json";
const SOURCE_ROOT = "extension/chromium/src";
const APPROVED_PERMISSIONS = ["storage"];
const APPROVED_TAB_METHODS = new Set([
  "query",
  "get",
  "update",
  "discard",
  "onRemoved",
  "onReplaced",
]);
const SOURCE_EXTENSIONS = new Set([".js", ".json", ".mjs", ".ts"]);

const FORBIDDEN_SOURCE_PATTERNS = [
  ["dynamic-evaluation", /\beval\s*\(/u],
  ["dynamic-function", /\bnew\s+Function\s*\(/u],
  ["remote-import", /\b(?:importScripts|import)\s*\(\s*["'`]https?:/iu],
  ["remote-static-import", /\b(?:import|export)\s+(?:(?:[^"'`;]+?)\s+from\s+)?["'`]https?:/iu],
  ["network-fetch", /\bfetch\s*\(/u],
  ["network-xhr", /\bXMLHttpRequest\b/u],
  ["network-websocket", /\bWebSocket\s*\(/u],
  ["network-eventsource", /\bEventSource\s*\(/u],
  ["network-beacon", /\bsendBeacon\s*\(/u],
  ["debugger-api", /\bchrome\.debugger\b/u],
  ["webrequest-api", /\bchrome\.webRequest\b/u],
  ["scripting-api", /\bchrome\.scripting\b/u],
  ["cookies-api", /\bchrome\.cookies\b/u],
  ["history-api", /\bchrome\.history\b/u],
  ["downloads-api", /\bchrome\.downloads\b/u],
  ["native-messaging", /\b(?:connectNative|sendNativeMessage)\s*\(/u],
  ["permission-change", /\bchrome\.permissions\b/u],
  ["content-logging", /\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u],
  ["sensitive-tab-url", /\b(?:tab|current|updated|discarded)\.(?:url|pendingUrl|title|favIconUrl)\b/u],
];

const TOKEN_PATTERNS = [
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u],
  ["openai-token", /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["private-key", /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u],
  ["bearer-jwt", /\bBearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u],
];

const PRIVATE_URL_PATTERN = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?=[/?#'"\s)]|$)/iu;

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameStrings(actual, expected) {
  return JSON.stringify(sortedUnique(actual)) === JSON.stringify(sortedUnique(expected));
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

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

function scanPatterns(path, text, patterns) {
  const findings = [];
  for (const [code, pattern] of patterns) {
    const match = pattern.exec(text);
    if (match) findings.push(`${path}:${lineForIndex(text, match.index)} ${code}`);
  }
  return findings;
}

function verifyManifest(manifest) {
  const findings = [];
  if (manifest.manifest_version !== 3) findings.push(`${MANIFEST_PATH} manifest-version-drift`);
  if (manifest.minimum_chrome_version !== "132") findings.push(`${MANIFEST_PATH} minimum-version-drift`);
  if (!sameStrings(manifest.permissions ?? [], APPROVED_PERMISSIONS)) {
    findings.push(`${MANIFEST_PATH} permissions-drift`);
  }
  for (const key of [
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
    "content_scripts",
    "web_accessible_resources",
    "externally_connectable",
  ]) {
    const value = manifest[key];
    if (Array.isArray(value) ? value.length > 0 : value !== undefined) {
      findings.push(`${MANIFEST_PATH} ${key}-forbidden`);
    }
  }
  if (
    manifest.background?.service_worker !== "background.js" ||
    manifest.background?.type !== "module"
  ) {
    findings.push(`${MANIFEST_PATH} background-boundary-drift`);
  }
  return findings;
}

function scanChromiumSource(path, text) {
  const findings = [
    ...scanPatterns(path, text, FORBIDDEN_SOURCE_PATTERNS),
    ...scanPatterns(path, text, TOKEN_PATTERNS),
  ];
  if (PRIVATE_URL_PATTERN.test(text)) findings.push(`${path} private-url`);

  if (!path.endsWith(".d.ts")) {
    if (path !== "extension/chromium/src/background.ts" && /\bchrome\.storage\b/u.test(text)) {
      findings.push(`${path} storage-outside-background`);
    }
    if (path !== "extension/chromium/src/background.ts" && /\bchrome\.tabs\b/u.test(text)) {
      findings.push(`${path} tabs-outside-background`);
    }
  }

  if (path === "extension/chromium/src/background.ts") {
    for (const match of text.matchAll(/\bchrome\.tabs\.([A-Za-z][A-Za-z0-9]*)/gu)) {
      const method = match[1];
      if (!APPROVED_TAB_METHODS.has(method)) {
        findings.push(`${path}:${lineForIndex(text, match.index)} tabs-method-${method}-forbidden`);
      }
    }
  }
  return findings;
}

async function auditChromiumLaneHost(root = ROOT) {
  const findings = [];
  const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
  findings.push(...verifyManifest(manifest));

  for (const absolutePath of await walk(join(root, SOURCE_ROOT))) {
    if (!SOURCE_EXTENSIONS.has(extname(absolutePath))) continue;
    const path = relative(root, absolutePath).replaceAll("\\", "/");
    findings.push(...scanChromiumSource(path, await readFile(absolutePath, "utf8")));
  }
  return sortedUnique(findings);
}

function runSelfTests() {
  const badManifest = {
    manifest_version: 3,
    minimum_chrome_version: "132",
    permissions: ["storage", "tabs"],
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js", type: "module" },
  };
  const manifestFindings = verifyManifest(badManifest);
  assert(manifestFindings.some((finding) => finding.includes("permissions-drift")));
  assert(manifestFindings.some((finding) => finding.includes("host_permissions-forbidden")));

  assert(
    scanChromiumSource(
      "extension/chromium/src/background.ts",
      "chrome.debugger.attach({tabId: 1}, '1.3');",
    ).some((finding) => finding.includes("debugger-api")),
  );
  assert(
    scanChromiumSource(
      "extension/chromium/src/background.ts",
      "void chrome.tabs.create({url: 'https://example.invalid'});",
    ).some((finding) => finding.includes("tabs-method-create-forbidden")),
  );
  assert(
    scanChromiumSource(
      "extension/chromium/src/host.ts",
      "void chrome.storage.local.get('x');",
    ).some((finding) => finding.includes("storage-outside-background")),
  );
}

runSelfTests();
const findings = await auditChromiumLaneHost();
if (findings.length > 0) {
  process.stderr.write(
    `Chromium lane host gate failed with ${findings.length} finding(s):\n- ${findings.join("\n- ")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Chromium lane host gate passed: storage-only manifest, bounded tab APIs, and forbidden sink checks are intact.\n",
  );
}
