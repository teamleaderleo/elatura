// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Firefox slim DOM executor", () => {
  it("is provider, browser, and content independent", () => {
    const executor = read("extension/firefox/src/slim-dom-executor.ts");

    expect(executor).not.toMatch(/querySelector|HTMLElement|\bElement\b|Node\./u);
    expect(executor).not.toMatch(/textContent|innerText|outerHTML|data-message-author-role/u);
    expect(executor).not.toMatch(/\bbrowser\./u);
    expect(executor).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
  });

  it("finishes all resolution and budget checks before mutation", () => {
    const executor = read("extension/firefox/src/slim-dom-executor.ts");
    const preflightLoop = executor.indexOf("for (const range of ranges)");
    const projectedBudget = executor.indexOf("placeholderCountAfter > maximumPlaceholders");
    const mutationFlag = executor.indexOf("let mutationStarted = false");
    const executionLoop = executor.indexOf("for (const range of prepared)");

    expect(preflightLoop).toBeGreaterThanOrEqual(0);
    expect(projectedBudget).toBeGreaterThan(preflightLoop);
    expect(mutationFlag).toBeGreaterThan(projectedBudget);
    expect(executionLoop).toBeGreaterThan(mutationFlag);
    expect(executor).toContain("duplicate-turn-id");
    expect(executor).toContain("unresolved-turn");
    expect(executor).toContain("disconnected-turn");
    expect(executor).toContain("duplicate-turn-node");
    expect(executor).toContain("placeholder-budget-exceeded");
  });

  it("reports whether a host failure occurred after mutation began", () => {
    const executor = read("extension/firefox/src/slim-dom-executor.ts");
    const tests = read("extension/firefox/test/slim-dom-executor.test.ts");

    expect(executor).toContain("host-preflight-failed");
    expect(executor).toContain("host-mutation-failed");
    expect(executor).toContain("mutationStarted = true");
    expect(tests).toContain("partial host mutation");
    expect(tests).toContain("mutationStarted: true");
    expect(tests).toContain("preflights every range before the first mutation");
    expect(tests).toContain("mutationStarted: false");
  });

  it("does not alter the locked controller before the integration packet", () => {
    const controller = read("extension/firefox/src/slim-content-controller.ts");
    const optIn = read("extension/firefox/src/transform-opt-in.ts");

    expect(controller).not.toContain('from "./slim-dom-executor.js"');
    expect(controller).toContain("optIn.authorizesTransform !== true");
    expect(optIn).toContain("authorizesTransform: false");
  });
});
