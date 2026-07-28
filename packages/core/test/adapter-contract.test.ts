// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  assessAdapterVersionCompatibility,
  defineAdapterCapabilities,
  type ApplicationAdapter,
} from "../src/adapter-contract.js";
import { runAdapterConformance } from "../src/conformance.js";

function validValue(input: unknown): input is { value: number } {
  return typeof input === "object" && input !== null && "value" in input && typeof input.value === "number";
}

const toyAdapter: ApplicationAdapter<
  { value: number },
  { factor: number },
  { value: number },
  { factor: number }
> = {
  id: "toy",
  version: "2.0.0",
  capabilities: defineAdapterCapabilities({
    plan: "supported",
    materialize: "supported",
    validateOutput: "supported",
  }),
  detect: validValue,
  validate(input) {
    return validValue(input)
      ? { ok: true, value: { value: input.value }, warnings: [] }
      : { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected a numeric value." }] };
  },
  fingerprint(source) {
    return { adapter: "toy", adapterVersion: "2.0.0", shape: "{value:number}", hash: String(source.value >= 0) };
  },
  plan(_source, options) {
    return { ok: true, value: { factor: options.factor }, warnings: [] };
  },
  materialize(source, plan) {
    return { ok: true, value: { value: source.value * plan.factor }, warnings: [] };
  },
  validateOutput(output) {
    return validValue(output)
      ? { ok: true, value: { value: output.value }, warnings: [] }
      : { ok: false, issues: [{ path: "$", code: "invalid-output", message: "Expected a numeric value." }] };
  },
};

describe("application adapter contracts", () => {
  it("runs every declared pipeline stage through one reusable conformance check", () => {
    expect(
      runAdapterConformance(toyAdapter, {
        validInput: { value: 7 },
        invalidInput: { value: "seven" },
        planOptions: { factor: 3 },
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("reports declared stage methods that are absent", () => {
    const broken = {
      ...toyAdapter,
      materialize: undefined,
    } as unknown as typeof toyAdapter;
    const result = runAdapterConformance(broken, {
      validInput: { value: 2 },
      planOptions: { factor: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "missing-stage-method")).toBe(true);
  });

  it("requires explicit compatibility declarations across adapter versions", () => {
    expect(
      assessAdapterVersionCompatibility(
        { id: "toy", version: "1.5.0" },
        { adapterId: "toy", currentVersion: "2.0.0", readableVersions: ["1.5.0"] },
      ),
    ).toEqual({ compatible: true, mode: "declared-compatible" });
    expect(
      assessAdapterVersionCompatibility(
        { id: "toy", version: "1.4.0" },
        { adapterId: "toy", currentVersion: "2.0.0", readableVersions: ["1.5.0"] },
      ),
    ).toEqual({ compatible: false, reason: "adapter-version-incompatible" });
  });
});
