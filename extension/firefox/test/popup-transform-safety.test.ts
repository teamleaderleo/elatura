// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const popupHtml = new URL("../static/popup.html", import.meta.url);
const popupScript = new URL("../src/popup.ts", import.meta.url);

describe("popup transform safety surface", () => {
  it("exposes emergency disable and no transform unlock control", async () => {
    const [html, script] = await Promise.all([
      readFile(popupHtml, "utf8"),
      readFile(popupScript, "utf8"),
    ]);
    expect(html).toContain('id="emergency-disable"');
    expect(html).toContain('id="transform-safety"');
    expect(script).toContain("elatura:emergency-disable-transforms");
    expect(`${html}\n${script}`).not.toMatch(/elatura:(?:enable|unlock|arm)-transforms/u);
    expect(html).not.toMatch(/id="[^"]*(?:enable|unlock|arm)[^"]*transform[^"]*"/iu);
  });
});
