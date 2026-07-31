// SPDX-License-Identifier: MPL-2.0
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe("Android stable private signing", () => {
  it("uses an owner-triggered protected environment rather than pull-request secrets", () => {
    const workflow = read(".github/workflows/android-notification-companion-stable.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("environment: android-signing");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("requires every signing input and never embeds private material in source", () => {
    const workflow = read(".github/workflows/android-notification-companion-stable.yml");
    const gradle = read("android/notification-companion/app/build.gradle.kts");
    const repositoryFiles = walk(ROOT).map((path) => basename(path).toLowerCase());

    for (const name of [
      "ELATURA_ANDROID_KEYSTORE_BASE64",
      "ELATURA_ANDROID_KEYSTORE_PASSWORD",
      "ELATURA_ANDROID_KEY_ALIAS",
      "ELATURA_ANDROID_KEY_PASSWORD",
      "ELATURA_ANDROID_CERT_SHA256",
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
    expect(workflow).toContain('test -n "${!name:-}"');
    expect(workflow).not.toContain("ELATURA_ANDROID_KEYSTORE_PASSWORD=${KEYSTORE_PASSWORD}");
    expect(workflow).not.toContain("ELATURA_ANDROID_KEY_PASSWORD=${KEY_PASSWORD}");
    expect(gradle).toContain('stableSigningRequested = elaturaSigningMode == "stable-private"');
    expect(gradle).toContain("requireNotNull(stableKeystorePath)");
    expect(gradle).toContain("require(file(stableKeystorePath).isFile)");
    expect(repositoryFiles.some((name) => name.endsWith(".p12"))).toBe(false);
    expect(repositoryFiles.some((name) => name.endsWith(".jks"))).toBe(false);
    expect(repositoryFiles.some((name) => name.endsWith(".keystore"))).toBe(false);
  });

  it("verifies the APK and exact signer before stable upload", () => {
    const workflow = read(".github/workflows/android-notification-companion-stable.yml");
    const verifyIndex = workflow.indexOf('"${APKSIGNER}" verify --verbose --print-certs');
    const compareIndex = workflow.indexOf('test "${CERT_SHA256}" = "${EXPECTED_CERT_SHA256}"');
    const uploadIndex = workflow.indexOf("Upload stable signed APK bundle");

    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(compareIndex).toBeGreaterThan(verifyIndex);
    expect(uploadIndex).toBeGreaterThan(compareIndex);
    expect(workflow).toContain("certificateSha256=${CERT_SHA256}");
    expect(workflow).toContain("updateCompatibility=stable-for-this-certificate");
    expect(workflow).toContain("APKSIGNER-REPORT.txt");
    expect(workflow).toContain("app-release.apk.sha256");
  });

  it("always removes the fixed-path materialized private key", () => {
    const workflow = read(".github/workflows/android-notification-companion-stable.yml");
    const cleanupIndex = workflow.indexOf("Remove private signing key");

    expect(cleanupIndex).toBeGreaterThanOrEqual(0);
    expect(workflow.slice(cleanupIndex)).toContain("if: always()");
    expect(workflow.slice(cleanupIndex)).toContain(
      'KEYSTORE_PATH="${RUNNER_TEMP}/elatura-android-signing.p12"',
    );
    expect(workflow.slice(cleanupIndex)).toMatch(/shred -u[\s\S]*rm -f/u);
  });

  it("locally verifies checksums and stable certificate identity without sourcing metadata", () => {
    const verifier = read("android/notification-companion/verify-artifact.sh");

    expect(verifier).toContain('unzip -Z1 "$archive"');
    expect(verifier).toContain("Unsafe path in artifact ZIP");
    expect(verifier).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+["$]/u);
    expect(verifier).not.toContain("sort -V");
    expect(verifier).toContain('actual_sha="$(sha256sum');
    expect(verifier).toContain('actual_sha="$(shasum -a 256');
    expect(verifier).toContain('[[ "$actual_sha" == "$provenance_sha" ]]');
    expect(verifier).toContain('if $require_stable; then');
    expect(verifier).toContain('"$apksigner_path" verify --verbose --print-certs');
    expect(verifier).toContain('[[ "$actual_cert" == "$provenance_cert" ]]');
    expect(verifier).toContain("APK signer certificate does not match the expected certificate");
  });

  it("labels ordinary CI artifacts as ephemeral and non-updateable", () => {
    const workflow = read(".github/workflows/android-notification-companion.yml");
    const installGuide = read("android/notification-companion/INSTALL-IQOO.md");

    expect(workflow).toContain("ELATURA_SIGNING_MODE: ephemeral-debug");
    expect(workflow).toContain("updateCompatibility=not-guaranteed-across-workflow-runs");
    expect(workflow).toContain("elatura-notification-companion-ephemeral-debug");
    expect(installGuide).toContain("Do not treat a pull-request artifact");
    expect(installGuide).toContain("Stable signing is tracked in issue #104");
  });
});
