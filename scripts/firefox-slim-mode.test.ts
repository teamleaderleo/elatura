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
        resources: ["slim-window.js"],
        matches: ["https://chatgpt.com/*"],
      },
    ]);
  });

  it("keeps page content out of storage, logs, and network sinks", () => {
    const content = read("extension/firefox/src/content.ts");

    expect(content).not.toMatch(/\bbrowser\.storage\b/u);
    expect(content).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(content).not.toMatch(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u);
    expect(content).not.toMatch(/(?:roleNode|candidate|turn\.element)\.textContent/u);
    expect(content).not.toMatch(/\.(?:innerText|outerHTML)\b/u);
    expect(content).toContain('import(browser.runtime.getURL("slim-window.js"))');
  });

  it("does not add any response-transform path", () => {
    const content = read("extension/firefox/src/content.ts");
    const background = read("extension/firefox/src/background.ts");

    expect(content).not.toContain("filterResponseData");
    expect(content).not.toContain("TextDecoder");
    expect(background).toContain("bytes += event.data.byteLength;");
    expect(background).toContain("filter.write(event.data);");
    expect(background).not.toContain("elatura:set-slim-mode");
  });

  it("keeps live slimming locked behind the existing non-authorizing safety state", () => {
    const safety = read("extension/firefox/src/transform-safety.ts");
    const optIn = read("extension/firefox/src/transform-opt-in.ts");
    const popup = read("extension/firefox/src/popup.ts");
    const popupHtml = read("extension/firefox/static/popup.html");

    expect(safety).toContain("emergencyDisabled: true");
    expect(optIn).toContain("authorizesTransform: false");
    expect(popup).toContain("optIn.authorizesTransform === true");
    expect(popup).toContain("Slim modes remain locked");
    expect(popupHtml).toContain("Live slim modes remain locked in this build");
    expect(popupHtml).toContain("Recording intent does not authorize a live page change");
  });

  it("writes recovery configuration before any destructive mode can run", () => {
    const content = read("extension/firefox/src/content.ts");
    const setModeStart = content.indexOf("async function setSlimMode");
    const writeIndex = content.indexOf("writeSessionConfig(config)", setModeStart);
    const modeIndex = content.indexOf("runtimeState.mode = mode", setModeStart);
    const scheduleIndex = content.indexOf("scheduleApply(0)", setModeStart);

    expect(setModeStart).toBeGreaterThanOrEqual(0);
    expect(writeIndex).toBeGreaterThan(setModeStart);
    expect(modeIndex).toBeGreaterThan(writeIndex);
    expect(scheduleIndex).toBeGreaterThan(modeIndex);
    expect(content).toContain("for (const element of elements) element.remove();");
    expect(content).not.toContain("DocumentFragment");
    expect(content).not.toContain("cloneNode");
  });

  it("clears recovery state before fail-open and Stock reloads", () => {
    const content = read("extension/firefox/src/content.ts");
    const failOpenStart = content.indexOf("async function failOpen");
    const failOpenClear = content.indexOf("clearSessionConfig();", failOpenStart);
    const failOpenReload = content.indexOf("location.reload()", failOpenStart);
    const stockStart = content.indexOf("async function restoreStock");
    const stockClear = content.indexOf("clearSessionConfig();", stockStart);
    const stockReload = content.indexOf("location.reload()", stockStart);

    expect(failOpenClear).toBeGreaterThan(failOpenStart);
    expect(failOpenReload).toBeGreaterThan(failOpenClear);
    expect(stockClear).toBeGreaterThan(stockStart);
    expect(stockReload).toBeGreaterThan(stockClear);
    expect(content).toContain("placeholder-budget-exceeded");
    expect(content).toContain("DRIFT_FAILURE_LIMIT = 3");
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
