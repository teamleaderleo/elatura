// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM_SRC_ROOT = "extension/chromium/src";
const CHROMIUM_STATIC_ROOT = "extension/chromium/static";
const MANIFEST_PATH = "extension/chromium/static/manifest.json";
const BACKGROUND_PATH = "extension/chromium/static/background.js";
const POPUP_PATH = "extension/chromium/static/popup.js";
const POPUP_HTML_PATH = "extension/chromium/static/popup.html";
const POPUP_CSS_PATH = "extension/chromium/static/popup.css";
const PROJECTION_PATH = "extension/chromium/src/projection.ts";
const BINDING_PATH = "extension/chromium/src/binding.ts";
const BINDING_RUNTIME_PATH = "extension/chromium/src/binding-runtime.ts";
const EFFECT_PATH = "extension/chromium/src/effect.ts";
const MANAGED_EFFECT_RUNTIME_PATH = "extension/chromium/src/managed-effect-runtime.ts";

const REQUIRED_CONTRACT_PATHS = Object.freeze([
  MANIFEST_PATH,
  BACKGROUND_PATH,
  POPUP_PATH,
  POPUP_HTML_PATH,
  POPUP_CSS_PATH,
  PROJECTION_PATH,
  BINDING_PATH,
  BINDING_RUNTIME_PATH,
  EFFECT_PATH,
  MANAGED_EFFECT_RUNTIME_PATH,
]);

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

function allowedChromeNamespaces(path) {
  if (path === BACKGROUND_PATH) return new Set(["runtime", "tabs", "windows"]);
  if (path === POPUP_PATH) return new Set(["runtime"]);
  return new Set();
}

function scanJavaScript(path, source) {
  const findings = [
    ...scanPatterns(path, source, FORBIDDEN_SOURCE_PATTERNS),
    ...scanPatterns(path, source, SENSITIVE_TAB_PROPERTY_PATTERNS),
  ];
  const allowed = allowedChromeNamespaces(path);
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

function verifyBindingRuntime(source) {
  const required = [
    "planBoundChromiumResidencyV1(",
    '"generation-advanced-unbound"',
    "#projectionOwners",
    "grantsWorkAuthority: false",
    "authorizesWorkDispatch: false",
  ];
  for (const token of required) {
    assert.equal(source.includes(token), true, `Chromium binding runtime missing reviewed token: ${token}`);
  }
  assert.equal(/\bchrome\./u.test(source), false, "Chromium binding runtime must not invoke browser APIs");
  assert.equal(/\b(?:localStorage|sessionStorage|indexedDB)\b/u.test(source), false, "Chromium binding runtime must remain volatile");
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

function verifyManagedEffectRuntime(source) {
  const required = [
    "this.#bindings.planCurrent(",
    "createChromiumEffectRequestV1(",
    "matchChromiumEffectReceiptV1(",
    "this.#bindings.currentBinding(",
    "#claimedRequestRefs",
    '"request-ref-reused"',
    '"stale-generation"',
    '"stale-projection"',
    "grantsWorkAuthority: false",
    "authorizesWorkDispatch: false",
  ];
  for (const token of required) {
    assert.equal(source.includes(token), true, `Chromium managed effect runtime missing reviewed token: ${token}`);
  }
  assert.equal(/\bchrome\./u.test(source), false, "Chromium managed effect runtime must not invoke browser APIs");
  assert.equal(/\b(?:localStorage|sessionStorage|indexedDB)\b/u.test(source), false, "Chromium managed effect runtime must remain volatile");
}

async function walkFiles(relativeRoot) {
  const output = [];
  async function walk(relativeDirectory) {
    const entries = await readdir(join(ROOT, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile()) {
        output.push(relativePath);
      }
    }
  }
  await walk(relativeRoot);
  return output.sort();
}

async function discoverChromiumInputs() {
  const paths = [
    ...(await walkFiles(CHROMIUM_SRC_ROOT)),
    ...(await walkFiles(CHROMIUM_STATIC_ROOT)),
  ].sort();
  const sources = new Map(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(join(ROOT, path), "utf8")]),
    ),
  );
  for (const required of REQUIRED_CONTRACT_PATHS) {
    assert.equal(sources.has(required), true, `Chromium reviewed contract path missing: ${required}`);
  }
  return sources;
}

function requiredSource(sources, path) {
  const source = sources.get(path);
  assert.equal(typeof source, "string", `Chromium reviewed source missing: ${path}`);
  return source;
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
    ["debugger", BACKGROUND_PATH, "chrome.debugger.attach(target)", "chrome-debugger-api"],
    ["scripting", BACKGROUND_PATH, "chrome.scripting.executeScript(options)", "chrome-scripting-api"],
    ["storage", BACKGROUND_PATH, "chrome.storage.local.set(value)", "chrome-storage-api"],
    ["network", BACKGROUND_PATH, "fetch('https://example.invalid')", "network-fetch"],
    ["sensitive", BACKGROUND_PATH, "tab.url", "tab-url"],
    ["logging", BACKGROUND_PATH, "console.log(tab)", "content-logging"],
    ["dynamic chrome", BACKGROUND_PATH, "chrome['tabs'].query({})", "dynamic-chrome-access"],
    ["future pure browser API", `${CHROMIUM_SRC_ROOT}/future-module.ts`, "chrome.runtime.sendMessage({})", "chrome-runtime-api"],
    ["future pure network", `${CHROMIUM_SRC_ROOT}/future-module.ts`, "fetch('/unexpected')", "network-fetch"],
  ];
  for (const [name, path, source, expected] of cases) {
    const findings = scanJavaScript(path, source);
    assert.equal(findings.some((finding) => finding.includes(expected)), true, `${name} self-test escaped`);
  }
  assert.deepEqual(
    [...allowedChromeNamespaces(BACKGROUND_PATH)].sort(),
    ["runtime", "tabs", "windows"],
  );
  assert.deepEqual([...allowedChromeNamespaces(POPUP_PATH)], ["runtime"]);
  assert.equal(allowedChromeNamespaces(`${CHROMIUM_SRC_ROOT}/future-module.ts`).size, 0);
}

async function main() {
  runSelfTests();
  const sources = await discoverChromiumInputs();

  verifyManifest(JSON.parse(requiredSource(sources, MANIFEST_PATH)));
  verifyBackground(requiredSource(sources, BACKGROUND_PATH));
  verifyPopup(requiredSource(sources, POPUP_PATH));
  verifyBinding(requiredSource(sources, BINDING_PATH));
  verifyBindingRuntime(requiredSource(sources, BINDING_RUNTIME_PATH));
  verifyEffect(requiredSource(sources, EFFECT_PATH));
  verifyManagedEffectRuntime(requiredSource(sources, MANAGED_EFFECT_RUNTIME_PATH));

  const findings = [];
  for (const [path, source] of sources) {
    if (path.endsWith(".ts") || path.endsWith(".js")) {
      findings.push(...scanJavaScript(path, source));
    }
    if (path.endsWith(".html") || path.endsWith(".css")) {
      findings.push(...scanPatterns(path, source, REMOTE_ASSET_PATTERNS));
    }
  }

  if (findings.length > 0) {
    throw new Error(`Chromium extension gate failed:\n${[...new Set(findings)].sort().join("\n")}`);
  }

  process.stdout.write(
    `chromium extension gate passed (${sources.size} source/static files discovered)\n`,
  );
}

await main();
