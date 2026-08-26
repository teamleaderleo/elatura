// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "extension/chromium/static/manifest.json";
const BACKGROUND_PATH = "extension/chromium/static/background.js";
const POPUP_PATH = "extension/chromium/static/popup.js";
const LIFECYCLE_PATH = "extension/chromium/src/lifecycle.ts";

const ALLOWED_MANIFEST_KEYS = [
  "manifest_version",
  "name",
  "version",
  "description",
  "minimum_chrome_version",
  "background",
  "action",
];

const FORBIDDEN_SOURCE_PATTERNS = [
  ["debugger-api", /\bchrome\.debugger\b/u],
  ["scripting-api", /\bchrome\.scripting\b/u],
  ["storage-api", /\bchrome\.storage\b/u],
  ["cookies-api", /\bchrome\.cookies\b/u],
  ["history-api", /\bchrome\.history\b/u],
  ["browsing-data-api", /\bchrome\.browsingData\b/u],
  ["web-request-api", /\bchrome\.webRequest\b/u],
  ["downloads-api", /\bchrome\.downloads\b/u],
  ["network-fetch", /\bfetch\s*\(/u],
  ["network-xhr", /\bXMLHttpRequest\b/u],
  ["network-websocket", /\bWebSocket\s*\(/u],
  ["network-eventsource", /\bEventSource\s*\(/u],
  ["network-beacon", /\bsendBeacon\s*\(/u],
  ["dynamic-evaluation", /\beval\s*\(/u],
  ["dynamic-function", /\bnew\s+Function\s*\(/u],
  ["remote-import", /\b(?:importScripts|import)\s*\(\s*["'`]https?:/iu],
  ["remote-static-import", /\bimport\s+(?:(?:[^"'`;]+?)\s+from\s+)?["'`]https?:/iu],
  ["content-logging", /\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u],
];

const SENSITIVE_TAB_PROPERTY_PATTERNS = [
  ["tab-url", /\.(?:url|pendingUrl)\b/u],
  ["tab-title", /\.title\b/u],
  ["tab-favicon", /\.favIconUrl\b/u],
];

function exactKeys(value, expected, label) {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must be an object`);
  assert.equal(Array.isArray(value), false, `${label} must be an object`);
  const keys = Object.keys(value).sort();
  assert.deepEqual(keys, [...expected].sort(), `${label} fields changed`);
}

function verifyManifest(manifest) {
  exactKeys(manifest, ALLOWED_MANIFEST_KEYS, "Chromium manifest");
  assert.equal(manifest.manifest_version, 3, "Chromium extension must remain Manifest V3");
  assert.equal(manifest.minimum_chrome_version, "132", "Chrome 132 minimum is required for frozen lifecycle state");
  exactKeys(manifest.background, ["service_worker", "type"], "Chromium background");
  assert.equal(manifest.background.service_worker, "background.js", "Unexpected Chromium service worker");
  assert.equal(manifest.background.type, "module", "Chromium service worker must remain a module");
  exactKeys(manifest.action, ["default_popup"], "Chromium action");
  assert.equal(manifest.action.default_popup, "popup.html", "Unexpected Chromium popup");

  for (const field of [
    "permissions",
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
    "content_scripts",
    "web_accessible_resources",
    "externally_connectable",
  ]) {
    assert.equal(Object.hasOwn(manifest, field), false, `Chromium manifest must omit ${field}`);
  }
}

function scanSource(path, source) {
  const findings = [];
  for (const [code, pattern] of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(source)) findings.push(`${path} ${code}`);
  }
  for (const [code, pattern] of SENSITIVE_TAB_PROPERTY_PATTERNS) {
    if (pattern.test(source)) findings.push(`${path} ${code}`);
  }
  if (path !== BACKGROUND_PATH && /\bchrome\.tabs\b/u.test(source)) {
    findings.push(`${path} tabs-api-outside-background`);
  }
  return findings;
}

function verifyBackground(background) {
  const requiredOperations = [
    "chrome.tabs.query({})",
    "chrome.tabs.get(tabId)",
    "chrome.tabs.discard(tabId)",
    "chrome.tabs.update(tabId, { active: true })",
    "chrome.tabs.update(tabId, { autoDiscardable: !protectedValue })",
  ];
  for (const operation of requiredOperations) {
    assert.equal(background.includes(operation), true, `Chromium background missing reviewed operation: ${operation}`);
  }
  assert.equal(background.includes("browserOnlyLaneSignals()"), true, "Chromium host must keep app safety unknown");
  assert.equal(background.includes("manualDiscardEligibility(current)"), true, "Manual discard must revalidate fresh state");
}

function runSelfTests() {
  const hostileManifest = {
    manifest_version: 3,
    name: "x",
    version: "1",
    description: "x",
    minimum_chrome_version: "132",
    background: { service_worker: "background.js", type: "module" },
    action: { default_popup: "popup.html" },
    permissions: ["tabs"],
  };
  assert.throws(() => verifyManifest(hostileManifest), /fields changed/u);

  const cases = [
    ["debugger", "chrome.debugger.attach(target)", "debugger-api"],
    ["scripting", "chrome.scripting.executeScript(options)", "scripting-api"],
    ["storage", "chrome.storage.local.set(value)", "storage-api"],
    ["network", "fetch('https://example.invalid')", "network-fetch"],
    ["sensitive", "tab.url", "tab-url"],
    ["logging", "console.log(tab)", "content-logging"],
  ];
  for (const [name, source, expected] of cases) {
    const findings = scanSource(BACKGROUND_PATH, source);
    assert.equal(findings.some((finding) => finding.includes(expected)), true, `${name} self-test escaped`);
  }
}

async function main() {
  runSelfTests();
  const [manifestText, background, popup, lifecycle] = await Promise.all([
    readFile(join(ROOT, MANIFEST_PATH), "utf8"),
    readFile(join(ROOT, BACKGROUND_PATH), "utf8"),
    readFile(join(ROOT, POPUP_PATH), "utf8"),
    readFile(join(ROOT, LIFECYCLE_PATH), "utf8"),
  ]);
  verifyManifest(JSON.parse(manifestText));
  verifyBackground(background);

  const findings = [
    ...scanSource(BACKGROUND_PATH, background),
    ...scanSource(POPUP_PATH, popup),
    ...scanSource(LIFECYCLE_PATH, lifecycle),
  ];
  if (findings.length > 0) {
    throw new Error(`Chromium extension gate failed:\n${findings.sort().join("\n")}`);
  }

  process.stdout.write("chromium extension gate passed\n");
}

await main();
