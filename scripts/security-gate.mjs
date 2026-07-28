// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_PERMISSIONS = ["storage", "webRequest", "webRequestBlocking", "webRequestFilterResponse"];
const APPROVED_HOSTS = ["https://chatgpt.com/*"];
const SKIPPED_DIRECTORIES = new Set([".git", "artifacts", "dist", "node_modules"]);
const SOURCE_EXTENSIONS = new Set([".html", ".js", ".json", ".mjs", ".ts"]);

const FORBIDDEN_SOURCE_PATTERNS = [
  ["dynamic-evaluation", /\beval\s*\(/u],
  ["dynamic-function", /\bnew\s+Function\s*\(/u],
  ["remote-import", /\b(?:importScripts|import)\s*\(\s*["'`]https?:/iu],
  ["remote-script", /<script\b[^>]*\bsrc\s*=\s*["']https?:/iu],
  ["network-fetch", /\bfetch\s*\(/u],
  ["network-xhr", /\bXMLHttpRequest\b/u],
  ["network-websocket", /\bWebSocket\s*\(/u],
  ["network-eventsource", /\bEventSource\s*\(/u],
  ["network-beacon", /\bsendBeacon\s*\(/u],
  ["native-messaging", /\b(?:connectNative|sendNativeMessage)\s*\(/u],
  ["permission-change", /\b(?:browser|chrome)\.permissions\b/u],
  ["content-logging", /\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u],
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
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
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

function scanProductionSource(path, text) {
  const findings = scanPatterns(path, text, FORBIDDEN_SOURCE_PATTERNS);
  if (PRIVATE_URL_PATTERN.test(text)) findings.push(`${path} private-url`);

  if (!path.endsWith(".d.ts")) {
    if (path !== "extension/firefox/src/background.ts" && /\bbrowser\.storage\b/u.test(text)) {
      findings.push(`${path} storage-outside-background`);
    }
    if (path !== "extension/firefox/src/background.ts" && /\bbrowser\.webRequest\b/u.test(text)) {
      findings.push(`${path} webrequest-outside-background`);
    }
    if (/\bbrowser\.downloads\b/u.test(text)) findings.push(`${path} downloads-api`);
  }
  return findings;
}

function verifyPassThrough(backgroundText) {
  const findings = [];
  const onDataMatch = /filter\.ondata\s*=\s*\(event\)\s*=>\s*\{([\s\S]*?)\n\s*\};/u.exec(backgroundText);
  if (!onDataMatch) return ["extension/firefox/src/background.ts missing-ondata-handler"];
  const body = onDataMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (body !== "bytes += event.data.byteLength; filter.write(event.data);") {
    findings.push("extension/firefox/src/background.ts response-handler-is-not-byte-pass-through");
  }
  const writeCount = (backgroundText.match(/filter\.write\(event\.data\);/gu) ?? []).length;
  if (writeCount !== 1) findings.push("extension/firefox/src/background.ts unexpected-filter-write-count");
  if (/\b(?:TextDecoder|JSON\.parse|JSON\.stringify)\b/u.test(onDataMatch[1])) {
    findings.push("extension/firefox/src/background.ts response-handler-decodes-content");
  }
  return findings;
}

function scanWorkflow(path, text) {
  const findings = [];
  if (/^\s*pull_request_target\s*:/mu.test(text)) findings.push(`${path} pull-request-target-forbidden`);
  if (/^\s*permissions\s*:\s*write-all\s*(?:#.*)?$/mu.test(text)) findings.push(`${path} write-all-forbidden`);
  for (const match of text.matchAll(/^\s*[A-Za-z][A-Za-z0-9_-]*\s*:\s*write\s*(?:#.*)?$/gmu)) {
    findings.push(`${path}:${lineForIndex(text, match.index)} write-permission-forbidden`);
  }
  for (const match of text.matchAll(/^\s*-\s*uses\s*:\s*([^\s#]+)@([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const action = match[1];
    const revision = match[2];
    if (action.startsWith("./")) continue;
    if (!/^[0-9a-f]{40}$/u.test(revision)) {
      findings.push(`${path}:${lineForIndex(text, match.index)} action-must-use-full-sha`);
    }
  }
  return findings;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function verifyWorkflows(root) {
  const findings = [];
  const workflowDirectory = join(root, ".github/workflows");
  for (const absolutePath of await walk(workflowDirectory)) {
    if (![".yml", ".yaml"].includes(extname(absolutePath))) continue;
    const path = relative(root, absolutePath).replaceAll("\\", "/");
    findings.push(...scanWorkflow(path, await readFile(absolutePath, "utf8")));
  }

  const ciPath = ".github/workflows/ci.yml";
  const ciText = await readFile(join(root, ciPath), "utf8");
  if (!/^permissions:\s*\n\s+contents:\s+read\s*$/mu.test(ciText)) findings.push(`${ciPath} contents-read-required`);
  if (!/^\s+persist-credentials:\s+false\s*$/mu.test(ciText)) findings.push(`${ciPath} checkout-credentials-must-be-disabled`);
  if (!/\bnpm ci --ignore-scripts\b/u.test(ciText)) findings.push(`${ciPath} frozen-install-required`);
  if (/\bnpm install\b/u.test(ciText)) findings.push(`${ciPath} mutable-install-forbidden`);
  return findings;
}

async function verifyLockfile(root) {
  const findings = [];
  const packagePath = join(root, "package.json");
  const lockPath = join(root, "package-lock.json");
  try {
    await stat(lockPath);
  } catch {
    return ["package-lock.json missing-frozen-lockfile"];
  }

  const [packageJson, lock] = await Promise.all([readJson(packagePath), readJson(lockPath)]);
  if (lock.lockfileVersion !== 3) findings.push("package-lock.json unsupported-lockfile-version");
  const rootPackage = lock.packages?.[""];
  if (!rootPackage) return [...findings, "package-lock.json missing-root-package"];
  if (JSON.stringify(rootPackage.devDependencies ?? {}) !== JSON.stringify(packageJson.devDependencies ?? {})) {
    findings.push("package-lock.json root-dev-dependencies-drift");
  }
  if (JSON.stringify(rootPackage.workspaces ?? []) !== JSON.stringify(packageJson.workspaces ?? [])) {
    findings.push("package-lock.json root-workspaces-drift");
  }
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry || typeof entry !== "object" || entry.link === true || !entry.resolved) continue;
    if (!String(entry.resolved).startsWith("https://registry.npmjs.org/")) {
      findings.push(`package-lock.json ${path || "<root>"} non-registry-resolution`);
    }
    if (!/^sha512-[A-Za-z0-9+/=]+$/u.test(String(entry.integrity ?? ""))) {
      findings.push(`package-lock.json ${path || "<root>"} missing-sha512-integrity`);
    }
  }
  return findings;
}

function verifyCapabilities(capabilityPolicy) {
  const findings = [];
  const observe = capabilityPolicy.capabilities?.observe;
  if (capabilityPolicy.defaultCapability !== "observe") findings.push("security/capabilities.json default-is-not-observe");
  if (!observe || observe.enabled !== true) findings.push("security/capabilities.json observe-must-be-enabled");
  if (!sameStrings(observe?.permissions ?? [], APPROVED_PERMISSIONS)) findings.push("security/capabilities.json observe-permission-drift");
  if (!sameStrings(observe?.hostPermissions ?? [], APPROVED_HOSTS)) findings.push("security/capabilities.json observe-host-permission-drift");
  if (observe?.responseAccess !== "byte-pass-through" || observe?.responseMutation !== false) {
    findings.push("security/capabilities.json observe-response-boundary-drift");
  }
  if (observe?.outboundNetwork !== false || observe?.nativeMessaging !== false) {
    findings.push("security/capabilities.json observe-sink-boundary-drift");
  }

  for (const name of ["transform", "cache", "nativeCompanion"]) {
    const capability = capabilityPolicy.capabilities?.[name];
    if (!capability || capability.enabled !== false) findings.push(`security/capabilities.json ${name}-must-remain-disabled`);
    if ((capability?.permissions ?? []).length > 0 || (capability?.hostPermissions ?? []).length > 0) {
      findings.push(`security/capabilities.json ${name}-permissions-must-be-empty`);
    }
    if (capability?.outboundNetwork !== false || capability?.nativeMessaging !== false) {
      findings.push(`security/capabilities.json ${name}-sinks-must-remain-disabled`);
    }
  }
  return findings;
}

async function auditRepository(root = ROOT) {
  const findings = [];
  const manifestPath = join(root, "extension/firefox/static/manifest.json");
  const capabilityPath = join(root, "security/capabilities.json");
  const [manifest, capabilityPolicy] = await Promise.all([readJson(manifestPath), readJson(capabilityPath)]);

  if (!sameStrings(manifest.permissions ?? [], APPROVED_PERMISSIONS)) findings.push("extension/firefox/static/manifest.json permissions-drift");
  if (!sameStrings(manifest.host_permissions ?? [], APPROVED_HOSTS)) findings.push("extension/firefox/static/manifest.json host-permissions-drift");
  if ((manifest.optional_permissions ?? []).length > 0 || (manifest.optional_host_permissions ?? []).length > 0) {
    findings.push("extension/firefox/static/manifest.json optional-permissions-forbidden");
  }
  findings.push(...verifyCapabilities(capabilityPolicy));

  const productionRoots = ["extension/firefox/src", "packages", "benchmarks/src"];
  for (const relativeRoot of productionRoots) {
    for (const absolutePath of await walk(join(root, relativeRoot))) {
      if (!SOURCE_EXTENSIONS.has(extname(absolutePath))) continue;
      const path = relative(root, absolutePath).replaceAll("\\", "/");
      if (relativeRoot === "packages" && !path.includes("/src/")) continue;
      findings.push(...scanProductionSource(path, await readFile(absolutePath, "utf8")));
    }
  }

  const tokenRoots = ["extension/firefox", "packages", "benchmarks"];
  for (const relativeRoot of tokenRoots) {
    for (const absolutePath of await walk(join(root, relativeRoot))) {
      if (!SOURCE_EXTENSIONS.has(extname(absolutePath))) continue;
      const path = relative(root, absolutePath).replaceAll("\\", "/");
      const text = await readFile(absolutePath, "utf8");
      findings.push(...scanPatterns(path, text, TOKEN_PATTERNS));
      if (PRIVATE_URL_PATTERN.test(text)) findings.push(`${path} private-url`);
    }
  }

  const backgroundText = await readFile(join(root, "extension/firefox/src/background.ts"), "utf8");
  findings.push(...verifyPassThrough(backgroundText));
  findings.push(...(await verifyLockfile(root)));
  findings.push(...(await verifyWorkflows(root)));
  return sortedUnique(findings);
}

function runSelfTests() {
  const cases = [
    ["network", "extension/firefox/src/content.ts", "fetch(pageData)", "network-fetch"],
    ["storage", "extension/firefox/src/content.ts", "browser.storage.local.set(pageData)", "storage-outside-background"],
    ["native", "extension/firefox/src/content.ts", "browser.runtime.sendNativeMessage(pageData)", "native-messaging"],
    ["permission", "extension/firefox/src/content.ts", "browser.permissions.request(pageData)", "permission-change"],
    ["evaluation", "packages/core/src/index.ts", "eval(pageData)", "dynamic-evaluation"],
    ["logging", "extension/firefox/src/background.ts", "console.warn(pageData)", "content-logging"],
    ["private URL", "packages/core/src/index.ts", "fetch('http://127.0.0.1:9000')", "private-url"],
  ];
  for (const [name, path, source, expected] of cases) {
    const findings = scanProductionSource(path, source);
    assert(findings.some((finding) => finding.includes(expected)), `${name} adversarial case escaped the gate`);
  }
  const fakeToken = `gh${"p"}_${"A".repeat(36)}`;
  assert(scanPatterns("packages/fixtures/test/secret.test.ts", fakeToken, TOKEN_PATTERNS).length === 1);
  assert.deepEqual(verifyPassThrough("filter.ondata = (event) => {\n bytes += event.data.byteLength;\n filter.write(event.data);\n };"), []);
  assert(scanWorkflow(".github/workflows/test.yml", "steps:\n  - uses: actions/checkout@v6\n").some((finding) => finding.includes("action-must-use-full-sha")));
  assert(scanWorkflow(".github/workflows/test.yml", "permissions:\n  contents: write\n").some((finding) => finding.includes("write-permission-forbidden")));
  assert(scanWorkflow(".github/workflows/test.yml", "on:\n  pull_request_target:\n").some((finding) => finding.includes("pull-request-target-forbidden")));
}

runSelfTests();
const findings = await auditRepository();
if (findings.length > 0) {
  process.stderr.write(`Security gate failed with ${findings.length} finding(s):\n- ${findings.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Security gate passed: dependencies, workflows, permissions, capability boundaries, pass-through handling, and forbidden sink checks are intact.\n");
}
