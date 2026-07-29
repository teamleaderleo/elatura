// SPDX-License-Identifier: MPL-2.0
import { expect } from "vitest";
import { corruptMissingChild, generateSyntheticConversation } from "@elatura/fixtures";
import { isRecord } from "@elatura/core";
import { defineAdapterCapabilities } from "@elatura/core/adapter-contract";
import { validateChatGptConversation } from "../src/index.js";
import {
  createSyntheticChatGptPipelineAdapter,
  SYNTHETIC_CHATGPT_ADAPTER_ID,
  SYNTHETIC_CHATGPT_ADAPTER_VERSION,
} from "../src/synthetic.js";
import { defineProductionAdapterAcceptanceSuite } from "./production-adapter-acceptance.js";

const PRIVATE_SENTINEL = "ELATURA-SYNTHETIC-PRIVATE-PROBE-7f31d9";

const validInput = generateSyntheticConversation({
  turnGroups: 10,
  branchEvery: 2,
  payloadBytesPerMessage: 96,
  seed: 73,
});
validInput.future_top_level_field = {
  ...(validInput.future_top_level_field ?? {}),
  privateProbe: PRIVATE_SENTINEL,
};

const unrelatedInput = structuredClone(validInput) as Record<string, unknown>;
delete unrelatedInput.elatura_fixture;

const ambiguousInput = structuredClone(validInput) as Record<string, unknown>;
ambiguousInput.elatura_fixture = "malformed";

const invalidInput = corruptMissingChild(validInput);

const schemaDriftInput = structuredClone(validInput) as typeof validInput & Record<string, unknown>;
schemaDriftInput.unexpected_live_schema_field = { synthetic: true };

const expectedCapabilities = defineAdapterCapabilities({
  plan: "supported",
  materialize: "supported",
  validateOutput: "supported",
  branches: "supported",
});

const baseAdapter = createSyntheticChatGptPipelineAdapter({ maxGroups: 2 });
const referenceAdapter = Object.freeze({
  ...baseAdapter,
  capabilities: expectedCapabilities,
  fingerprint: (
    source: Parameters<typeof baseAdapter.fingerprint>[0],
    context: Parameters<typeof baseAdapter.fingerprint>[1],
  ) => {
    const fingerprint = baseAdapter.fingerprint(source, context);
    return "unexpected_live_schema_field" in source.raw
      ? { ...fingerprint, adapterVersion: "unsupported-schema" }
      : fingerprint;
  },
});

defineProductionAdapterAcceptanceSuite({
  name: "production ChatGPT adapter acceptance harness reference",
  adapter: referenceAdapter,
  expectedIdentity: {
    id: SYNTHETIC_CHATGPT_ADAPTER_ID,
    version: SYNTHETIC_CHATGPT_ADAPTER_VERSION,
  },
  expectedCapabilities,
  validInput,
  passThroughCases: [
    {
      name: "an unrelated application object",
      input: unrelatedInput,
      stage: "detect",
      reasonCode: "detect-no-match",
    },
    {
      name: "a partial or conflicting detector marker",
      input: ambiguousInput,
      stage: "detect",
      reasonCode: "detect-ambiguous",
    },
    {
      name: "an invalid reciprocal graph",
      input: invalidInput,
      stage: "validate-input",
      reasonCode: "input-invalid",
    },
    {
      name: "an unapproved schema fingerprint",
      input: schemaDriftInput,
      stage: "fingerprint",
      reasonCode: "fingerprint-invalid",
    },
  ],
  budgetFailureCases: [
    {
      name: "input byte ceiling",
      budgets: { maxInputBytes: 1 },
      stage: "detect",
      reasonCode: "budget-input-size-exceeded",
    },
    {
      name: "input traversal node ceiling",
      budgets: { maxNodes: 1 },
      stage: "detect",
      reasonCode: "budget-node-count-exceeded",
    },
    {
      name: "materialization allocation ceiling",
      budgets: { maxAllocatedBytes: 32 },
      stage: "materialize",
      reasonCode: "budget-allocation-exceeded",
    },
  ],
  forbiddenDiagnosticTokens: [PRIVATE_SENTINEL],
  assertOutput: (output, authoritativeInput) => {
    expect(validateChatGptConversation(output).ok).toBe(true);
    expect(Object.keys(output.mapping).length).toBeLessThan(
      Object.keys(authoritativeInput.mapping).length,
    );
    expect(output.future_top_level_field).toEqual(authoritativeInput.future_top_level_field);
    expect(output.mapping[authoritativeInput.current_node]?.future_node_field).toEqual(
      authoritativeInput.mapping[authoritativeInput.current_node]?.future_node_field,
    );
  },
  createTamperingAdapter: (adapter) =>
    Object.freeze({
      ...adapter,
      materialize: (...args: Parameters<typeof adapter.materialize>): unknown => {
        const candidate = adapter.materialize(...args);
        if (!isRecord(candidate) || !isRecord(candidate.mapping)) return candidate;
        const currentNode = candidate.current_node;
        const current = typeof currentNode === "string" ? candidate.mapping[currentNode] : undefined;
        if (isRecord(current)) current.children = ["missing-production-node"];
        return candidate;
      },
    }),
});
