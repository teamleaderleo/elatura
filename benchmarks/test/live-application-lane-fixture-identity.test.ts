// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const generateDocsScript = join(repoRoot, "scripts", "generate-google-docs-workload.mjs");
const createPlanScript = join(repoRoot, "scripts", "create-live-application-lane-plan.mjs");

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function planArgs(manifestPath: string): string[] {
  return [
    "--edge-version", "140.0", "--edge-build", "edge-build-1",
    "--chrome-version", "140.0", "--chrome-build", "chrome-build-1",
    "--chromium-version", "140.0", "--chromium-build", "chromium-build-1",
    "--firefox-version", "142.0", "--firefox-build", "firefox-build-1",
    "--elatura-revision", "fixture-test-revision",
    "--firefox-intervention", "latest3-v1",
    "--chromium-intervention", "parking-v1",
    "--chromium-transport", "extension-only",
    "--gdocs-manifest", manifestPath,
  ];
}

describe("live-lane Google Docs fixture identity", () => {
  it("rejects a self-consistent same-name substitute fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "elatura-gdocs-substitute-"));
    try {
      const generated = spawnSync(
        process.execPath,
        [generateDocsScript, "--out", root],
        { encoding: "utf8" },
      );
      expect(generated.status, generated.stderr).toBe(0);

      const manifestPath = join(root, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        fixtures: Array<{
          id: string;
          files: Array<{ fileName: string; sha256: string }>;
        }>;
      };
      const switchFixture = manifest.fixtures.find(
        (fixture) => fixture.id === "docs-switch-8-v1",
      );
      if (switchFixture === undefined) throw new Error("generated switch fixture missing");
      const target = switchFixture.files[3];
      if (target === undefined) throw new Error("generated switch document missing");

      const targetPath = join(root, target.fileName);
      const bytes = readFileSync(targetPath);
      bytes[0] = bytes[0] === 69 ? 70 : 69;
      writeFileSync(targetPath, bytes);

      // Rewrite the supplied manifest so it truthfully describes the modified
      // bytes. The packet is internally self-consistent; only the canonical
      // #122 generator identity can distinguish it from the reviewed fixture.
      target.sha256 = sha256(bytes);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const planned = spawnSync(
        process.execPath,
        [createPlanScript, ...planArgs(manifestPath)],
        { encoding: "utf8" },
      );
      expect(planned.status).toBe(2);
      expect(planned.stderr).toContain(
        `file identity mismatch for ${target.fileName}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
