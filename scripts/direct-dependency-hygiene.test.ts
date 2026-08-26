// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf8")) as Record<string, any>;
}

describe("direct dependency hygiene", () => {
  it("declares the AJV package imported by root benchmark tooling directly", () => {
    const packageJson = readJson("package.json");
    const lock = readJson("package-lock.json");
    const liveLaneUtils = readFileSync(
      resolve(ROOT, "scripts/live-application-lane-utils.mjs"),
      "utf8",
    );

    expect(liveLaneUtils).toContain('from "ajv/dist/2020.js"');
    expect(packageJson.devDependencies?.ajv).toBe("8.20.0");
    expect(lock.packages?.[""]?.devDependencies?.ajv).toBe("8.20.0");
    expect(lock.packages?.["node_modules/ajv"]?.version).toBe("8.20.0");
  });
});
