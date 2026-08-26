// SPDX-License-Identifier: MPL-2.0
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = join(ROOT, "packages");

type ConditionalExport = Readonly<{
  types?: unknown;
  default?: unknown;
}>;

type PackageManifest = Readonly<{
  name?: unknown;
  private?: unknown;
  type?: unknown;
  exports?: unknown;
  types?: unknown;
}>;

type ExportTarget = Readonly<{
  exportKey: string;
  runtimePath: string;
  typesPath: string;
}>;

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function packageDirectories(): string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES, entry.name))
    .filter((directory) => existsSync(join(directory, "package.json")))
    .sort();
}

function safeRelativeTarget(value: unknown, label: string): string {
  expect(typeof value, label).toBe("string");
  const target = value as string;
  expect(target.startsWith("./dist/"), label).toBe(true);
  expect(target.includes("\\"), label).toBe(false);
  expect(target.split("/").includes(".."), label).toBe(false);
  return target;
}

function stemFromRuntime(target: string): string {
  expect(extname(target)).toBe(".js");
  return target.slice("./dist/".length, -".js".length);
}

function stemFromTypes(target: string): string {
  expect(target.endsWith(".d.ts")).toBe(true);
  return target.slice("./dist/".length, -".d.ts".length);
}

function conditionalTarget(
  packageDirectory: string,
  exportKey: string,
  value: unknown,
): ExportTarget {
  expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
  const record = value as ConditionalExport;
  const runtimePath = safeRelativeTarget(
    record.default,
    `${basename(packageDirectory)} ${exportKey} runtime export`,
  );
  const typesPath = safeRelativeTarget(
    record.types,
    `${basename(packageDirectory)} ${exportKey} type export`,
  );
  expect(stemFromTypes(typesPath)).toBe(stemFromRuntime(runtimePath));
  return Object.freeze({ exportKey, runtimePath, typesPath });
}

function packageExportTargets(
  packageDirectory: string,
  manifest: PackageManifest,
): readonly ExportTarget[] {
  if (typeof manifest.exports === "string") {
    const runtimePath = safeRelativeTarget(
      manifest.exports,
      `${basename(packageDirectory)} root runtime export`,
    );
    const typesPath = safeRelativeTarget(
      manifest.types,
      `${basename(packageDirectory)} root type export`,
    );
    expect(stemFromTypes(typesPath)).toBe(stemFromRuntime(runtimePath));
    return Object.freeze([{ exportKey: ".", runtimePath, typesPath }]);
  }

  expect(
    manifest.exports !== null &&
      typeof manifest.exports === "object" &&
      !Array.isArray(manifest.exports),
  ).toBe(true);
  const exportsMap = manifest.exports as Record<string, unknown>;
  return Object.freeze(
    Object.entries(exportsMap)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([exportKey, value]) => {
        expect(exportKey === "." || /^\.\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(exportKey)).toBe(true);
        return conditionalTarget(packageDirectory, exportKey, value);
      }),
  );
}

function sourcePathFor(packageDirectory: string, runtimePath: string): string {
  const stem = stemFromRuntime(runtimePath);
  const source = normalize(join(packageDirectory, "src", `${stem}.ts`));
  expect(source.startsWith(`${join(packageDirectory, "src")}${sep}`)).toBe(true);
  return source;
}

describe("workspace package export surfaces", () => {
  it("maps every advertised runtime/type export to one real source module", () => {
    const directories = packageDirectories();
    expect(directories.length).toBeGreaterThan(0);

    for (const directory of directories) {
      const manifest = readJson(join(directory, "package.json"));
      expect(typeof manifest.name).toBe("string");
      expect(manifest.private).toBe(true);
      expect(manifest.type).toBe("module");

      const targets = packageExportTargets(directory, manifest);
      expect(targets.length, `${manifest.name} exports`).toBeGreaterThan(0);

      const runtimeTargets = new Set<string>();
      const typeTargets = new Set<string>();
      for (const target of targets) {
        expect(runtimeTargets.has(target.runtimePath), `${manifest.name} duplicate runtime target`).toBe(false);
        expect(typeTargets.has(target.typesPath), `${manifest.name} duplicate type target`).toBe(false);
        runtimeTargets.add(target.runtimePath);
        typeTargets.add(target.typesPath);

        expect(
          existsSync(sourcePathFor(directory, target.runtimePath)),
          `${manifest.name} ${target.exportKey} source module`,
        ).toBe(true);
      }

      if (typeof manifest.types === "string" && typeof manifest.exports !== "string") {
        const root = targets.find((target) => target.exportKey === ".");
        expect(root, `${manifest.name} root export`).toBeDefined();
        expect(manifest.types).toBe(root?.typesPath);
      }
    }
  });
});
