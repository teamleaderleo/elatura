// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox ChatGPT activity diagnostic export boundary", () => {
  it("wires one explicit canonical diagnostic export control into the existing popup", () => {
    const html = read("extension/firefox/static/popup.html");
    const popup = read("extension/firefox/src/chatgpt-lane-activity-diagnostic-popup.ts");

    expect(html).toContain('id="activity-diagnostic-export"');
    expect(html).toContain('id="activity-diagnostic-status"');
    expect(html).toContain('src="chatgpt-lane-activity-diagnostic-popup.js"');
    expect(popup).toContain('#activity-diagnostic-export');
    expect(popup).toContain('#activity-diagnostic-status');
    expect(popup).toContain('ownData(response, "observation")');
    expect(popup).toContain("admitFirefoxChatGptActivityDiagnosticV1");
  });

  it("keeps canonical adapter imports outside the shipped Firefox production graph", () => {
    const popup = read("extension/firefox/src/chatgpt-lane-activity-diagnostic-popup.ts");
    const admission = read("extension/firefox/src/chatgpt-lane-activity-diagnostic.ts");

    expect(`${popup}\n${admission}`).not.toContain("@elatura/adapter-chatgpt");
    expect(admission).toContain("parseFirefoxChatGptActivityWireObservationV1");
  });

  it("keeps the diagnostic binding volatile and adds no network, storage, or lifecycle effect", () => {
    const popup = read("extension/firefox/src/chatgpt-lane-activity-diagnostic-popup.ts");

    expect(popup).toContain(
      "let diagnosticBinding: FirefoxChatGptActivityPanelBindingV1 | null = null;",
    );
    expect(popup).not.toMatch(/\bbrowser\.storage\b/u);
    expect(popup).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/u);
    expect(popup).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(popup).not.toMatch(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u);
    expect(popup).not.toMatch(/\b(?:discard|freeze|reload)\s*\(/u);
  });

  it("uses the active tab only from the operator bind action and clears on target edits", () => {
    const popup = read("extension/firefox/src/chatgpt-lane-activity-diagnostic-popup.ts");
    const bindStart = popup.indexOf("async function bindDiagnosticToActivePage");
    const activeTab = popup.indexOf("const tabId = await activeTabId();", bindStart);
    const discovery = popup.indexOf(
      "createFirefoxChatGptActivityPanelDiscoveryMessageV1(tabId, correlation)",
      bindStart,
    );

    expect(bindStart).toBeGreaterThanOrEqual(0);
    expect(activeTab).toBeGreaterThan(bindStart);
    expect(discovery).toBeGreaterThan(activeTab);
    expect(popup.match(/Lane target changed; bind again before diagnostic export/gu)?.length).toBe(2);
  });
});
