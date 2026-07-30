// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { SyntheticCompanion } from "../src/companion.js";

describe("companion policy coherence", () => {
  it("rejects a global response string ceiling below valid page strings", () => {
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: "policy-session",
          conversations: [],
          policy: {
            maxCodeResponseCodeUnits: 1,
          },
        }),
    ).toThrow(/maxCodeResponseCodeUnits/u);
  });

  it("accepts the default coherent response ceilings", () => {
    expect(
      () =>
        new SyntheticCompanion({
          sessionId: "policy-session",
          conversations: [],
        }),
    ).not.toThrow();
  });
});
