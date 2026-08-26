// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

function substituteFile(
  root: string,
  fileName: string,
  documentOrdinal: number,
  paragraphCount: number,
  textCodeUnits: number,
  fillByte: number,
) {
  const bytes = Buffer.alloc(textCodeUnits, fillByte);
  writeFileSync(join(root, fileName), bytes);
  return {
    fileName,
    documentOrdinal,
    paragraphCount,
    anchorCount: 10,
    textCodeUnits,
    sha256: sha256(bytes),
  };
}

function writeSelfConsistentSubstitute(root: string): string {
  const large = substituteFile(
    root,
    "docs-large-text-v1.txt",
    0,
    4_800,
    772_800,
    0x61,
  );
  const switchFiles = Array.from({ length: 8 }, (_, index) =>
    substituteFile(
      root,
      `docs-switch-8-v1-${String(index + 1).padStart(2, "0")}.txt`,
      index,
      1_800,
      289_800,
      0x62 + index,
    ),
  );
  const manifest = {
    schemaVersion: 1,
    generator: "google-docs-workload-v1",
    fixtures: [
      { id: "docs-large-text-v1", files: [large] },
      { id: "docs-switch-8-v1", files: switchFiles },
    ],
  };
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

describe("live-lane Google Docs fixture identity", () => {
  it("rejects a self-consistent same-name substitute fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "elatura-gdocs-substitute-"));
    try {
      const manifestPath = writeSelfConsistentSubstitute(root);
      const planned = spawnSync(
        process.execPath,
        [createPlanScript, ...planArgs(manifestPath)],
        { encoding: "utf8" },
      );
      expect(planned.status).toBe(2);
      expect(planned.stderr).toContain(
        "file identity mismatch for docs-large-text-v1.txt",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
