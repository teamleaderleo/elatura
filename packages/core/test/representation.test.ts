// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  extractReadOnlyCode,
  navigateReadOnlyRepresentation,
  resolveJumpBackReference,
  searchReadOnlyRepresentation,
  validateReadOnlyRepresentation,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

function representation(): ReadOnlyRepresentation {
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter: { id: "toy", version: "1" },
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/timeline",
      },
      capturedAt: 100,
      adapter: { id: "toy", version: "1" },
      transformation: { kind: "alternate-representation", id: "toy-read-only", version: "1" },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 200, expiresAt: 300 },
      synthetic: true,
    },
    roots: ["root"],
    activePath: ["root", "user", "assistant-a"],
    entries: [
      {
        id: "root",
        parentId: null,
        childIds: ["user"],
        sequence: 0,
        kind: "root",
        codeBlocks: [],
      },
      {
        id: "user",
        parentId: "root",
        childIds: ["assistant-a", "assistant-b"],
        sequence: 1,
        kind: "message",
        label: "user",
        text: "show the parser",
        codeBlocks: [],
      },
      {
        id: "assistant-a",
        parentId: "user",
        childIds: [],
        sequence: 2,
        kind: "message",
        label: "assistant",
        text: "parser implementation",
        codeBlocks: [{ language: "ts", text: "const parse = () => true;" }],
        jumpBackReference: "https://synthetic.elatura.invalid/timeline#assistant-a",
      },
      {
        id: "assistant-b",
        parentId: "user",
        childIds: [],
        sequence: 3,
        kind: "message",
        label: "assistant",
        text: "alternate answer",
        codeBlocks: [],
      },
    ],
  };
}

describe("read-only representation", () => {
  it("validates timeline order and graph reciprocity", () => {
    expect(validateReadOnlyRepresentation(representation()).ok).toBe(true);
    const broken = representation();
    broken.entries[1]!.childIds = ["assistant-a"];
    const result = validateReadOnlyRepresentation(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "parent-child-mismatch")).toBe(true);
  });

  it("supports search, code extraction, branch navigation, and jump-back", () => {
    const value = representation();
    expect(searchReadOnlyRepresentation(value, "parser").map((entry) => entry.id)).toEqual([
      "user",
      "assistant-a",
    ]);
    expect(extractReadOnlyCode(value)).toEqual([
      { entryId: "assistant-a", language: "ts", text: "const parse = () => true;" },
    ]);
    expect(navigateReadOnlyRepresentation(value, "assistant-a")).toMatchObject({
      parent: { id: "user" },
      siblings: [{ id: "assistant-b" }],
      children: [],
    });
    expect(resolveJumpBackReference(value, "assistant-a")).toBe(
      "https://synthetic.elatura.invalid/timeline#assistant-a",
    );
    expect(resolveJumpBackReference(value, "root")).toBe(
      "https://synthetic.elatura.invalid/timeline",
    );
  });
});
