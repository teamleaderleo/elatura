// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function packageJson(): {
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  return JSON.parse(read("package.json")) as {
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

describe("developer workflow", () => {
  it("keeps the recommended Node line aligned with hosted CI", () => {
    expect(read(".nvmrc").trim()).toBe("22");
    expect(packageJson().engines?.node).toBe(">=22");
    expect(read(".github/workflows/ci.yml")).toMatch(/node-version:\s*22\b/u);
  });

  it("keeps the code-only inner loop narrower than the complete merge gate", () => {
    const scripts = packageJson().scripts ?? {};
    expect(scripts["check:code"]).toBe("npm run typecheck && npm run test");
    expect(scripts.check).toContain("npm run security:gate");
    expect(scripts.check).toContain("npm run typecheck");
    expect(scripts.check).toContain("npm run test");
    expect(scripts.check).toContain("npm run lint:extension");
    expect(scripts.check).toContain("npm run release:candidate:smoke");
    expect(scripts["check:code"]).not.toContain("release:candidate:smoke");
  });

  it("documents the frozen benchmark progress/readiness authority split", () => {
    const workflow = read("docs/developer-workflow.md");
    expect(workflow).toContain("live-lane:next");
    expect(workflow).toContain("live-lane:check");
    expect(workflow).toContain('`live-lane:next` is progress guidance only');
    expect(workflow).toContain('`live-lane:check` owns stage/full evidence readiness');
  });

  it("keeps the README on the current developer and application-lane entry points", () => {
    const readme = read("README.md");
    expect(readme).toContain("docs/developer-workflow.md");
    expect(readme).toContain("npm run check:code");
    expect(readme).toContain("live-lane:next");
    expect(readme).toContain("benchmark:chatgpt-activity");
    expect(readme).toContain("extension/chromium/");
  });
});
