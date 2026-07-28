// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { runAdapterConformance } from "@elatura/core/conformance";
import {
  extractReadOnlyCode,
  searchReadOnlyRepresentation,
} from "@elatura/core/representation";
import { generateSyntheticConversation } from "@elatura/fixtures";
import {
  chatGptAdapter,
  toSyntheticChatGptRepresentation,
  validateChatGptConversation,
} from "../src/index.js";

const representationOptions = {
  authorityOrigin: "https://synthetic.elatura.invalid",
  authorityReference: "https://synthetic.elatura.invalid/conversation",
  capturedAt: 100,
  staleAt: 200,
  expiresAt: 300,
};

describe("ChatGPT adapter contracts", () => {
  it("declares optional features without implying live transformation support", () => {
    expect(chatGptAdapter.capabilities).toMatchObject({
      branches: "supported",
      paging: "unsupported",
      cache: "synthetic-only",
      submission: "unsupported",
      plan: "unsupported",
      materialize: "unsupported",
      validateOutput: "unsupported",
      alternateRepresentation: "synthetic-only",
    });
  });

  it("passes the reusable baseline conformance stages", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 8, branchEvery: 2, seed: 44 });
    expect(
      runAdapterConformance(chatGptAdapter, {
        validInput: fixture,
        invalidInput: { mapping: {} },
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("builds a searchable synthetic-only representation with code extraction and jump-back", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 3, branchEvery: 1, seed: 7 });
    const current = fixture.mapping[fixture.current_node];
    if (!current) throw new Error("Synthetic fixture is missing its current node.");
    current.message = {
      id: current.id,
      author: { role: "assistant" },
      create_time: 3,
      content: { content_type: "text", parts: ["parser\n```ts\nconst parse = () => true;\n```"] },
      metadata: { synthetic: true },
    };
    const validated = validateChatGptConversation(fixture);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const represented = toSyntheticChatGptRepresentation(validated.value, representationOptions);
    expect(represented.ok).toBe(true);
    if (!represented.ok) return;
    expect(searchReadOnlyRepresentation(represented.value, "parser").length).toBe(1);
    expect(extractReadOnlyCode(represented.value)).toEqual([
      { entryId: current.id, language: "ts", text: "const parse = () => true;\n" },
    ]);
    expect(represented.value.entries.find((entry) => entry.id === current.id)?.jumpBackReference).toContain(
      "elatura-entry=",
    );
  });

  it("refuses to bridge a fixture after its synthetic marker is removed", () => {
    const fixture = generateSyntheticConversation({ turnGroups: 2, seed: 9 });
    (fixture as unknown as { elatura_fixture?: unknown }).elatura_fixture = undefined;
    const validated = validateChatGptConversation(fixture);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const represented = toSyntheticChatGptRepresentation(validated.value, representationOptions);
    expect(represented.ok).toBe(false);
    if (!represented.ok) {
      expect(represented.issues.some((issue) => issue.code === "synthetic-representation-only")).toBe(true);
    }
  });
});
