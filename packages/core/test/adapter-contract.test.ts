// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  assessAdapterVersionCompatibility,
  defineAdapterCapabilities,
  type ApplicationAdapter,
} from "../src/adapter-contract.js";
import {
  runAdapterConformance,
  type AdapterConformanceResult,
  type AdapterConformanceStage,
} from "../src/conformance.js";
import type { ReadOnlyRepresentation } from "../src/representation.js";

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

function expectIssue(
  result: AdapterConformanceResult,
  stage: AdapterConformanceStage,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.some((issue) => issue.stage === stage && issue.code === code)).toBe(true);
  }
}

function alternateRepresentation(value: number, suffix: string): ReadOnlyRepresentation {
  const adapter = { id: "toy-alternate", version: "1.0.0" };
  return {
    version: 1,
    adapter,
    provenance: {
      authority: {
        origin: "https://synthetic.elatura.invalid",
        reference: "https://synthetic.elatura.invalid/item",
      },
      capturedAt: 100,
      adapter,
      transformation: {
        kind: "alternate-representation",
        id: "toy-alternate",
        version: "1",
      },
      cache: { kind: "none" },
      freshness: { capturedAt: 100, staleAt: 200, expiresAt: 300 },
      synthetic: true,
    },
    roots: ["entry"],
    activePath: ["entry"],
    entries: [
      {
        id: "entry",
        parentId: null,
        childIds: [],
        sequence: 0,
        kind: "toy",
        text: `${value}-${suffix}`,
        codeBlocks: [],
      },
    ],
  };
}

const alternateAdapter: ApplicationAdapter<
  { value: number },
  never,
  never,
  never,
  ReadOnlyRepresentation,
  { suffix: string }
> = {
  id: "toy-alternate",
  version: "1.0.0",
  capabilities: defineAdapterCapabilities({ alternateRepresentation: "synthetic-only" }),
  detect: validValue,
  validate(input) {
    return validValue(input)
      ? { ok: true, value: { value: input.value }, warnings: [] }
      : { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected a numeric value." }] };
  },
  fingerprint() {
    return {
      adapter: "toy-alternate",
      adapterVersion: "1.0.0",
      shape: "{value:number}",
      hash: "fixed",
    };
  },
  alternateRepresentation(source, options) {
    return { ok: true, value: alternateRepresentation(source.value, options.suffix), warnings: [] };
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
    expectIssue(result, "declaration", "missing-stage-method");
  });

  it("bounds canonical snapshots before enumerating a wide fixture", () => {
    const wide = Object.fromEntries([
      ["value", 7],
      ...Array.from({ length: 10_000 }, (_, index) => [`field-${index}`, index] as const),
    ]);
    const result = runAdapterConformance(toyAdapter, {
      validInput: wide,
      planOptions: { factor: 2 },
      maxSnapshotUnits: 32,
    });
    expectIssue(result, "detect", "snapshot-budget-exceeded");
  });

  it("detects mutation by every transform pipeline stage", () => {
    const detectMutation: typeof toyAdapter = {
      ...toyAdapter,
      detect(input) {
        if (validValue(input)) input.value += 1;
        return validValue(input);
      },
    };
    expectIssue(
      runAdapterConformance(detectMutation, {
        validInput: { value: 2 },
        planOptions: { factor: 2 },
      }),
      "detect",
      "input-mutated",
    );

    const validateMutation: typeof toyAdapter = {
      ...toyAdapter,
      validate(input) {
        if (!validValue(input)) {
          return { ok: false, issues: [{ path: "$", code: "invalid", message: "Invalid." }] };
        }
        input.value += 1;
        return { ok: true, value: { value: input.value }, warnings: [] };
      },
    };
    expectIssue(
      runAdapterConformance(validateMutation, {
        validInput: { value: 2 },
        planOptions: { factor: 2 },
      }),
      "validate",
      "input-mutated",
    );

    const fingerprintMutation: typeof toyAdapter = {
      ...toyAdapter,
      fingerprint(source) {
        source.value += 1;
        return {
          adapter: "toy",
          adapterVersion: "2.0.0",
          shape: "{value:number}",
          hash: "fixed",
        };
      },
    };
    expectIssue(
      runAdapterConformance(fingerprintMutation, {
        validInput: { value: 2 },
        planOptions: { factor: 2 },
      }),
      "fingerprint",
      "input-mutated",
    );

    const planMutation: typeof toyAdapter = {
      ...toyAdapter,
      plan(_source, options) {
        options.factor += 1;
        return { ok: true, value: { factor: options.factor }, warnings: [] };
      },
    };
    expectIssue(
      runAdapterConformance(planMutation, {
        validInput: { value: 2 },
        planOptions: { factor: 2 },
      }),
      "plan",
      "input-mutated",
    );

    const materializeMutation: typeof toyAdapter = {
      ...toyAdapter,
      materialize(source, plan) {
        source.value += 1;
        plan.factor += 1;
        return { ok: true, value: { value: source.value * plan.factor }, warnings: [] };
      },
    };
    expectIssue(
      runAdapterConformance(materializeMutation, {
        validInput: { value: 2 },
        planOptions: { factor: 2 },
      }),
      "materialize",
      "input-mutated",
    );

    const outputValidationMutation: typeof toyAdapter = {
      ...toyAdapter,
      validateOutput(output) {
        if (!validValue(output)) {
          return { ok: false, issues: [{ path: "$", code: "invalid", message: "Invalid." }] };
        }
        output.value += 1;
        return { ok: true, value: { value: output.value }, warnings: [] };
      },
    };
    expectIssue(
      runAdapterConformance(outputValidationMutation, {
        validInput: { value: 2 },
        planOptions: { factor: 2 },
      }),
      "validateOutput",
      "input-mutated",
    );
  });

  it("executes and generically validates a declared synthetic alternate representation", () => {
    expect(
      runAdapterConformance(alternateAdapter, {
        validInput: { value: 7 },
        synthetic: true,
        alternateOptions: { suffix: "fixture" },
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("requires an explicit synthetic scenario before executing synthetic-only capabilities", () => {
    const result = runAdapterConformance(alternateAdapter, {
      validInput: { value: 7 },
      alternateOptions: { suffix: "fixture" },
    });
    expectIssue(result, "alternateRepresentation", "synthetic-context-required");
  });

  it("detects alternate representation and validator input mutation", () => {
    const mutatingAlternate: typeof alternateAdapter = {
      ...alternateAdapter,
      alternateRepresentation(source, options) {
        source.value += 1;
        options.suffix = "changed";
        return { ok: true, value: alternateRepresentation(source.value, options.suffix), warnings: [] };
      },
    };
    const represented = runAdapterConformance(mutatingAlternate, {
      validInput: { value: 7 },
      synthetic: true,
      alternateOptions: { suffix: "fixture" },
    });
    expectIssue(represented, "alternateRepresentation", "input-mutated");

    const validatorMutation = runAdapterConformance(alternateAdapter, {
      validInput: { value: 7 },
      synthetic: true,
      alternateOptions: { suffix: "fixture" },
      validateAlternateRepresentation(input) {
        const candidate = input as ReadOnlyRepresentation;
        candidate.roots.push("mutated");
        return { ok: true, value: candidate, warnings: [] };
      },
    });
    expectIssue(validatorMutation, "validateAlternateRepresentation", "input-mutated");
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
