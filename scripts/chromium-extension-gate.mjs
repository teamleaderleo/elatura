// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "extension/chromium/static/manifest.json";
const BACKGROUND_PATH = "extension/chromium/static/background.js";
const POPUP_PATH = "extension/chromium/static/popup.js";
const POPUP_HTML_PATH = "extension/chromium/static/popup.html";
const POPUP_CSS_PATH = "extension/chromium/static/popup.css";
const PROJECTION_PATH = "extension/chromium/src/projection.ts";
const BINDING_PATH = "extension/chromium/src/binding.ts";
const EFFECT_PATH = "extension/chromium/src/effect.ts";

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
  ["dynamic-chrome-access", /\bchrome\s*\[/u],
];

const SENSITIVE_TAB_PROPERTY_PATTERNS = [
  ["tab-url", /\.(?:url|pendingUrl)\b/u],
  ["tab-title", /\.title\b/u],
  ["tab-favicon", /\.favIconUrl\b/u],
];

const REMOTE_ASSET_PATTERNS = [
  ["remote-url", /https?:\/\//iu],
  ["protocol-relative-url", /(?:src|href)\s*=\s*["']\/\//iu],
  ["remote-css-import", /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//iu],
];

function exactKeys(value, expected, label) {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must be an object`);
  assert.equal(Array.isArray(value), false, `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields changed`);
}

function verifyManifest(manifest) {
  exactKeys(manifest, ALLOWED_MANIFEST_KEYS, "Chromium manifest");
  assert.equal(manifest.manifest_version, 3, "Chromium extension must remain Manifest V3");
  assert.equal(manifest.minimum_chrome_version, "132", "Chrome 132 minimum is required for frozen lifecycle metadata");
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

function scanPatterns(path, source, patterns) {
  const findings = [];
  for (const [code, pattern] of patterns) {
    if (pattern.test(source)) findings.push(`${path} ${code}`);
  }
  return findings;
}

function chromeNamespaces(source) {
  return [...source.matchAll(/\bchrome\.([A-Za-z][A-Za-z0-9_]*)/gu)].map((match) => match[1]);
}

function scanJavaScript(path, source) {
  const findings = [
    ...scanPatterns(path, source, FORBIDDEN_SOURCE_PATTERNS),
    ...scanPatterns(path, source, SENSITIVE_TAB_PROPERTY_PATTERNS),
  ];
  const allowed = path === BACKGROUND_PATH ? new Set(["runtime", "tabs", "windows"]) : new Set(["runtime"]);
  for (const namespace of chromeNamespaces(source)) {
    if (!allowed.has(namespace)) findings.push(`${path} chrome-${namespace}-api`);
  }
  if (path !== BACKGROUND_PATH && /\bchrome\.(?:tabs|windows)\b/u.test(source)) {
    findings.push(`${path} browser-lifecycle-api-outside-background`);
  }
  return findings;
}

function verifyBackground(source) {
  const required = [
    'from "./effect.js"',
    "chrome.tabs.query({})",
    "chrome.windows.getAll()",
    "chrome.tabs.get(tabId)",
    "manualDiscardEligibility(current)",
    "chrome.tabs.discard(tabId)",
    "chrome.tabs.reload(tabId)",
    "chrome.tabs.update(tabId, { active: true })",
    "chrome.windows.update(resulting.windowId, { focused: true })",
    "chrome.tabs.update(tabId, { autoDiscardable: false })",
    "chrome.tabs.update(tabId, { autoDiscardable: !protectedValue })",
    'message.type === "apply-effect"',
    "parseChromiumEffectRequestV1(message.request)",
    "projectionMatchesChromiumEffectRequestV1(request, before)",
    'operation: "apply-effect"',
    'authority: "browser-local-effect-request"',
    'operation: "keep-warm"',
    'laneBinding: "unbound"',
    'authority: "explicit-operator-browser-action"',
  ];
  for (const token of required) {
    assert.equal(source.includes(token), true, `Chromium background missing reviewed token: ${token}`);
  }
  assert.equal(/planApplicationLaneResidencyV1/u.test(source), false, "Browser effect host must not invoke lane residency planning");
  assert.equal(/laneRef|laneGeneration/u.test(source), false, "Chromium background must not receive canonical lane identity");
}

function verifyPopup(source) {
  const required = [
    'actionButton("Keep warm", { type: "keep-warm", tabId: projection.tabId })',
    'actionButton("Wake", { type: "wake", tabId: projection.tabId })',
  ];
  for (const token of required) {
    assert.equal(source.includes(token), true, `Chromium popup missing reviewed token: ${token}`);
  }
}

function verifyBinding(source) {
  const required = [
    'source: "explicit-local-binding"',
    'blocker !== "application_unknown"',
    "planApplicationLaneResidencyV1(",
    'effect: "none"',
  ];
  for (const token of required) {
    assert.equal(source.includes(token), true, `Chromium binding missing reviewed token: ${token}`);
  }
  assert.equal(/\bchrome\./u.test(source), false, "Pure Chromium binding must not invoke browser APIs");
}

function verifyEffect(source) {
  const required = [
    'chromiumExecutableResidencyEffects = ["keep_warm", "discard"]',
    "plan.projectionRef !== projection.projectionRef",
    "projectionMatchesChromiumEffectRequestV1",
    "matchChromiumEffectReceiptV1",
  ];
  for (const token of required) {
    assert.equal(source.includes(token), true, `Chromium effect contract missing reviewed token: ${token}`);
  }
  assert.equal(/laneRef|laneGeneration/u.test(source), false, "Browser-local effect contract must omit durable lane identity");
  assert.equal(/\bchrome\./u.test(source), false, "Pure Chromium effect contract must not invoke browser APIs");
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
    ["debugger", "chrome.debugger.attach(target)", "chrome-debugger-api"],
    ["scripting", "chrome.scripting.executeScript(options)", "chrome-scripting-api"],
    ["storage", "chrome.storage.local.set(value)", "chrome-storage-api"],
    ["network", "fetch('https://example.invalid')", "network-fetch"],
    ["sensitive", "tab.url", "tab-url"],
    ["logging", "console.log(tab)", "content-logging"],
    ["dynamic chrome", "chrome['tabs'].query({})", "dynamic-chrome-access"],
  ];
  for (const [name, source, expected] of cases) {
    const findings = scanJavaScript(BACKGROUND_PATH, source);
    assert.equal(findings.some((finding) => finding.includes(expected)), true, `${name} self-test escaped`);
  }
}

async function main() {
  runSelfTests();
  const [manifestText, background, popup, popupHtml, popupCss, projection, binding, effect] = await Promise.all([
    readFile(join(ROOT, MANIFEST_PATH), "utf8"),
    readFile(join(ROOT, BACKGROUND_PATH), "utf8"),
    readFile(join(ROOT, POPUP_PATH), "utf8"),
    readFile(join(ROOT, POPUP_HTML_PATH), "utf8"),
    readFile(join(ROOT, POPUP_CSS_PATH), "utf8"),
    readFile(join(ROOT, PROJECTION_PATH), "utf8"),
    readFile(join(ROOT, BINDING_PATH), "utf8"),
    readFile(join(ROOT, EFFECT_PATH), "utf8"),
  ]);

  verifyManifest(JSON.parse(manifestText));
  verifyBackground(background);
  verifyPopup(popup);
  verifyBinding(binding);
  verifyEffect(effect);

  const findings = [
    ...scanJavaScript(BACKGROUND_PATH, background),
    ...scanJavaScript(POPUP_PATH, popup),
    ...scanJavaScript(PROJECTION_PATH, projection),
    ...scanJavaScript(BINDING_PATH, binding),
    ...scanJavaScript(EFFECT_PATH, effect),
    ...scanPatterns(POPUP_HTML_PATH, popupHtml, REMOTE_ASSET_PATTERNS),
    ...scanPatterns(POPUP_CSS_PATH, popupCss, REMOTE_ASSET_PATTERNS),
  ];
  if (findings.length > 0) {
    throw new Error(`Chromium extension gate failed:\n${findings.sort().join("\n")}`);
  }

  process.stdout.write("chromium extension gate passed\n");
}

await main();
