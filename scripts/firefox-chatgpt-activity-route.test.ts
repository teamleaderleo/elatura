// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox ChatGPT activity route browser boundary", () => {
  it("routes only an explicit tab id and exact lane target", () => {
    const background = read("extension/firefox/src/background.ts");

    expect(background).toContain("browser.tabs.sendMessage(request.tabId");
    expect(background).toContain("laneRef: request.laneRef");
    expect(background).toContain("laneGeneration: request.laneGeneration");
    expect(background).not.toContain("browser.tabs.query(");
  });

  it("refuses cross-tab route requests originating from content scripts", () => {
    const background = read("extension/firefox/src/background.ts");
    const parseIndex = background.indexOf("parseFirefoxChatGptActivityRouteMessageV1(message)");
    const senderFence = background.indexOf("sender?.tab?.id !== undefined", parseIndex);
    const routeCall = background.indexOf("sampleChatGptLaneActivityOnTab(activityRequest)", parseIndex);

    expect(parseIndex).toBeGreaterThanOrEqual(0);
    expect(senderFence).toBeGreaterThan(parseIndex);
    expect(routeCall).toBeGreaterThan(senderFence);
  });

  it("keeps the pure route free of browser, storage, network, and logging sinks", () => {
    const route = read("extension/firefox/src/chatgpt-lane-activity-route.ts");

    expect(route).not.toMatch(/\bbrowser\./u);
    expect(route).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(route).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/u);
    expect(route).not.toMatch(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u);
    expect(route).not.toMatch(/\b(?:url|title|transcript|prompt|answer|cookie|credential)\b/iu);
  });

  it("keeps the background and content producer on one fixed wire message", () => {
    const route = read("extension/firefox/src/chatgpt-lane-activity-route.ts");
    const producer = read("extension/firefox/src/chatgpt-lane-activity-producer.ts");

    const routeWire = route.match(
      /FIREFOX_CHATGPT_ACTIVITY_CONTENT_MESSAGE_TYPE\s*=\s*\n?\s*"([^"]+)"/u,
    )?.[1];
    const producerWire = producer.match(
      /FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE\s*=\s*\n?\s*"([^"]+)"/u,
    )?.[1];

    expect(routeWire).toBe("elatura:sample-chatgpt-lane-activity");
    expect(producerWire).toBe(routeWire);
  });

  it("keeps the runtime route extension-internal", () => {
    const manifest = JSON.parse(
      read("extension/firefox/static/manifest.json"),
    ) as Record<string, unknown>;

    expect(Object.hasOwn(manifest, "externally_connectable")).toBe(false);
    expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
  });
});
