// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { generateSyntheticConversation } from "@elatura/fixtures";
import { toSyntheticChatGptRepresentation } from "../src/contracts.js";
import { validateChatGptConversation, type ChatGptConversation } from "../src/index.js";

const baseOptions = {
  authorityOrigin: "https://synthetic.elatura.invalid",
  authorityReference: "https://synthetic.elatura.invalid/conversation",
  capturedAt: 100,
  staleAt: 200,
  expiresAt: 300,
};

function validatedFixture(turnGroups: number): ChatGptConversation {
  const fixture = generateSyntheticConversation({
    turnGroups,
    branchEvery: 0,
    hiddenNodesPerTurn: 0,
    payloadBytesPerMessage: 16,
    seed: 87,
  });
  const validated = validateChatGptConversation(fixture);
  if (!validated.ok) throw new Error("Synthetic fixture failed validation.");
  return validated.value;
}

describe("synthetic ChatGPT representation policy", () => {
  it("keeps the default admission ceiling when no policy is supplied", () => {
    const admitted = toSyntheticChatGptRepresentation(validatedFixture(100), baseOptions);
    expect(admitted.ok).toBe(true);

    const oversized = toSyntheticChatGptRepresentation(validatedFixture(5_001), baseOptions);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.issues.some((i) => i.code === "representation-entry-count-limit")).toBe(true);
    }
  });

  it("admits an explicitly bounded 100,000-entry source through the conversion helper", () => {
    const represented = toSyntheticChatGptRepresentation(validatedFixture(5_001), {
      ...baseOptions,
      representationPolicy: { maxEntries: 100_000 },
    });
    expect(represented.ok).toBe(true);
    if (!represented.ok) return;
    expect(represented.value.entries.length).toBe(10_003);
    expect(represented.value.provenance.synthetic).toBe(true);
  });

  it("still binds sources by a lowered explicit policy", () => {
    const represented = toSyntheticChatGptRepresentation(validatedFixture(100), {
      ...baseOptions,
      representationPolicy: { maxEntries: 8, maxChildrenPerEntry: 4 },
    });
    expect(represented.ok).toBe(false);
    if (!represented.ok) {
      expect(represented.issues.some((i) => i.code === "representation-entry-count-limit")).toBe(true);
    }
  });

  it("rejects malformed policies as content-free issues without invoking accessors", () => {
    let invoked = false;
    const accessorPolicy = Object.defineProperty({}, "maxEntries", {
      enumerable: true,
      get() {
        invoked = true;
        return 100_000;
      },
    });
    const accessorResult = toSyntheticChatGptRepresentation(validatedFixture(2), {
      ...baseOptions,
      representationPolicy: accessorPolicy,
    });
    expect(accessorResult.ok).toBe(false);
    expect(invoked).toBe(false);

    const results = [
      toSyntheticChatGptRepresentation(validatedFixture(2), {
        ...baseOptions,
        representationPolicy: { maxEntries: 100_000, bogus: 1 } as unknown as Record<string, number>,
      }),
      toSyntheticChatGptRepresentation(validatedFixture(2), {
        ...baseOptions,
        representationPolicy: { maxEntries: 1.5 },
      }),
      toSyntheticChatGptRepresentation(validatedFixture(2), {
        ...baseOptions,
        representationPolicy: { maxEntrySerializedBytes: 33_554_433 },
      }),
      toSyntheticChatGptRepresentation(validatedFixture(2), {
        ...baseOptions,
        representationPolicy: { maxTextCodeUnits: 262_143 },
      }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.path === "$.representationPolicy")).toBe(true);
      }
    }
  });

  it("keeps conversion synthetic-only even with an explicit policy", () => {
    const conversation = validatedFixture(2);
    delete (conversation.raw as { elatura_fixture?: unknown }).elatura_fixture;
    const represented = toSyntheticChatGptRepresentation(conversation, {
      ...baseOptions,
      representationPolicy: { maxEntries: 100_000 },
    });
    expect(represented.ok).toBe(false);
    if (!represented.ok) {
      expect(represented.issues.some((i) => i.code === "synthetic-representation-only")).toBe(true);
    }
  });
});
