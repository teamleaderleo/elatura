// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [capabilities, background, safety, optIn, liveAuthorization, popup, popupScript] = await Promise.all([
  readFile(join(ROOT, "security/capabilities.json"), "utf8").then(JSON.parse),
  readFile(join(ROOT, "extension/firefox/src/background.ts"), "utf8"),
  readFile(join(ROOT, "extension/firefox/src/transform-safety.ts"), "utf8"),
  readFile(join(ROOT, "extension/firefox/src/transform-opt-in.ts"), "utf8"),
  readFile(join(ROOT, "extension/firefox/src/live-authorization.ts"), "utf8"),
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
assert.equal(transform?.localOptIn, "session-intent-only");
assert.equal(transform?.optInPersistence, "none");
assert.equal(transform?.optInAuthorizesTransform, false);
assert.equal(transform?.liveAuthorization, "required-disconnected");
assert.equal(transform?.liveAuthorizationPersistence, "none");
assert.equal(transform?.reviewedLiveApproval, "absent");
assert.equal(transform?.liveGrantIssuer, "absent");

assert.match(safety, /emergencyDisabled:\s*true/u, "Safety controller must start disabled.");
assert.match(
  safety,
  /BUNDLED_ADAPTER_DENYLIST[^=]*=\s*normalizeAdapterDenylist\(\[\]\)/u,
  "Adapter denylist must be bundled local data.",
);
assert.doesNotMatch(safety, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
assert.doesNotMatch(safety, /https?:\/\//u);

assert.match(optIn, /recorded:\s*false/u, "Opt-in intent must start unrecorded.");
assert.match(optIn, /authorizesTransform:\s*false/u, "Opt-in intent must not authorize transformation.");
assert.match(optIn, /TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS/u);
assert.doesNotMatch(optIn, /\bbrowser\.storage\b/u, "Opt-in intent must remain session-local.");
assert.doesNotMatch(optIn, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
assert.doesNotMatch(optIn, /https?:\/\//u);

assert.match(liveAuthorization, /evaluateLiveAuthorization/u);
assert.match(liveAuthorization, /emergency-disabled/u);
assert.match(liveAuthorization, /approval-missing/u);
assert.match(liveAuthorization, /grant-missing/u);
assert.doesNotMatch(liveAuthorization, /\bbrowser\.(?:storage|runtime|webRequest|downloads)\b/u);
assert.doesNotMatch(liveAuthorization, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
assert.doesNotMatch(liveAuthorization, /\b(?:create|issue)VolatileLiveAuthorizationGrant\b/u);
assert.doesNotMatch(
  background,
  /live-authorization/u,
  "The live authorization design must remain disconnected from response handling.",
);

assert.match(background, /elatura:get-transform-safety/u);
assert.match(background, /elatura:emergency-disable-transforms/u);
assert.match(background, /createTransformSafetyController/u);
assert.match(background, /elatura:get-transform-opt-in/u);
assert.match(background, /elatura:record-transform-opt-in/u);
assert.match(background, /elatura:revoke-transform-opt-in/u);
assert.match(background, /registerVolatileTransformStateClearer/u);
assert.match(popup, /id="emergency-disable"/u);
assert.match(popup, /id="transform-safety"/u);
assert.match(popup, /id="transform-opt-in"/u);
assert.match(popup, /id="record-opt-in"/u);
assert.match(popup, /id="revoke-opt-in"/u);
assert.match(popupScript, /elatura:emergency-disable-transforms/u);
assert.match(popupScript, /elatura:record-transform-opt-in/u);
assert.match(popupScript, /elatura:revoke-transform-opt-in/u);
assert.match(popupScript, /authoriz(?:e|ed)/iu);

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
  "Transform safety gate passed: locked default, non-authorizing session opt-in intent, disconnected deny-by-default live authorization, local emergency control, bundled denylist, and no popup unlock path.\n",
);
