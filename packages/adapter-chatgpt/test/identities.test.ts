// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  ADAPTER_COMPATIBILITY_IDENTITIES,
  ADAPTER_COMPATIBILITY_REGISTRY_SCHEMA_VERSION,
  CHATGPT_ADAPTER_ID,
  CHATGPT_ADAPTER_VERSION,
  SYNTHETIC_CHATGPT_ADAPTER_ID,
  SYNTHETIC_CHATGPT_ADAPTER_VERSION,
} from "../src/identities.js";
import { chatGptAdapter, chatGptAdapterVersionPolicy } from "../src/contracts.js";
import { createSyntheticChatGptPipelineAdapter } from "../src/synthetic.js";

describe("adapter compatibility identities", () => {
  it("exports one immutable normalized registry", () => {
    expect(ADAPTER_COMPATIBILITY_REGISTRY_SCHEMA_VERSION).toBe(1);
    expect(ADAPTER_COMPATIBILITY_IDENTITIES).toEqual([
      {
        name: "inspection",
        id: "chatgpt-conversation",
        version: "0.3.0",
      },
      {
        name: "synthetic-transform",
        id: "chatgpt-synthetic-conversation",
        version: "0.1.0",
      },
    ]);
    expect(Object.isFrozen(ADAPTER_COMPATIBILITY_IDENTITIES)).toBe(true);
    expect(ADAPTER_COMPATIBILITY_IDENTITIES.every(Object.isFrozen)).toBe(true);
    expect(new Set(ADAPTER_COMPATIBILITY_IDENTITIES.map(({ id, version }) => `${id}\u0000${version}`)).size)
      .toBe(ADAPTER_COMPATIBILITY_IDENTITIES.length);
  });

  it("binds adapter exports and version policy to the registry", () => {
    expect(chatGptAdapter).toMatchObject({
      id: CHATGPT_ADAPTER_ID,
      version: CHATGPT_ADAPTER_VERSION,
    });
    expect(chatGptAdapterVersionPolicy).toEqual({
      adapterId: CHATGPT_ADAPTER_ID,
      currentVersion: CHATGPT_ADAPTER_VERSION,
      readableVersions: [],
    });

    const synthetic = createSyntheticChatGptPipelineAdapter();
    expect(synthetic).toMatchObject({
      id: SYNTHETIC_CHATGPT_ADAPTER_ID,
      version: SYNTHETIC_CHATGPT_ADAPTER_VERSION,
    });
  });
});
