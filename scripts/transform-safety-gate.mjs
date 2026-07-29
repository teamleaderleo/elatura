// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [capabilities, background, safety, popup, popupScript] = await Promise.all([
  readFile(join(ROOT, "security/capabilities.json"), "utf8").then(JSON.parse),
  readFile(join(ROOT, "extension/firefox/src/background.ts"), "utf8"),
  readFile(join(ROOT, "extension/firefox/src/transform-safety.ts"), "utf8"),
  readFile(join(ROOT, "extension/firefox/static/popup.html"), "utf8"),
  readFile(join(ROOT, "extension/firefox/src/popup.ts"), "utf8"),
]);

const transform = capabilities.capabilities?.transform;
assert.equal(transform?.enabled, false, "Transform capability must remain disabled.");
assert.equal(transform?.responseMutation, false, "Transform response mutation must remain disabled.");
assert.equal(transform?.persistentData, "none", "Transform persistence must remain disabled.");
assert.equal(transform?.outboundNetwork, false, "Transform network access must remain disabled.");
assert.equal(transform?.nativeMessaging, false, "Transform native messaging must remain disabled.");
assert.deepEqual(transform?.permissions, [], "Transform permissions must remain empty.");
assert.deepEqual(transform?.hostPermissions, [], "Transform host permissions must remain empty.");
assert.equal(transform?.emergencyControl, "local-disabled-by-default");
assert.equal(transform?.popupUnlock, false);
assert.equal(transform?.remotePolicy, false);
assert.equal(transform?.adapterDenylist, "bundled-exact-id-version");

assert.match(safety, /emergencyDisabled:\s*true/u, "Safety controller must start disabled.");
assert.match(
  safety,
  /BUNDLED_ADAPTER_DENYLIST[^=]*=\s*normalizeAdapterDenylist\(\[\]\)/u,
  "Adapter denylist must be bundled local data.",
);
assert.doesNotMatch(safety, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
assert.doesNotMatch(safety, /https?:\/\//u);

assert.match(background, /elatura:get-transform-safety/u);
assert.match(background, /elatura:emergency-disable-transforms/u);
assert.match(background, /createTransformSafetyController/u);
assert.match(popup, /id="emergency-disable"/u);
assert.match(popup, /id="transform-safety"/u);
assert.match(popupScript, /elatura:emergency-disable-transforms/u);

const extensionControlSurface = `${background}\n${popup}\n${popupScript}`;
assert.doesNotMatch(
  extensionControlSurface,
  /elatura:(?:enable|unlock|arm)-transforms/u,
  "The observe-only extension must expose no transform unlock message.",
);
assert.doesNotMatch(
  popup,
  /id="[^"]*(?:enable|unlock|arm)[^"]*transform[^"]*"/iu,
  "The popup must expose no transform unlock control.",
);

process.stdout.write(
  "Transform safety gate passed: locked default, local emergency control, bundled denylist, and no popup unlock path.\n",
);
