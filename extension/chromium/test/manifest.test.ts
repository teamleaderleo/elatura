// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Chromium lane host manifest", () => {
  it("requests storage only and has zero site/debugger reach", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../static/manifest.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
    expect(JSON.stringify(manifest)).not.toContain("debugger");
    expect(JSON.stringify(manifest)).not.toContain("webRequest");
  });
});
