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
  resolveReadOnlyRepresentationPolicy,
  validateAndMeasureReadOnlyRepresentation,
  type ReadOnlyRepresentation,
  type ReadOnlyRepresentationPolicy,
} from "../src/representation.js";
import { SyntheticCompanion as UncheckedSyntheticCompanion } from "../src/companion-runtime.js";

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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);

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

const CONTROLLED_POLICY_ERROR =
  "Expected undefined or a plain own-data record of positive safe integer representation limits.";

const RESOLVER_POLICY_KEYS: readonly string[] = [
  "maxEntries",
  "maxChildrenPerEntry",
  "maxCodeBlocksPerEntry",
  "maxTextCodeUnits",
  "maxCodeBlockTextCodeUnits",
  "maxEntrySerializedBytes",
  "maxRepresentationSerializedBytes",
  "maxRepresentationNodes",
  "maxSearchQueryCodeUnits",
  "maxSearchResults",
  "maxCodeExtractionResults",
];

function capturePolicyError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectControlledTypeError(error: unknown): void {
  expect(error).toBeInstanceOf(TypeError);
  expect((error as TypeError).message).toBe(CONTROLLED_POLICY_ERROR);
}

describe("resolveReadOnlyRepresentationPolicy", () => {
  it("resolves defaults onto a frozen object with exactly the allowed keys", () => {
    for (const resolved of [
      resolveReadOnlyRepresentationPolicy(),
      resolveReadOnlyRepresentationPolicy(undefined),
      resolveReadOnlyRepresentationPolicy({}),
      resolveReadOnlyRepresentationPolicy({ maxEntries: 100_000 }),
    ]) {
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(Object.keys(resolved).sort()).toEqual([...RESOLVER_POLICY_KEYS].sort());
    }
    expect(resolveReadOnlyRepresentationPolicy()).toEqual(DEFAULT_READ_ONLY_REPRESENTATION_POLICY);
    const explicit = resolveReadOnlyRepresentationPolicy({ maxEntries: 100_000 });
    expect(explicit.maxEntries).toBe(100_000);
    expect(explicit.maxRepresentationSerializedBytes).toBe(
      DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxRepresentationSerializedBytes,
    );
  });

  it("accepts null-prototype records and copies values without reading accessors", () => {
    const nullProto = Object.assign(Object.create(null), { maxEntries: 20_000, maxSearchResults: 8 });
    const resolved = resolveReadOnlyRepresentationPolicy(nullProto);
    expect(resolved.maxEntries).toBe(20_000);
    expect(resolved.maxSearchResults).toBe(8);

    let invoked = false;
    const mixed = Object.defineProperty(Object.create(null), "maxEntries", {
      enumerable: true,
      get() {
        invoked = true;
        return 64;
      },
    }) as Partial<ReadOnlyRepresentationPolicy>;
    const accessorError = capturePolicyError(() => resolveReadOnlyRepresentationPolicy(mixed));
    expectControlledTypeError(accessorError);
    expect(invoked).toBe(false);
  });

  it("rejects non-record inputs with one controlled TypeError", () => {
    class ExoticPolicy {}
    const hostileInputs: unknown[] = [
      null,
      87,
      "policy",
      true,
      [],
      () => 87,
      new Date(0),
      new ExoticPolicy(),
    ];
    for (const hostile of hostileInputs) {
      const error = capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(hostile as Partial<ReadOnlyRepresentationPolicy>),
      );
      expectControlledTypeError(error);
    }
  });

  it("rejects unknown fields, symbols, and non-enumerable own fields", () => {
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy({ maxEntries: 5, bogus: 7 } as unknown as Record<string, number>),
      ),
    );

    const symbolTagged = {} as Record<string, number>;
    Object.defineProperty(symbolTagged, Symbol("tag"), { value: 1, enumerable: true });
    symbolTagged.maxEntries = 5;
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(symbolTagged as Partial<ReadOnlyRepresentationPolicy>),
      ),
    );

    const hidden = {} as Record<string, number>;
    Object.defineProperty(hidden, "maxEntries", { value: 10, enumerable: false });
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(hidden as Partial<ReadOnlyRepresentationPolicy>),
      ),
    );
  });

  it("never invokes getters or setters while rejecting accessors", () => {
    let invoked = 0;
    const getterPolicy = Object.defineProperty({}, "maxEntries", {
      enumerable: true,
      get() {
        invoked += 1;
        return 100_000;
      },
    });
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(getterPolicy as Partial<ReadOnlyRepresentationPolicy>),
      ),
    );

    const throwingGetterPolicy = Object.defineProperty({}, "maxTextCodeUnits", {
      configurable: true,
      enumerable: true,
      get(): number {
        invoked += 1;
        throw new Error("getter side effect");
      },
    });
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(throwingGetterPolicy as Partial<ReadOnlyRepresentationPolicy>),
      ),
    );

    const setterPolicy = Object.defineProperty({}, "maxEntries", {
      enumerable: true,
      set() {
        invoked += 1;
      },
    });
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(setterPolicy as Partial<ReadOnlyRepresentationPolicy>),
      ),
    );
    expect(invoked).toBe(0);
  });

  it("contains hostile proxy traps behind the fixed rejection", () => {
    const rawDetail = "private proxy detail";
    const throwingOwnKeysProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(rawDetail);
        },
      },
    );
    const ownKeysError = capturePolicyError(() =>
      resolveReadOnlyRepresentationPolicy(throwingOwnKeysProxy as Partial<ReadOnlyRepresentationPolicy>),
    );
    expectControlledTypeError(ownKeysError);
    expect((ownKeysError as TypeError).message).not.toContain(rawDetail);

    const throwingDescriptorProxy = new Proxy(
      {},
      {
        ownKeys() {
          return ["maxEntries"];
        },
        getOwnPropertyDescriptor() {
          throw new Error(rawDetail);
        },
      },
    );
    const descriptorError = capturePolicyError(() =>
      resolveReadOnlyRepresentationPolicy(throwingDescriptorProxy as Partial<ReadOnlyRepresentationPolicy>),
    );
    expectControlledTypeError(descriptorError);
    expect((descriptorError as TypeError).message).not.toContain(rawDetail);

    let lyingGetterInvoked = false;
    const lyingAccessorProxy = new Proxy(
      {},
      {
        ownKeys() {
          return ["maxEntries"];
        },
        getOwnPropertyDescriptor(_target, key) {
          if (key !== "maxEntries") return undefined;
          return {
            enumerable: true,
            configurable: true,
            get() {
              lyingGetterInvoked = true;
              return 100_000;
            },
          };
        },
      },
    );
    expectControlledTypeError(
      capturePolicyError(() =>
        resolveReadOnlyRepresentationPolicy(lyingAccessorProxy as unknown as Partial<ReadOnlyRepresentationPolicy>),
      ),
    );
    expect(lyingGetterInvoked).toBe(false);
  });

  it("keeps the safe-integer and coherence RangeErrors unchanged", () => {
    const rangeCases: [Partial<ReadOnlyRepresentationPolicy>, string][] = [
      [{ maxEntries: 0 }, "maxEntries must be a positive safe integer."],
      [{ maxEntries: -5 }, "maxEntries must be a positive safe integer."],
      [{ maxEntries: 1.5 }, "maxEntries must be a positive safe integer."],
      [{ maxEntries: Number.NaN }, "maxEntries must be a positive safe integer."],
      [{ maxEntries: Number.POSITIVE_INFINITY }, "maxEntries must be a positive safe integer."],
      [
        { maxEntries: Number.MAX_SAFE_INTEGER + 1 },
        "maxEntries must be a positive safe integer.",
      ],
      [
        { maxTextCodeUnits: "262144" as unknown as number },
        "maxTextCodeUnits must be a positive safe integer.",
      ],
      [
        { maxEntrySerializedBytes: 33_554_433 },
        "maxEntrySerializedBytes must not exceed maxRepresentationSerializedBytes.",
      ],
      [
        { maxEntries: 100_000, maxChildrenPerEntry: 100_001 },
        "maxChildrenPerEntry must not exceed maxEntries.",
      ],
      [
        { maxTextCodeUnits: 262_143 },
        "maxCodeBlockTextCodeUnits must not exceed maxTextCodeUnits.",
      ],
    ];
    for (const [policyInput, message] of rangeCases) {
      const error = capturePolicyError(() => resolveReadOnlyRepresentationPolicy(policyInput));
      expect(error).toBeInstanceOf(RangeError);
      expect((error as RangeError).message).toBe(message);
    }
  });

  it("inherits fail-closed policy resolution on the unchecked runtime lane", async () => {
    const base = {
      sessionId: SESSION,
      now: () => 150,
      conversations: [{ id: "unchecked-bypass", representation: linearSource(1) }],
    };

    expectControlledTypeError(
      capturePolicyError(() =>
        new UncheckedSyntheticCompanion({
          ...base,
          representationPolicy: { maxEntries: 100_000, bogus: 7 } as unknown as Record<string, number>,
        }),
      ),
    );

    let invoked = false;
    const accessorPolicy = Object.defineProperty({}, "maxEntries", {
      enumerable: true,
      get() {
        invoked = true;
        return 100_000;
      },
    });
    expectControlledTypeError(
      capturePolicyError(() => new UncheckedSyntheticCompanion({ ...base, representationPolicy: accessorPolicy })),
    );
    expect(invoked).toBe(false);

    const hostileProxyError = capturePolicyError(() =>
      new UncheckedSyntheticCompanion({
        ...base,
        representationPolicy: new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("private proxy detail");
            },
          },
        ) as Record<string, number>,
      }),
    );
    expectControlledTypeError(hostileProxyError);

    const admitted = new UncheckedSyntheticCompanion({
      sessionId: SESSION,
      now: () => 150,
      representationPolicy: LARGE_SOURCE_POLICY,
      conversations: [{ id: "unchecked-large", representation: linearSource(100_000) }],
    });
    const open = await admitted.dispatch(
      request("open", { conversationId: "unchecked-large", anchorEntryId: null, before: 2, after: 2 }),
    );
    expect(open.ok).toBe(true);
  }, 20_000);
});
