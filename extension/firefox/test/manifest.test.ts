// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifestPath = new URL("../static/manifest.json", import.meta.url);

describe("Firefox extension manifest", () => {
  it("declares the compatibility floor required by module background scripts", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      background?: { scripts?: string[]; type?: string };
      browser_specific_settings?: { gecko?: { strict_min_version?: string } };
    };

    expect(manifest.background).toEqual({ scripts: ["background.js"], type: "module" });
    expect(Number.parseFloat(manifest.browser_specific_settings?.gecko?.strict_min_version ?? "0")).toBeGreaterThanOrEqual(
      112,
    );
  });
});
