// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { fingerprintShape } from "../src/index.js";

describe("fingerprintShape", () => {
  it("ignores scalar values while preserving shape", () => {
    const first = fingerprintShape("example", "1", { id: "private-a", count: 1 });
    const second = fingerprintShape("example", "1", { id: "private-b", count: 999 });
    expect(first).toEqual(second);
  });

  it("changes when the schema shape changes", () => {
    const first = fingerprintShape("example", "1", { id: "a" });
    const second = fingerprintShape("example", "1", { id: "a", children: [] });
    expect(first.hash).not.toBe(second.hash);
  });
});
