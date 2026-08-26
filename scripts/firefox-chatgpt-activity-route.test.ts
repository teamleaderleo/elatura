// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox ChatGPT activity route browser boundary", () => {
  it("discovers and samples only an explicit tab id", () => {
    const background = read("extension/firefox/src/background.ts");

    expect(background.match(/browser\.tabs\.sendMessage\(request\.tabId/gu)?.length).toBe(2);
    expect(background).toContain("laneRef: request.laneRef");
    expect(background).toContain("laneGeneration: request.laneGeneration");
    expect(background).toContain("documentProjectionRef: request.documentProjectionRef");
    expect(background).not.toContain("browser.tabs.query(");
  });

  it("refuses discovery and sample routing requests originating from content scripts", () => {
    const background = read("extension/firefox/src/background.ts");
    const discoveryParse = background.indexOf(
      "parseFirefoxChatGptDocumentProjectionRouteMessageV1(message)",
    );
    const discoveryFence = background.indexOf("sender?.tab?.id !== undefined", discoveryParse);
    const discoveryCall = background.indexOf(
      "discoverChatGptDocumentProjectionOnTab(documentProjectionRequest)",
      discoveryParse,
    );
    const sampleParse = background.indexOf("parseFirefoxChatGptActivityRouteMessageV2(message)");
    const sampleFence = background.indexOf("sender?.tab?.id !== undefined", sampleParse);
    const sampleCall = background.indexOf(
      "sampleChatGptLaneActivityOnTab(activityRequest)",
      sampleParse,
    );

    expect(discoveryParse).toBeGreaterThanOrEqual(0);
    expect(discoveryFence).toBeGreaterThan(discoveryParse);
    expect(discoveryCall).toBeGreaterThan(discoveryFence);
    expect(sampleParse).toBeGreaterThan(discoveryCall);
    expect(sampleFence).toBeGreaterThan(sampleParse);
    expect(sampleCall).toBeGreaterThan(sampleFence);
  });

  it("keeps the pure route free of browser, storage, network, and logging sinks", () => {
    const route = read("extension/firefox/src/chatgpt-lane-activity-route.ts");

    expect(route).not.toMatch(/\bbrowser\./u);
    expect(route).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(route).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/u);
    expect(route).not.toMatch(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/u);
    expect(route).not.toMatch(/\b(?:url|title|transcript|prompt|answer|cookie|credential)\b/iu);
  });

  it("keeps background and content producer on fixed discovery and sample wire messages", () => {
    const route = read("extension/firefox/src/chatgpt-lane-activity-route.ts");
    const producer = read("extension/firefox/src/chatgpt-lane-activity-producer.ts");

    const routeSampleWire = route.match(
      /FIREFOX_CHATGPT_ACTIVITY_CONTENT_MESSAGE_TYPE\s*=\s*\n?\s*"([^"]+)"/u,
    )?.[1];
    const producerSampleWire = producer.match(
      /FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE\s*=\s*\n?\s*"([^"]+)"/u,
    )?.[1];
    const routeDiscoveryWire = route.match(
      /FIREFOX_CHATGPT_DOCUMENT_PROJECTION_CONTENT_MESSAGE_TYPE\s*=\s*\n?\s*"([^"]+)"/u,
    )?.[1];
    const producerDiscoveryWire = producer.match(
      /FIREFOX_CHATGPT_DOCUMENT_PROJECTION_MESSAGE_TYPE\s*=\s*\n?\s*"([^"]+)"/u,
    )?.[1];

    expect(routeSampleWire).toBe("elatura:sample-chatgpt-lane-activity");
    expect(producerSampleWire).toBe(routeSampleWire);
    expect(routeDiscoveryWire).toBe("elatura:get-chatgpt-document-projection");
    expect(producerDiscoveryWire).toBe(routeDiscoveryWire);
  });

  it("keeps the private local route key out of producer responses and artifacts", () => {
    const producer = read("extension/firefox/src/chatgpt-lane-activity-producer.ts");

    expect(producer).toContain("return documentRef.URL;");
    expect(producer).toContain("The URL is used only as a private local route-change detector");
    expect(producer).not.toMatch(/(?:laneRef|documentProjectionRef):\s*documentRef\.URL/u);
  });

  it("keeps the runtime route extension-internal", () => {
    const manifest = JSON.parse(
      read("extension/firefox/static/manifest.json"),
    ) as Record<string, unknown>;

    expect(Object.hasOwn(manifest, "externally_connectable")).toBe(false);
    expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
  });
});
