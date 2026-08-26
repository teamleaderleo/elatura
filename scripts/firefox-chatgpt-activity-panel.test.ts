// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

const PANEL_IDS = [
  "activity-lane-ref",
  "activity-lane-generation",
  "activity-bind",
  "activity-sample",
  "activity-binding",
  "activity-confidence",
  "activity-generation",
  "activity-composer",
  "activity-composition",
  "activity-modal",
  "activity-media",
  "activity-download",
  "activity-transient",
  "activity-panel-status",
] as const;

describe("Firefox ChatGPT activity popup panel boundary", () => {
  it("keeps popup markup and TypeScript wiring in lockstep", () => {
    const html = read("extension/firefox/static/popup.html");
    const popup = read("extension/firefox/src/popup.ts");

    for (const id of PANEL_IDS) {
      expect(html).toContain(`id="${id}"`);
      expect(popup).toContain(`#${id}`);
    }
    expect(html).toContain("Volatile diagnostics only");
    expect(html).toContain("Closing the popup clears the private binding");
  });

  it("holds the activity binding only in volatile popup memory", () => {
    const popup = read("extension/firefox/src/popup.ts");
    const panel = read("extension/firefox/src/chatgpt-lane-activity-panel.ts");
    const surface = `${popup}\n${panel}`;

    expect(popup).toContain(
      "let activityPanelBinding: FirefoxChatGptActivityPanelBindingV1 | null = null;",
    );
    expect(surface).not.toMatch(/\bbrowser\.storage\b/u);
    expect(surface).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/u);
    expect(surface).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(surface).not.toMatch(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u);
  });

  it("keeps the private document projection out of popup rendering code", () => {
    const popup = read("extension/firefox/src/popup.ts");
    const panel = read("extension/firefox/src/chatgpt-lane-activity-panel.ts");

    expect(popup).not.toContain("documentProjectionRef");
    expect(panel).toContain("documentProjectionRef");
    expect(panel).toContain("status: \"stale\", binding: null");
  });

  it("clears the binding when the lane target changes or a sample goes stale", () => {
    const popup = read("extension/firefox/src/popup.ts");

    expect(popup.match(/clearActivityPanelBinding\("Lane target changed/gu)?.length).toBe(2);
    expect(popup).toContain('if (result.status === "stale")');
    expect(popup).toContain("activityPanelBinding = result.binding;");
    expect(popup).toContain('setActivityBindingState("unbound")');
  });

  it("uses the explicit active-tab operator action only to start discovery", () => {
    const popup = read("extension/firefox/src/popup.ts");
    const bindStart = popup.indexOf("async function bindActivityPanelToActivePage");
    const activeTab = popup.indexOf("const tabId = await activeTabId();", bindStart);
    const discovery = popup.indexOf(
      "createFirefoxChatGptActivityPanelDiscoveryMessageV1(tabId, requestRef)",
      bindStart,
    );

    expect(bindStart).toBeGreaterThanOrEqual(0);
    expect(activeTab).toBeGreaterThan(bindStart);
    expect(discovery).toBeGreaterThan(activeTab);
  });

  it("adds no externally connectable or host-permission surface", () => {
    const manifest = JSON.parse(
      read("extension/firefox/static/manifest.json"),
    ) as Record<string, unknown>;

    expect(Object.hasOwn(manifest, "externally_connectable")).toBe(false);
    expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
  });
});
