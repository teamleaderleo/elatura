// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox slim-mode prototype", () => {
  it("stays within the existing extension permission and host boundary", () => {
    const manifest = JSON.parse(
      read("extension/firefox/static/manifest.json"),
    ) as Record<string, unknown>;

    expect(manifest.permissions).toEqual([
      "storage",
      "webRequest",
      "webRequestBlocking",
      "webRequestFilterResponse",
    ]);
    expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
    expect(manifest.web_accessible_resources).toEqual([
      {
        resources: [
          "slim-content-controller.js",
          "slim-discovery.js",
          "slim-live-discovery.js",
          "slim-live-observation.js",
          "slim-window.js",
        ],
        matches: ["https://chatgpt.com/*"],
      },
    ]);
  });

  it("keeps the classic content script small and fail-open", () => {
    const content = read("extension/firefox/src/content.ts");

    expect(content).toContain('import(browser.runtime.getURL("slim-content-controller.js"))');
    expect(content).toContain("controller.bootSlimContentController()");
    expect(content).toContain("The observer remains usable");
    expect(content).not.toContain("element.remove()");
    expect(content).not.toContain("sessionStorage");
  });

  it("keeps page content out of storage, logs, and network sinks", () => {
    const content = read("extension/firefox/src/content.ts");
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const discovery = read("extension/firefox/src/slim-live-discovery.ts");
    const observation = read("extension/firefox/src/slim-live-observation.ts");
    const surface = `${content}\n${controller}\n${discovery}\n${observation}`;

    expect(surface).not.toMatch(/\bbrowser\.storage\b/u);
    expect(surface).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(surface).not.toMatch(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u);
    expect(surface).not.toMatch(/(?:roleNode|candidate|turn\.element)\.textContent/u);
    expect(surface).not.toMatch(/\.(?:innerText|outerHTML)\b/u);
  });

  it("does not add any response-transform path", () => {
    const content = read("extension/firefox/src/content.ts");
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const discovery = read("extension/firefox/src/slim-live-discovery.ts");
    const observation = read("extension/firefox/src/slim-live-observation.ts");
    const background = read("extension/firefox/src/background.ts");

    expect(`${content}\n${controller}\n${discovery}\n${observation}`).not.toContain(
      "filterResponseData",
    );
    expect(`${content}\n${controller}\n${discovery}\n${observation}`).not.toContain(
      "TextDecoder",
    );
    expect(background).toContain("bytes += event.data.byteLength;");
    expect(background).toContain("filter.write(event.data);");
    expect(background).not.toContain("elatura:set-slim-mode");
  });

  it("keeps live slimming locked behind the existing non-authorizing safety state", () => {
    const safety = read("extension/firefox/src/transform-safety.ts");
    const optIn = read("extension/firefox/src/transform-opt-in.ts");
    const popup = read("extension/firefox/src/popup.ts");
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const popupHtml = read("extension/firefox/static/popup.html");

    expect(safety).toContain("emergencyDisabled: true");
    expect(optIn).toContain("authorizesTransform: false");
    expect(popup).toContain("optIn.authorizesTransform === true");
    expect(controller).toContain("optIn.authorizesTransform !== true");
    expect(controller).toContain("live-authorization-disconnected");
    expect(popup).toContain("Transforms remain locked and unauthorized");
    expect(popupHtml).toContain("Live slim modes remain locked in this build");
    expect(popupHtml).toContain("Recording intent does not authorize a live page change");
  });

  it("writes recovery configuration before any destructive mode can run", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const setModeStart = controller.indexOf("async function setSlimMode");
    const writeIndex = controller.indexOf("writeSessionConfig(config)", setModeStart);
    const modeIndex = controller.indexOf("runtimeState.mode = mode", setModeStart);
    const observerIndex = controller.indexOf("startObserver();", setModeStart);
    const scheduleIndex = controller.indexOf("scheduleApply(0)", setModeStart);

    expect(setModeStart).toBeGreaterThanOrEqual(0);
    expect(writeIndex).toBeGreaterThan(setModeStart);
    expect(modeIndex).toBeGreaterThan(writeIndex);
    expect(observerIndex).toBeGreaterThan(modeIndex);
    expect(scheduleIndex).toBeGreaterThan(observerIndex);
    expect(controller).toContain("for (const element of elements) element.remove();");
    expect(controller).not.toContain("DocumentFragment");
    expect(controller).not.toContain("cloneNode");
  });

  it("clears recovery state and disconnects observation before fail-open or Stock reloads", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const drift = read("extension/firefox/src/slim-discovery.ts");
    const failOpenStart = controller.indexOf("async function failOpen");
    const failOpenStop = controller.indexOf("stopObserver();", failOpenStart);
    const failOpenClear = controller.indexOf("clearSessionConfig();", failOpenStart);
    const failOpenReload = controller.indexOf("location.reload()", failOpenStart);
    const stockStart = controller.indexOf("async function restoreStock");
    const stockStop = controller.indexOf("stopObserver();", stockStart);
    const stockClear = controller.indexOf("clearSessionConfig();", stockStart);
    const stockReload = controller.indexOf("location.reload()", stockStart);

    expect(failOpenStop).toBeGreaterThan(failOpenStart);
    expect(failOpenClear).toBeGreaterThan(failOpenStop);
    expect(failOpenReload).toBeGreaterThan(failOpenClear);
    expect(stockStop).toBeGreaterThan(stockStart);
    expect(stockClear).toBeGreaterThan(stockStop);
    expect(stockReload).toBeGreaterThan(stockClear);
    expect(controller).toContain("placeholder-budget-exceeded");
    expect(drift).toContain("DEFAULT_SLIM_DRIFT_FAILURE_LIMIT = 3");
  });

  it("uses bounded live discovery and connected-element mounted counts", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const discovery = read("extension/firefox/src/slim-live-discovery.ts");
    const observation = read("extension/firefox/src/slim-live-observation.ts");
    const policy = read("extension/firefox/src/slim-discovery.ts");

    expect(policy).toContain("MAX_SLIM_DISCOVERY_CANDIDATES = 10_000");
    expect(discovery).toContain("role-marker-budget-exceeded");
    expect(discovery).toContain("turn-container-budget-exceeded");
    expect(observation).toContain("ambiguous-role-markers");
    expect(discovery).toContain("buildSlimLiveObservation(roleNodes.length, observations)");
    expect(observation).toContain("validateAndGroupSlimDiscovery(pureCandidates)");
    expect(discovery).not.toMatch(/for \(let left[\s\S]*for \(let right/u);
    expect(controller).toContain("turn.element.isConnected");
    expect(controller).not.toContain("querySelectorAll('[data-testid^=\"conversation-turn-\"], article')");
  });

  it("does not observe the full page while Stock or locked", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const observerConstruction = controller.indexOf("slimObserver = new MutationObserver");
    const startFunction = controller.indexOf("function startObserver");
    const initialConfig = controller.indexOf("const initialConfig = readSessionConfig()");
    const initialAuthorization = controller.indexOf("transformAuthorization().then", initialConfig);
    const initialStart = controller.indexOf("startObserver();", initialAuthorization);

    expect(observerConstruction).toBeGreaterThan(startFunction);
    expect(controller).toContain("let slimObserver: MutationObserver | null = null");
    expect(controller).toContain("function stopObserver");
    expect(initialStart).toBeGreaterThan(initialAuthorization);
    expect(controller).not.toMatch(/const slimObserver = new MutationObserver/u);
  });

  it("uses time-based route drift decisions rather than raw mutation counts", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");

    expect(controller).toContain('kind: "route-changed"');
    expect(controller).toContain('kind: "discovery-failed"');
    expect(controller).toContain('kind: "discovery-succeeded"');
    expect(controller).toContain('kind: "mode-applied"');
    expect(controller).toContain('decision.status === "grace"');
    expect(controller).not.toContain("driftFailures += 1");
  });

  it("makes revocation and emergency disable request Stock restoration", () => {
    const popup = read("extension/firefox/src/popup.ts");

    expect(popup.match(/elatura:restore-stock/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(popup).toContain("elatura:revoke-transform-opt-in");
    expect(popup).toContain("elatura:emergency-disable-transforms");
  });

  it("keeps the pure planner bounded and selector independent", () => {
    const planner = read("extension/firefox/src/slim-window.ts");

    expect(planner).toContain("MAX_SLIM_TURN_GROUPS = 8");
    expect(planner).toContain("MAX_SLIM_TURN_DESCRIPTORS = 10_000");
    expect(planner).toContain("noncontiguous-group");
    expect(planner).toContain("streamingGroups");
    expect(planner).not.toMatch(/querySelector|HTMLElement|data-testid/u);
  });
});
