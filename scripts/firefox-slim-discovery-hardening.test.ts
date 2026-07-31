// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox slim discovery hardening", () => {
  it("keeps the discovery policy selector and content independent", () => {
    const policy = read("extension/firefox/src/slim-discovery.ts");

    expect(policy).not.toMatch(/querySelector|HTMLElement|\bElement\b|Node\./u);
    expect(policy).not.toMatch(/textContent|innerText|outerHTML|data-message-author-role/u);
    expect(policy).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(policy).not.toMatch(/\bbrowser\./u);
  });

  it("pins linear bounded candidate validation", () => {
    const policy = read("extension/firefox/src/slim-discovery.ts");

    expect(policy).toContain("MAX_SLIM_DISCOVERY_CANDIDATES = 10_000");
    expect(policy).toContain("candidate-budget-exceeded");
    expect(policy).toContain("for (let index = 0; index < candidates.length; index += 1)");
    expect(policy).not.toMatch(/for \([^\n]*candidates[\s\S]{0,300}for \(/u);
    expect(policy).toContain("turn-parent-mismatch");
    expect(policy).toContain("turn-order-ambiguous");
    expect(policy).toContain("duplicate-candidate-id");
  });

  it("normalizes provider roles into a fixed local vocabulary", () => {
    const policy = read("extension/firefox/src/slim-discovery.ts");

    expect(policy).toContain('"user" | "assistant" | "tool" | "system" | "unknown"');
    expect(policy).toContain('return validRole(normalized) ? normalized : "unknown"');
    expect(policy).toContain("unsupported-role-set");
  });

  it("uses time-based route grace and a bounded consecutive failure limit", () => {
    const policy = read("extension/firefox/src/slim-discovery.ts");

    expect(policy).toContain("DEFAULT_SLIM_ROUTE_GRACE_MS = 1_500");
    expect(policy).toContain("DEFAULT_SLIM_DRIFT_FAILURE_LIMIT = 3");
    expect(policy).toContain("event.atMs - state.routeChangedAtMs < routeGraceMs");
    expect(policy).toContain("consecutiveFailures >= failureLimit");
    expect(policy).toContain('status: shouldFailOpen ? "failed-open" : "drifted"');
  });

  it("integrates policy through the observation seam without altering live authority", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const adapter = read("extension/firefox/src/slim-live-discovery.ts");
    const observation = read("extension/firefox/src/slim-live-observation.ts");
    const safety = read("extension/firefox/src/transform-safety.ts");
    const optIn = read("extension/firefox/src/transform-opt-in.ts");

    expect(controller).toContain('from "./slim-discovery.js"');
    expect(controller).toContain('from "./slim-live-discovery.js"');
    expect(adapter).toContain('from "./slim-live-observation.js"');
    expect(adapter).toContain("buildSlimLiveObservation(roleNodes.length, observations)");
    expect(observation).toContain("validateAndGroupSlimDiscovery(pureCandidates)");
    expect(controller).toContain("optIn.authorizesTransform !== true");
    expect(safety).toContain("emergencyDisabled: true");
    expect(optIn).toContain("authorizesTransform: false");
  });
});
