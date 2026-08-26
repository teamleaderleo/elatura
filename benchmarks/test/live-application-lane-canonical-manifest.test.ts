// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const generator = join(repoRoot, "scripts", "generate-google-docs-workload.mjs");
const createPlan = join(repoRoot, "scripts", "create-live-application-lane-plan.mjs");
const verifyPlan = join(repoRoot, "scripts", "verify-live-application-lane-plan.mjs");
const CANONICAL_MANIFEST_SHA256 =
  "sha256:1090f44d5f0d906b9d2557d70db69e99fef0809c2636cc02d3bc3f3405c28898";

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function planArgs(manifestPath: string): string[] {
  return [
    "--edge-version", "140.0", "--edge-build", "edge-build-1",
    "--chrome-version", "140.0", "--chrome-build", "chrome-build-1",
    "--chromium-version", "140.0", "--chromium-build", "chromium-build-1",
    "--firefox-version", "142.0", "--firefox-build", "firefox-build-1",
    "--elatura-revision", "canonical-manifest-test",
    "--firefox-intervention", "latest3-v1",
    "--chromium-intervention", "parking-v1",
    "--chromium-transport", "extension-only",
    "--gdocs-manifest", manifestPath,
  ];
}

describe("live-lane canonical Google Docs manifest identity", () => {
  it("pins the exact #122 manifest digest and refuses a hand-edited plan digest", () => {
    const root = mkdtempSync(join(tmpdir(), "elatura-gdocs-canonical-"));
    try {
      const generated = spawnSync(process.execPath, [generator, "--out", root], {
        encoding: "utf8",
      });
      expect(generated.status, generated.stderr).toBe(0);

      const manifestPath = join(root, "manifest.json");
      const manifestBytes = readFileSync(manifestPath);
      expect(sha256(manifestBytes)).toBe(CANONICAL_MANIFEST_SHA256);

      const planned = spawnSync(
        process.execPath,
        [createPlan, ...planArgs(manifestPath)],
        { encoding: "utf8" },
      );
      expect(planned.status, planned.stderr).toBe(0);
      const plan = JSON.parse(planned.stdout) as {
        fixtures: { googleDocs: { manifestSha256: string } };
      };
      expect(plan.fixtures.googleDocs.manifestSha256).toBe(CANONICAL_MANIFEST_SHA256);

      const planPath = join(root, "plan.json");
      writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      const verified = spawnSync(process.execPath, [verifyPlan, planPath], {
        encoding: "utf8",
      });
      expect(verified.status, verified.stderr).toBe(0);

      plan.fixtures.googleDocs.manifestSha256 = `sha256:${"0".repeat(64)}`;
      writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      const rewritten = spawnSync(process.execPath, [verifyPlan, planPath], {
        encoding: "utf8",
      });
      expect(rewritten.status).toBe(2);
      expect(rewritten.stdout).toContain("gdocs-manifest-sha256-mismatch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
