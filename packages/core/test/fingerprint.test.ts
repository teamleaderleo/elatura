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

  it("retains the same bounded object keys across adversarial insertion orders", () => {
    const entries = Array.from({ length: 500 }, (_, index) => [
      `field-${index.toString().padStart(3, "0")}`,
      { value: index },
    ] as const);
    const forward = Object.fromEntries(entries);
    const reverse = Object.fromEntries([...entries].reverse());
    const options = { depth: 4, maxObjectKeys: 8, maxShapeLength: 1_024 };
    const first = fingerprintShape("example", "2", forward, options);
    const second = fingerprintShape("example", "2", reverse, options);
    expect(first).toEqual(second);
    expect(first.shape).toContain("…");
    expect(first.shape).toContain("field-000");
    expect(first.shape).not.toContain("field-499");
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

  it("stops traversing when the traversal-unit budget is exhausted", () => {
    const input = Array.from({ length: 20 }, (_, index) => ({ value: index }));
    expect(() =>
      fingerprintShape("example", "2", input, {
        depth: 4,
        maxVisitedValues: 10,
      }),
    ).toThrow(/traversal-unit budget/);
  });

  it("charges ordinary object-key inspection before retaining or sorting keys", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [`field-${index.toString().padStart(5, "0")}`, null]),
    );
    expect(() =>
      fingerprintShape("example", "2", wide, {
        depth: 2,
        maxObjectKeys: 4,
        maxVisitedValues: 32,
      }),
    ).toThrow(/traversal-unit budget/);
  });

  it("charges dictionary keys without exposing them in the resource-limit error", () => {
    const privateKey = "private-conversation-node-999999";
    const mapping = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [index === 99 ? privateKey : `private-${index}`, null]),
    );
    let thrown: unknown;
    try {
      fingerprintShape("example", "2", { mapping }, {
        depth: 3,
        dictionaryPaths: ["$.mapping"],
        maxVisitedValues: 16,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(String(thrown)).toContain("traversal-unit budget");
    expect(String(thrown)).not.toContain(privateKey);
  });

  it("bounds inherited enumerable-key inspection", () => {
    const inherited = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`inherited-${index}`, null]),
    );
    const input = Object.create(inherited) as Record<string, unknown>;
    input.own = null;
    expect(() =>
      fingerprintShape("example", "2", input, {
        depth: 2,
        maxVisitedValues: 12,
      }),
    ).toThrow(/traversal-unit budget/);
  });

  it("rejects unsafe limits", () => {
    expect(() => fingerprintShape("example", "2", {}, { depth: -1 })).toThrow(/depth/);
    expect(() => fingerprintShape("example", "2", {}, { maxShapeLength: 8 })).toThrow(
      /maxShapeLength/,
    );
    expect(() => fingerprintShape("example", "2", {}, { maxVisitedValues: 0 })).toThrow(
      /maxVisitedValues/,
    );
    expect(() => fingerprintShape("example", "2", {}, { dictionaryPaths: ["mapping"] })).toThrow(
      /dictionaryPaths/,
    );
  });
});
