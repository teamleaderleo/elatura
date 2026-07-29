// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  defineAdapterCapabilities,
  type ApplicationAdapter,
} from "../src/adapter-contract.js";
import { runAdapterConformance } from "../src/conformance.js";

describe("conformance stage presence", () => {
  it("treats null plans and null materialized outputs as produced values", () => {
    const adapter: ApplicationAdapter<
      { value: number },
      null,
      null,
      { enabled: true }
    > = {
      id: "null-stage-values",
      version: "1.0.0",
      capabilities: defineAdapterCapabilities({
        plan: "supported",
        materialize: "supported",
        validateOutput: "supported",
      }),
      detect(input) {
        return typeof input === "object" && input !== null && "value" in input;
      },
      validate(input) {
        return typeof input === "object" && input !== null && "value" in input && typeof input.value === "number"
          ? { ok: true, value: { value: input.value }, warnings: [] }
          : { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected a value." }] };
      },
      fingerprint() {
        return {
          adapter: "null-stage-values",
          adapterVersion: "1.0.0",
          shape: "{value:number}",
          hash: "fixed",
        };
      },
      plan() {
        return { ok: true, value: null, warnings: [] };
      },
      materialize(_source, plan) {
        if (plan !== null) {
          return { ok: false, issues: [{ path: "$", code: "invalid-plan", message: "Expected null." }] };
        }
        return { ok: true, value: null, warnings: [] };
      },
      validateOutput(output) {
        return output === null
          ? { ok: true, value: null, warnings: [] }
          : { ok: false, issues: [{ path: "$", code: "invalid-output", message: "Expected null." }] };
      },
    };

    expect(
      runAdapterConformance(adapter, {
        validInput: { value: 1 },
        planOptions: { enabled: true },
      }),
    ).toEqual({ ok: true, issues: [] });
  });
});
