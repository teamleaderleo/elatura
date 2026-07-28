// SPDX-License-Identifier: MPL-2.0
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser integration boundary", () => {
  it("keeps synthetic transformation disconnected from the Firefox response path", async () => {
    const source = await readFile(new URL("../../../extension/firefox/src/background.ts", import.meta.url), "utf8");
    expect(source).toContain("filter.write(event.data)");
    expect(source).not.toContain("runSyntheticChatGptPipeline");
    expect(source).not.toContain("adapter-chatgpt/synthetic");
    expect(source).not.toContain("@elatura/core/orchestration");
  });
});
