// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  accountedResidentBytes,
  measureBoundedJson,
  serializeBoundedJson,
  utf8ByteLength,
} from "../src/resource-accounting.js";

function codes(result: ReturnType<typeof measureBoundedJson>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("bounded JSON resource accounting", () => {
  it("matches actual UTF-8 serialization bytes", () => {
    const value = {
      ascii: "plain",
      quoted: "a\"b\\c\n",
      unicode: "λ😀",
      values: [null, true, false, -0, 12.5],
    };
    const measured = measureBoundedJson(value);
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const serialized = JSON.stringify(value);
    expect(measured.value.serializedBytes).toBe(utf8ByteLength(serialized));
    expect(serializeBoundedJson(value)).toEqual({
      ok: true,
      value: { serialized, usage: measured.value },
      warnings: [],
    });
  });

  it("rejects accessors, cycles, sparse arrays, and non-plain objects safely", () => {
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array(3);
    sparse[2] = "value";

    expect(codes(measureBoundedJson(accessor))).toContain("json-accessor");
    expect(codes(measureBoundedJson(cyclic))).toContain("json-cycle");
    expect(codes(measureBoundedJson(sparse))).toContain("json-sparse-array");
    expect(codes(measureBoundedJson(new Date()))).toContain("json-non-plain-object");
  });

  it("distinguishes string, node, depth, and byte limits", () => {
    expect(codes(measureBoundedJson("abcdef", { maxStringCodeUnits: 5 }))).toContain(
      "json-string-limit",
    );
    expect(codes(measureBoundedJson([1, 2, 3], { maxNodes: 3 }))).toContain(
      "json-node-limit",
    );
    expect(codes(measureBoundedJson([[1]], { maxDepth: 1 }))).toContain(
      "json-depth-limit",
    );
    expect(codes(measureBoundedJson({ value: "abcdef" }, { maxSerializedBytes: 8 }))).toContain(
      "json-serialized-byte-limit",
    );
  });

  it("accounts for retained strings plus decoded copies", () => {
    const serialized = '{"value":"λ"}';
    expect(accountedResidentBytes(serialized, 3)).toBe(
      serialized.length * 2 + utf8ByteLength(serialized) * 3,
    );
    expect(() => accountedResidentBytes(serialized, 0)).toThrow(/positive safe integer/);
  });

  it("contains proxy failures in fixed validation results", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("private proxy detail");
      },
    });
    const result = measureBoundedJson(hostile);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private proxy detail");
    if (!result.ok) expect(result.issues[0]?.code).toBe("json-inspection-failed");
  });
});
