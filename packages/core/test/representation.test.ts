// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  READ_ONLY_REPRESENTATION_VERSION,
  extractReadOnlyCode,
  measureReadOnlyRepresentation,
  navigateReadOnlyRepresentation,
  resolveJumpBackReference,
  searchReadOnlyRepresentation,
  validateAndMeasureReadOnlyRepresentation,
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

function issueCodes(input: unknown, policy?: Parameters<typeof validateReadOnlyRepresentation>[1]): string[] {
  const result = validateReadOnlyRepresentation(input, policy);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("read-only representation", () => {
  it("validates timeline order and graph reciprocity", () => {
    expect(validateReadOnlyRepresentation(representation()).ok).toBe(true);
    const broken = representation();
    broken.entries[1]!.childIds = ["assistant-a"];
    expect(issueCodes(broken)).toContain("parent-child-mismatch");
  });

  it("supports bounded search, code extraction, branch navigation, and jump-back", () => {
    const value = representation();
    expect(searchReadOnlyRepresentation(value, "parser").map((entry) => entry.id)).toEqual([
      "user",
      "assistant-a",
    ]);
    expect(searchReadOnlyRepresentation(value, "answer", { maxResults: 1 }).map((entry) => entry.id)).toEqual([
      "assistant-b",
    ]);
    expect(searchReadOnlyRepresentation(value, "x".repeat(4_097))).toEqual([]);
    expect(extractReadOnlyCode(value)).toEqual([
      { entryId: "assistant-a", language: "ts", text: "const parse = () => true;" },
    ]);
    expect(extractReadOnlyCode(value, { maxResults: 1 })).toHaveLength(1);
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

  it("returns deterministic usage and charges duplicated code text", () => {
    const value = representation();
    const measured = validateAndMeasureReadOnlyRepresentation(value);
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measured.value.usage).toMatchObject({
      entryCount: 4,
      codeBlockCount: 1,
    });
    expect(measured.value.usage.serializedBytes).toBeGreaterThan(0);

    const withoutCodeCopy = representation();
    withoutCodeCopy.entries[2]!.codeBlocks = [];
    const smaller = measureReadOnlyRepresentation(withoutCodeCopy);
    expect(smaller.ok).toBe(true);
    if (smaller.ok) {
      expect(measured.value.usage.serializedBytes).toBeGreaterThan(smaller.value.serializedBytes);
      expect(measured.value.usage.stringCodeUnits).toBeGreaterThan(smaller.value.stringCodeUnits);
    }
  });

  it("distinguishes entry, string, code-block, and total representation limits", () => {
    const entryCount = representation();
    expect(issueCodes(entryCount, { maxEntries: 3 })).toContain("representation-entry-count-limit");

    const longText = representation();
    longText.entries[1]!.text = "x".repeat(33);
    expect(issueCodes(longText, { maxTextCodeUnits: 32 })).toContain("representation-string-limit");

    const blocks = representation();
    blocks.entries[2]!.codeBlocks = [
      { text: "a" },
      { text: "b" },
    ];
    expect(issueCodes(blocks, { maxCodeBlocksPerEntry: 1 })).toContain("representation-code-block-limit");

    const blockText = representation();
    blockText.entries[2]!.codeBlocks = [{ text: "x".repeat(17) }];
    expect(issueCodes(blockText, { maxCodeBlockTextCodeUnits: 16 })).toContain(
      "representation-code-block-text-limit",
    );

    const entryBytes = representation();
    expect(issueCodes(entryBytes, { maxEntrySerializedBytes: 64 })).toContain(
      "representation-entry-byte-limit",
    );

    const totalBytes = representation();
    expect(issueCodes(totalBytes, { maxRepresentationSerializedBytes: 256 })).toContain(
      "representation-total-byte-limit",
    );
  });

  it("contains accessors and proxy failures without executing private data paths", () => {
    const accessor = representation() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "entries", {
      enumerable: true,
      get() {
        throw new Error("private accessor detail");
      },
    });
    const accessorResult = validateReadOnlyRepresentation(accessor);
    expect(accessorResult.ok).toBe(false);
    expect(JSON.stringify(accessorResult)).not.toContain("private accessor detail");
    if (!accessorResult.ok) {
      expect(accessorResult.issues.map((issue) => issue.code)).toContain("representation-inspection-failed");
    }

    const hostile = new Proxy(representation(), {
      ownKeys() {
        throw new Error("private proxy detail");
      },
    });
    const proxyResult = validateReadOnlyRepresentation(hostile);
    expect(proxyResult.ok).toBe(false);
    expect(JSON.stringify(proxyResult)).not.toContain("private proxy detail");
  });

  it("rejects mismatched or incomplete provenance", () => {
    const adapterMismatch = representation();
    adapterMismatch.provenance.adapter.version = "2";
    expect(issueCodes(adapterMismatch)).toContain("provenance-adapter-mismatch");

    const badTransformation = representation();
    badTransformation.provenance.transformation = { kind: "windowed" };
    expect(issueCodes(badTransformation)).toContain("missing-transformation-identity");

    const badCache = representation();
    badCache.provenance.cache = { kind: "memory" };
    expect(issueCodes(badCache)).toContain("invalid-envelope-version");
  });

  it("rejects active-content, cross-origin, credential-bearing, and query-bearing references", () => {
    const candidates = [
      "javascript:alert(1)",
      "https://other.invalid/timeline",
      "https://user:secret@synthetic.elatura.invalid/timeline",
      "https://synthetic.elatura.invalid/timeline?private=value",
    ];
    for (const reference of candidates) {
      const input = representation();
      input.entries[2]!.jumpBackReference = reference;
      expect(issueCodes(input)).toContain("invalid-jump-back-reference");
    }

    const authority = representation();
    authority.provenance.authority.reference = "https://synthetic.elatura.invalid/timeline?private=value";
    expect(issueCodes(authority)).toContain("invalid-authority-reference");
  });

  it("defensively refuses unsafe references even when a caller bypasses validation", () => {
    const unsafe = representation();
    unsafe.entries[2]!.jumpBackReference = "javascript:alert(1)";
    unsafe.provenance.authority.reference = "https://other.invalid/timeline";
    expect(resolveJumpBackReference(unsafe, "assistant-a")).toBeNull();
  });

  it("rejects cycles, empty active paths, and hidden schema fields", () => {
    const cycle = representation();
    cycle.entries[0]!.parentId = "assistant-a";
    cycle.entries[0]!.childIds = ["user"];
    cycle.entries[2]!.childIds = ["root"];
    expect(issueCodes(cycle)).toContain("representation-cycle");

    const emptyActive = representation();
    emptyActive.activePath = [];
    expect(issueCodes(emptyActive)).toContain("empty-active-path");

    const extra = representation() as ReadOnlyRepresentation & { hidden?: string };
    extra.hidden = "not part of schema v1";
    expect(issueCodes(extra)).toContain("unknown-field");
  });

  it("returns a normalized copy rather than the caller's object", () => {
    const input = representation();
    input.roots = ["root"];
    const result = validateReadOnlyRepresentation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(input);
    expect(result.value.entries).not.toBe(input.entries);
    input.entries[0]!.kind = "mutated-after-validation";
    expect(result.value.entries[0]!.kind).toBe("root");
  });
});
