// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_PROTOCOL_VERSION,
  DEFAULT_COMPANION_WORKING_SET_POLICY,
  SyntheticCompanion,
  type CompanionRequestEnvelope,
} from "../src/companion.js";
import {
  DEFAULT_READ_ONLY_REPRESENTATION_POLICY,
  READ_ONLY_REPRESENTATION_VERSION,
  validateAndMeasureReadOnlyRepresentation,
  type ReadOnlyRepresentation,
} from "../src/representation.js";

const SESSION = "representation-policy-session";

type SourceOptions = {
  entryCount: number;
  rootChildCount?: number;
  textCodeUnits?: number;
  codeBlocksPerEntry?: number;
  codeBlockTextCodeUnits?: number;
};

function source(options: SourceOptions): ReadOnlyRepresentation {
  const adapter = { id: "synthetic-adapter", version: "1.0.0" };
  const {
    entryCount,
    rootChildCount = 0,
    textCodeUnits = 1,
    codeBlocksPerEntry = 0,
    codeBlockTextCodeUnits = 1,
  } = options;
  const childrenOfRoot = Array.from(
    { length: rootChildCount },
    (_, index) => `entry-child-${index}`,
  );
  const totalEntries = Math.max(entryCount, rootChildCount + 1);
  const entries = Array.from({ length: totalEntries }, (_, index) => {
    if (index === 0 && rootChildCount > 0) {
      return {
        id: "entry-0",
        parentId: null,
        childIds: childrenOfRoot,
        sequence: 0,
        kind: "message",
        text: "t",
        codeBlocks: [],
      };
    }
    const id =
      index < rootChildCount + 1 && rootChildCount > 0 && index > 0
        ? `entry-child-${index - 1}`
        : `entry-${index}`;
    const parentId = index === 0 || (rootChildCount > 0 && index <= rootChildCount)
      ? index === 0
        ? null
        : "entry-0"
      : `entry-${index - 1}`;
    return {
      id,
      parentId,
      childIds: [],
      sequence: index,
      kind: "message",
      text: "x".repeat(textCodeUnits),
      codeBlocks: Array.from({ length: codeBlocksPerEntry }, () => ({
        language: "ts",
        text: "c".repeat(codeBlockTextCodeUnits),
      })),
    };
  });
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter,
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/timeline",
      },
      capturedAt: 100,
      adapter,
      transformation: {
        kind: "alternate-representation",
        id: "synthetic-read-only",
        version: "1",
      },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 200, expiresAt: 10_000 },
      synthetic: true,
    },
    roots: ["entry-0"],
    activePath: ["entry-0"],
    entries,
  };
}

function linearSource(count: number): ReadOnlyRepresentation {
  const adapter = { id: "synthetic-adapter", version: "1.0.0" };
  const entries = Array.from({ length: count }, (_, index) => ({
    id: `entry-${index}`,
    parentId: index === 0 ? null : `entry-${index - 1}`,
    childIds: index + 1 < count ? [`entry-${index + 1}`] : [],
    sequence: index,
    kind: "message",
    text: "t",
    codeBlocks: [],
  }));
  return {
    version: READ_ONLY_REPRESENTATION_VERSION,
    adapter,
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/timeline",
      },
      capturedAt: 100,
      adapter,
      transformation: {
        kind: "alternate-representation",
        id: "synthetic-read-only",
        version: "1",
      },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 200, expiresAt: 10_000 },
      synthetic: true,
    },
    roots: ["entry-0"],
    activePath: entries.map((entry) => entry.id),
    entries,
  };
}

function request(
  operation: CompanionRequestEnvelope["operation"],
  payload: Record<string, unknown>,
): CompanionRequestEnvelope {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId: SESSION,
    requestId: `${operation}-policy`,
    operation,
    payload,
  };
}

async function openError(companion: SyntheticCompanion, conversationId: string) {
  const response = await companion.dispatch(
    request("open", { conversationId, anchorEntryId: null, before: 2, after: 2 }),
  );
  return response.ok ? null : response.errorCode;
}

const LARGE_SOURCE_POLICY = {
  maxEntries: 100_000,
  maxRepresentationNodes: 2_000_000,
} as const;

describe("synthetic companion representation policy", () => {
  it("admits exactly the default maximum and rejects more without an explicit policy", async () => {
    const admitted = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "default-edge", representation: linearSource(10_000) }],
    });
    expect(await openError(admitted, "default-edge")).toBeNull();

    const rejected = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "default-over", representation: linearSource(10_001) }],
    });
    expect(await openError(rejected, "default-over")).toBe("conversation-corrupt");
  });

  it("admits 100,000 entries only through an explicit representation policy", async () => {
    const withoutPolicy = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "large-default", representation: linearSource(100_000) }],
    });
    expect(await openError(withoutPolicy, "large-default")).toBe("conversation-corrupt");

    const withPolicy = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      representationPolicy: LARGE_SOURCE_POLICY,
      conversations: [{ id: "large-explicit", representation: linearSource(100_000) }],
    });
    const list = await withPolicy.dispatch(request("list", { cursor: null, limit: 10 }));
    expect(list.ok).toBe(true);

    const open = await withPolicy.dispatch(
      request("open", { conversationId: "large-explicit", anchorEntryId: null, before: 2, after: 2 }),
    );
    expect(open.ok).toBe(true);
    expect(open.usage.residentConversationCount).toBe(1);
    expect(open.usage.residentRecordCount).toBe(1);
    expect(open.usage.residentEntryCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxResidentEntries,
    );
  });

  it("keeps companion resident-page/search/client limits independent from admission limits", async () => {
    const companion = new SyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      representationPolicy: LARGE_SOURCE_POLICY,
      conversations: [{ id: "independent-limits", representation: linearSource(100_000) }],
    });
    expect(companion.policy).toEqual(DEFAULT_COMPANION_WORKING_SET_POLICY);

    const open = await companion.dispatch(
      request("open", { conversationId: "independent-limits", anchorEntryId: null, before: 2, after: 2 }),
    );
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const cursor = (open.payload as { cursor: string }).cursor;

    const page = await companion.dispatch(
      request("page", {
        conversationId: "independent-limits",
        cursor,
        direction: "before",
        limit: DEFAULT_COMPANION_WORKING_SET_POLICY.maxPageEntries,
      }),
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect((page.payload as { entries: unknown[] }).entries.length).toBe(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxPageEntries,
    );
    expect(page.usage.residentEntryCount).toBeLessThanOrEqual(
      DEFAULT_COMPANION_WORKING_SET_POLICY.maxResidentEntries,
    );
  });

  it("bounds explicit admission independently by every representation resource cap", () => {
    // Entry count still binds above the raised explicit maximum.
    const overEntries = validateAndMeasureReadOnlyRepresentation(
      linearSource(100_001),
      LARGE_SOURCE_POLICY,
    );
    expect(overEntries.ok).toBe(false);
    if (!overEntries.ok) {
      expect(overEntries.issues.some((i) => i.code === "representation-entry-count-limit")).toBe(true);
    }

    // The serialized-byte cap binds even when the entry count is explicitly large.
    const overBytes = validateAndMeasureReadOnlyRepresentation(linearSource(100_001), {
      ...LARGE_SOURCE_POLICY,
      maxRepresentationSerializedBytes: 8_388_608,
    });
    expect(overBytes.ok).toBe(false);
    if (!overBytes.ok) {
      expect(overBytes.issues[0]?.code).toBe("representation-total-byte-limit");
    }

    // The JSON-node cap binds even when the entry count is explicitly large.
    const overNodes = validateAndMeasureReadOnlyRepresentation(linearSource(100_001), {
      maxEntries: 100_000,
      maxRepresentationNodes: 500_000,
    });
    expect(overNodes.ok).toBe(false);
    if (!overNodes.ok) {
      expect(overNodes.issues[0]?.code).toBe("representation-unit-limit");
    }

    // Per-string text limits bind under an explicitly raised entry count.
    const overText = validateAndMeasureReadOnlyRepresentation(
      source({ entryCount: 2, textCodeUnits: DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxTextCodeUnits + 1 }),
      LARGE_SOURCE_POLICY,
    );
    expect(overText.ok).toBe(false);
    if (!overText.ok) {
      expect(overText.issues[0]?.code).toBe("representation-string-limit");
    }

    // Child-count limits bind per entry.
    const overChildren = validateAndMeasureReadOnlyRepresentation(
      source({ entryCount: 1, rootChildCount: DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxChildrenPerEntry + 1 }),
      LARGE_SOURCE_POLICY,
    );
    expect(overChildren.ok).toBe(false);
    if (!overChildren.ok) {
      expect(
        overChildren.issues.some(
          (i) => i.code === "invalid-string-array" && i.path.includes("childIds"),
        ),
      ).toBe(true);
    }

    // Code-block count and code-block text limits bind per entry.
    const overBlockCount = validateAndMeasureReadOnlyRepresentation(
      source({ entryCount: 1, codeBlocksPerEntry: DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxCodeBlocksPerEntry + 1 }),
      LARGE_SOURCE_POLICY,
    );
    expect(overBlockCount.ok).toBe(false);
    if (!overBlockCount.ok) {
      expect(overBlockCount.issues[0]?.code).toBe("representation-code-block-limit");
    }

    const overBlockText = validateAndMeasureReadOnlyRepresentation(
      source({ entryCount: 1, codeBlocksPerEntry: 1, codeBlockTextCodeUnits: DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxCodeBlockTextCodeUnits + 1 }),
      LARGE_SOURCE_POLICY,
    );
    expect(overBlockText.ok).toBe(false);
    if (!overBlockText.ok) {
      expect(overBlockText.issues[0]?.code).toBe("representation-code-block-text-limit");
    }

    // The per-entry serialized-byte cap binds when string caps are explicitly raised.
    const overEntryBytes = validateAndMeasureReadOnlyRepresentation(
      source({ entryCount: 1, textCodeUnits: 2_621_440 }),
      { ...LARGE_SOURCE_POLICY, maxTextCodeUnits: 8_388_608 },
    );
    expect(overEntryBytes.ok).toBe(false);
    if (!overEntryBytes.ok) {
      expect(overEntryBytes.issues[0]?.code).toBe("representation-entry-byte-limit");
    }
  });

  it("rejects unknown fields, accessors, unsafe integers, and incoherent caps before admission", async () => {
    const base = {
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "policy-check", representation: linearSource(1) }],
    };

    expect(
      () =>
        new SyntheticCompanion({
          ...base,
          representationPolicy: { maxEntries: 100_000, bogus: 1 } as unknown as Record<string, number>,
        }),
    ).toThrow(/own-data records/u);

    let invoked = false;
    const accessorPolicy = Object.defineProperty({}, "maxEntries", {
      enumerable: true,
      get() {
        invoked = true;
        return 100_000;
      },
    });
    expect(() => new SyntheticCompanion({ ...base, representationPolicy: accessorPolicy })).toThrow(
      /own-data records/u,
    );
    expect(invoked).toBe(false);

    for (const unsafe of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () =>
          new SyntheticCompanion({
            ...base,
            representationPolicy: { maxEntries: unsafe },
          }),
      ).toThrow(/own-data records/u);
    }

    expect(() =>
      new SyntheticCompanion({
        ...base,
        representationPolicy: { maxEntrySerializedBytes: 33_554_433 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      new SyntheticCompanion({
        ...base,
        representationPolicy: { maxEntries: 100_000, maxChildrenPerEntry: 100_001 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      new SyntheticCompanion({
        ...base,
        representationPolicy: { maxTextCodeUnits: 262_143 },
      }),
    ).toThrow(RangeError);

    // Policy coherence fails before any source validation or resident state exists.
    expect(
      () =>
        new SyntheticCompanion({
          ...base,
          conversations: [
            { id: "policy-check", representation: { ...linearSource(1), provenance: {} } },
          ],
          representationPolicy: { maxChildrenPerEntry: 100_001 },
        }),
    ).toThrow(RangeError);
  });

  it("contains hostile policy proxies in fixed rejections", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("private proxy detail");
        },
      },
    );
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          now: () => 150,
          conversations: [{ id: "proxy-check", representation: linearSource(1) }],
          representationPolicy: hostile as Record<string, number>,
        }),
    ).toThrow(/own-data records/u);
  });

  it("keeps source admission synthetic-only under an explicit policy", async () => {
    const nonSynthetic = linearSource(10_001) as ReadOnlyRepresentation;
    (nonSynthetic.provenance as { synthetic: boolean }).synthetic = false;
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: SESSION,
          now: () => 150,
          representationPolicy: LARGE_SOURCE_POLICY,
          conversations: [{ id: "non-synthetic", representation: nonSynthetic }],
        }),
    ).toThrow(/synthetic provenance only/u);
  });

  it("preserves the default read-only representation policy when the option is absent", () => {
    expect(Object.isFrozen(DEFAULT_READ_ONLY_REPRESENTATION_POLICY)).toBe(true);
    expect(DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxEntries).toBe(10_000);

    const admitted = validateAndMeasureReadOnlyRepresentation(linearSource(10_000));
    expect(admitted.ok).toBe(true);
    const rejected = validateAndMeasureReadOnlyRepresentation(linearSource(10_001));
    expect(rejected.ok).toBe(false);
  });
});
