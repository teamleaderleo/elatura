// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox slim DOM fixtures", () => {
  it("uses a content-free observation vocabulary", () => {
    const observation = read("extension/firefox/src/slim-live-observation.ts");
    const fixtures = read("extension/firefox/test/fixtures/slim-live-layouts.ts");
    const manifest = JSON.parse(read("benchmarks/slim-dom-fixtures.json")) as {
      contentPolicy: Record<string, boolean>;
      observationFields: string[];
    };

    expect(manifest.observationFields).toEqual([
      "containerId",
      "parentToken",
      "documentOrder",
      "roleValues",
      "streaming",
      "estimatedBlockSizePx",
    ]);
    expect(Object.values(manifest.contentPolicy).every((value) => value === false)).toBe(true);
    expect(observation).not.toMatch(/title|body|markdown|attachment|innerHTML|outerHTML|textContent/u);
    expect(fixtures).not.toMatch(/messageText|messageBody|conversationTitle|innerHTML|outerHTML/u);
  });

  it("routes the live adapter through the same fixture seam", () => {
    const live = read("extension/firefox/src/slim-live-discovery.ts");
    const observation = read("extension/firefox/src/slim-live-observation.ts");

    expect(live).toContain('from "./slim-live-observation.js"');
    expect(live).toContain("buildSlimLiveObservation(roleNodes.length, observations)");
    expect(observation).toContain("validateAndGroupSlimDiscovery(pureCandidates)");
    expect(observation).toContain("marker-count-mismatch");
    expect(observation).toContain("duplicate-container-id");
  });

  it("keeps fixtures disconnected from live authority and response handling", () => {
    const observation = read("extension/firefox/src/slim-live-observation.ts");
    const fixtures = read("extension/firefox/test/fixtures/slim-live-layouts.ts");
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const background = read("extension/firefox/src/background.ts");
    const combined = `${observation}\n${fixtures}`;

    expect(combined).not.toMatch(/\bbrowser\./u);
    expect(combined).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(controller).toContain("optIn.authorizesTransform !== true");
    expect(background).toContain("filter.write(event.data);");
  });

  it("covers ordinary, streaming, noisy, and fail-closed layouts", () => {
    const fixtures = read("extension/firefox/test/fixtures/slim-live-layouts.ts");
    const tests = read("extension/firefox/test/slim-live-observation.test.ts");

    for (const name of [
      "ordinaryFivePairLayout",
      "streamingLayout",
      "providerNoiseLayout",
      "ignoredMarkerLayout",
      "ambiguousRoleLayout",
      "splitParentLayout",
      "outOfOrderLayout",
      "missingParentLayout",
      "duplicateContainerIdLayout",
      "markerCountMismatchLayout",
    ]) {
      expect(fixtures).toContain(`export const ${name}`);
      expect(tests).toContain(name);
    }
    expect(tests).toContain('planSlimWindow(observed.turns, "latest-window", 3)');
    expect(tests).toContain('planSlimWindow(observed.turns, "latest-window", 1)');
  });
});
