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

  it("treats configured object paths as dictionaries without serializing their keys", () => {
    const first = fingerprintShape(
      "example",
      "2",
      { mapping: { "private-node-a": { id: "a", children: [] } } },
      { depth: 5, dictionaryPaths: ["$.mapping"] },
    );
    const second = fingerprintShape(
      "example",
      "2",
      { mapping: { "different-private-node": { id: "b", children: [] } } },
      { depth: 5, dictionaryPaths: ["$.mapping"] },
    );
    expect(first).toEqual(second);
    expect(first.shape).not.toContain("private-node-a");
    expect(first.shape).not.toContain("different-private-node");
  });

  it("captures heterogeneous array shapes independent of value order", () => {
    const first = fingerprintShape("example", "2", { items: [1, "a", true] });
    const second = fingerprintShape("example", "2", { items: [false, "b", 999] });
    expect(first).toEqual(second);
    expect(first.shape).toContain("boolean|number|string");
  });

  it("bounds unique variants deterministically", () => {
    const values = [{ a: 1 }, { b: 1 }, { c: 1 }, { d: 1 }];
    const first = fingerprintShape("example", "2", values, { depth: 4, maxUniqueVariants: 2 });
    const second = fingerprintShape("example", "2", [...values].reverse(), {
      depth: 4,
      maxUniqueVariants: 2,
    });
    expect(first).toEqual(second);
    expect(first.shape).toContain("…");
  });

  it("handles cycles and bounds the exposed shape string", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(fingerprintShape("example", "2", cyclic, { depth: 8 }).shape).toBe("{self:circular}");

    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 200; index += 1) wide[`field-${index}`] = { value: index };
    const fingerprint = fingerprintShape("example", "2", wide, {
      depth: 4,
      maxObjectKeys: 100,
      maxShapeLength: 96,
    });
    expect(fingerprint.shape.length).toBeLessThanOrEqual(96);
    expect(fingerprint.shape).toContain("<truncated:");
  });

  it("rejects unsafe limits", () => {
    expect(() => fingerprintShape("example", "2", {}, { depth: -1 })).toThrow(/depth/);
    expect(() => fingerprintShape("example", "2", {}, { maxShapeLength: 8 })).toThrow(
      /maxShapeLength/,
    );
    expect(() => fingerprintShape("example", "2", {}, { dictionaryPaths: ["mapping"] })).toThrow(
      /dictionaryPaths/,
    );
  });
});
