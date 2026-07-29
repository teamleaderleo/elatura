// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { defineAdapterCapabilities } from "../src/adapter-contract.js";
import { fingerprintShape, isRecord, type ValidationResult } from "../src/index.js";
import {
  PIPELINE_STAGES,
  cloneJsonLike,
  runFailOpenPipeline,
  type FailOpenPipelineAdapter,
  type PipelineStage,
} from "../src/orchestration.js";

type Source = Readonly<{ value: number; secret?: string }>;
type Plan = Readonly<{ increment: number }>;
type Output = Readonly<{ value: number }>;

const SUPPORTED_PIPELINE_CAPABILITIES = defineAdapterCapabilities({
  plan: "supported",
  materialize: "supported",
  validateOutput: "supported",
});

const SYNTHETIC_PIPELINE_CAPABILITIES = defineAdapterCapabilities({
  plan: "synthetic-only",
  materialize: "synthetic-only",
  validateOutput: "synthetic-only",
});

function adapter(
  overrides: Partial<FailOpenPipelineAdapter<Source, Plan, Output>> = {},
): FailOpenPipelineAdapter<Source, Plan, Output> {
  return {
    id: "test-adapter",
    version: "1.0.0",
    capabilities: SUPPORTED_PIPELINE_CAPABILITIES,
    detect: () => ({ kind: "match" }),
    validateInput: (input): ValidationResult<Source> =>
      isRecord(input) && typeof input.value === "number"
        ? { ok: true, value: input as Source, warnings: [] }
        : { ok: false, issues: [{ path: "$", code: "invalid", message: "Invalid input." }] },
    fingerprint: (source) => fingerprintShape("test-adapter", "1.0.0", source),
    plan: () => ({ ok: true, value: { increment: 1 }, warnings: [] }),
    materialize: (source, plan, _fingerprint, context) => {
      context.reserveAllocation(16);
      return cloneJsonLike({ value: source.value + plan.increment }, context);
    },
    validateOutput: (candidate) =>
      isRecord(candidate) && typeof candidate.value === "number"
        ? { ok: true, value: candidate as Output, warnings: [] }
        : { ok: false, issues: [{ path: "$", code: "invalid-output", message: "Invalid output." }] },
    ...overrides,
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function expectPassThroughWithoutOutput(result: ReturnType<typeof runFailOpenPipeline>): void {
  expect(result.kind).toBe("pass-through");
  expect("output" in result).toBe(false);
}

describe("fail-open orchestration", () => {
  it("publishes a transformed value only after independent output validation", () => {
    const input = { value: 4 };
    const result = runFailOpenPipeline(input, adapter(), { clock: () => 0 });
    expect(result.kind).toBe("transformed");
    if (result.kind === "transformed") {
      expect(result.output).toEqual({ value: 5 });
      expect(result.authoritativeInput).toBe(input);
      expect(result.diagnostic.completedStages).toEqual(PIPELINE_STAGES);
      expect(result.diagnostic.reasonCode).toBe("transformed");
    }
  });

  it("rejects unsupported pipeline stage declarations before detection", () => {
    let planExecuted = false;
    const result = runFailOpenPipeline(
      { value: 4 },
      adapter({
        capabilities: defineAdapterCapabilities({
          plan: "unsupported",
          materialize: "supported",
          validateOutput: "supported",
        }),
        plan: () => {
          planExecuted = true;
          return { ok: true, value: { increment: 1 }, warnings: [] };
        },
      }),
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.stage).toBe("detect");
    expect(result.outcome.reasonCode).toBe("adapter-capability-rejected");
    expect(result.diagnostic.completedStages).toEqual([]);
    expect(planExecuted).toBe(false);
  });

  it("requires explicit synthetic context for synthetic-only stages", () => {
    const syntheticAdapter = adapter({ capabilities: SYNTHETIC_PIPELINE_CAPABILITIES });
    const denied = runFailOpenPipeline({ value: 4 }, syntheticAdapter, { clock: () => 0 });
    expectPassThroughWithoutOutput(denied);
    expect(denied.outcome.reasonCode).toBe("adapter-capability-rejected");

    const allowed = runFailOpenPipeline(
      { value: 4 },
      syntheticAdapter,
      { clock: () => 0, synthetic: true },
    );
    expect(allowed.kind).toBe("transformed");
  });

  it("rejects missing, malformed, and invalid synthetic context declarations deterministically", () => {
    const missing = adapter() as unknown as Record<string, unknown>;
    delete missing.capabilities;
    const missingResult = runFailOpenPipeline(
      { value: 1 },
      missing as unknown as FailOpenPipelineAdapter<Source, Plan, Output>,
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(missingResult);
    expect(missingResult.outcome.reasonCode).toBe("configuration-invalid");

    const malformed = adapter({ capabilities: { plan: "supported" } as never });
    const malformedResult = runFailOpenPipeline({ value: 1 }, malformed, { clock: () => 0 });
    expectPassThroughWithoutOutput(malformedResult);
    expect(malformedResult.outcome.reasonCode).toBe("configuration-invalid");

    const invalidContext = runFailOpenPipeline(
      { value: 1 },
      adapter(),
      { clock: () => 0, synthetic: "yes" } as never,
    );
    expectPassThroughWithoutOutput(invalidContext);
    expect(invalidContext.outcome.reasonCode).toBe("configuration-invalid");
  });

  it("rejects accessor-backed capability declarations without invoking getters", () => {
    let getterInvoked = false;
    const candidate = adapter() as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, "capabilities", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterInvoked = true;
        return SUPPORTED_PIPELINE_CAPABILITIES;
      },
    });
    const result = runFailOpenPipeline(
      { value: 1 },
      candidate as unknown as FailOpenPipelineAdapter<Source, Plan, Output>,
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("configuration-invalid");
    expect(getterInvoked).toBe(false);
  });

  it.each(PIPELINE_STAGES)("fails open when %s throws through fault injection", (stage) => {
    const input = { value: 4 };
    const result = runFailOpenPipeline(input, adapter(), {
      clock: () => 0,
      faults: { [stage]: "throw" },
    });
    expectPassThroughWithoutOutput(result);
    expect(result.authoritativeInput).toBe(input);
    expect(result.outcome.stage).toBe(stage);
    expect(result.outcome.reasonCode).toBe("fault-injected");
  });

  it.each(PIPELINE_STAGES)("fails open when %s is cancelled through fault injection", (stage) => {
    const result = runFailOpenPipeline({ value: 4 }, adapter(), {
      clock: () => 0,
      faults: { [stage]: "cancel" },
    });
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.stage).toBe(stage);
    expect(result.outcome.reasonCode).toBe("cancelled");
  });

  it("discards a materialized candidate when cancellation arrives before output validation", () => {
    let cancelled = false;
    const signal = { get aborted() { return cancelled; } };
    const base = adapter();
    const result = runFailOpenPipeline(
      { value: 7 },
      adapter({
        materialize: (source, plan, fingerprint, context) => {
          const candidate = base.materialize(source, plan, fingerprint, context);
          cancelled = true;
          return candidate;
        },
      }),
      { clock: () => 0, cancellation: signal },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.stage).toBe("materialize");
    expect(result.outcome.reasonCode).toBe("cancelled");
  });

  it("fails open on ambiguous detection", () => {
    const result = runFailOpenPipeline(
      { value: 1 },
      adapter({ detect: () => ({ kind: "ambiguous" }) }),
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("detect-ambiguous");
  });

  it("never returns a candidate rejected by output validation", () => {
    const result = runFailOpenPipeline(
      { value: 1 },
      adapter({
        materialize: () => ({ value: 2, partial: true }),
        validateOutput: () => ({
          ok: false,
          issues: [{ path: "$.partial", code: "partial", message: "Partial candidate." }],
        }),
      }),
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("output-invalid");
    expect(result.diagnostic.issueCount).toBe(1);
  });

  it.each([
    ["budget-time-exceeded", { budgets: { maxElapsedMs: 0 }, clock: (() => { let tick = 0; return () => tick++; })() }],
    ["budget-input-size-exceeded", { budgets: { maxInputBytes: 1 }, clock: () => 0 }],
    ["budget-node-count-exceeded", { budgets: { maxNodes: 1 }, clock: () => 0 }],
    ["budget-recursion-exceeded", { budgets: { maxRecursionDepth: 0 }, clock: () => 0 }],
    ["budget-operation-exceeded", { budgets: { maxOperations: 1 }, clock: () => 0 }],
    ["budget-allocation-exceeded", { budgets: { maxAllocatedBytes: 1 }, clock: () => 0 }],
  ] as const)("returns stable reason code %s for its resource budget", (reasonCode, options) => {
    const result = runFailOpenPipeline({ value: 1, secret: "content" }, adapter(), options);
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe(reasonCode);
  });

  it("rejects cyclic authoritative input as an unsupported schema", () => {
    const cyclic: Record<string, unknown> = { value: 1 };
    cyclic.self = cyclic;
    const result = runFailOpenPipeline(cyclic, adapter(), { clock: () => 0 });
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("input-schema-unsupported");
  });

  it("returns stable codes for malformed adapter stage results", () => {
    const cases: Array<[PipelineStage, FailOpenPipelineAdapter<Source, Plan, Output>, string]> = [
      ["detect", adapter({ detect: (() => ({})) as never }), "detect-result-invalid"],
      ["validate-input", adapter({ validateInput: (() => ({})) as never }), "validate-input-result-invalid"],
      ["fingerprint", adapter({ fingerprint: (() => ({})) as never }), "fingerprint-invalid"],
      ["plan", adapter({ plan: (() => ({})) as never }), "plan-result-invalid"],
      ["validate-output", adapter({ validateOutput: (() => ({})) as never }), "validate-output-result-invalid"],
    ];
    for (const [stage, candidateAdapter, reasonCode] of cases) {
      const result = runFailOpenPipeline({ value: 1 }, candidateAdapter, { clock: () => 0 });
      expectPassThroughWithoutOutput(result);
      expect(result.outcome.stage).toBe(stage);
      expect(result.outcome.reasonCode).toBe(reasonCode);
    }
  });

  it("is deterministic and preserves the authoritative input exactly", () => {
    const input = freezeDeep({ value: 9, secret: "private-content", nested: { retained: true } });
    const before = structuredClone(input);
    const first = runFailOpenPipeline(input, adapter(), { clock: () => 0 });
    const second = runFailOpenPipeline(input, adapter(), { clock: () => 0 });
    expect(first).toEqual(second);
    expect(first.authoritativeInput).toBe(input);
    expect(input).toEqual(before);
  });

  it("isolates and freezes the authoritative input before adapter execution", () => {
    const input = { value: 4, nested: { retained: true } };
    const before = structuredClone(input);
    let observedCopy: unknown;
    const result = runFailOpenPipeline(
      input,
      adapter({
        detect: (candidate) => {
          observedCopy = candidate;
          (candidate as { value: number }).value = 99;
          return { kind: "match" };
        },
      }),
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.stage).toBe("detect");
    expect(result.outcome.reasonCode).toBe("detect-exception");
    expect(observedCopy).not.toBe(input);
    expect(input).toEqual(before);
  });

  it("rejects accessor-backed input without invoking application getters", () => {
    let getterInvoked = false;
    const input = Object.defineProperty({ value: 1 }, "secret", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return "application-content";
      },
    });
    const result = runFailOpenPipeline(input, adapter(), { clock: () => 0 });
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("input-schema-unsupported");
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed adapter methods without invoking their getters", () => {
    let getterInvoked = false;
    const candidate = adapter() as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, "detect", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterInvoked = true;
        return () => ({ kind: "match" });
      },
    });
    const result = runFailOpenPipeline(
      { value: 1 },
      candidate as unknown as FailOpenPipelineAdapter<Source, Plan, Output>,
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("configuration-invalid");
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed stage results without invoking their getters", () => {
    let getterInvoked = false;
    const result = runFailOpenPipeline(
      { value: 1 },
      adapter({
        detect: (() => Object.defineProperty({}, "kind", {
          enumerable: true,
          get: () => {
            getterInvoked = true;
            return "match";
          },
        })) as never,
      }),
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("detect-result-invalid");
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed adapter identity without invoking its getter", () => {
    let getterInvoked = false;
    const candidate = adapter() as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, "id", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterInvoked = true;
        return "application-content";
      },
    });
    const result = runFailOpenPipeline(
      { value: 1 },
      candidate as unknown as FailOpenPipelineAdapter<Source, Plan, Output>,
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("configuration-invalid");
    expect(result.diagnostic.adapter).toEqual({ id: "invalid-adapter", version: "invalid-version" });
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed fingerprints without invoking their getters", () => {
    let getterInvoked = false;
    const result = runFailOpenPipeline(
      { value: 1 },
      adapter({
        fingerprint: (() => {
          const candidate = {
            adapter: "test-adapter",
            adapterVersion: "1.0.0",
            shape: "{value:number}",
          } as Record<string, unknown>;
          Object.defineProperty(candidate, "hash", {
            enumerable: true,
            get: () => {
              getterInvoked = true;
              return "application-content";
            },
          });
          return candidate;
        }) as never,
      }),
      { clock: () => 0 },
    );
    expectPassThroughWithoutOutput(result);
    expect(result.outcome.reasonCode).toBe("fingerprint-invalid");
    expect(getterInvoked).toBe(false);
  });

  it("keeps application content and validation details out of diagnostics", () => {
    const secret = "synthetic-secret-never-serialize";
    const result = runFailOpenPipeline(
      { value: 1, secret },
      adapter({
        validateInput: () => ({
          ok: false,
          issues: [{ path: `$.${secret}`, code: "secret-code", message: secret }],
        }),
      }),
      { clock: () => 0 },
    );
    const serialized = JSON.stringify(result.diagnostic);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("secret-code");
    expect(Object.keys(result.diagnostic).sort()).toEqual([
      "adapter",
      "budget",
      "completedStages",
      "decision",
      "issueCount",
      "pipelineVersion",
      "reasonCode",
      "schemaVersion",
      "stage",
    ]);
  });
});
