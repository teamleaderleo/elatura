// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type { AdapterCapabilities } from "@elatura/core/adapter-contract";
import {
  PIPELINE_STAGES,
  runFailOpenPipeline,
  type FailOpenPipelineAdapter,
  type PassThroughReasonCode,
  type PipelineBudgets,
  type PipelineFaultMode,
  type PipelineFaults,
  type PipelineStage,
  type RunFailOpenPipelineOptions,
} from "@elatura/core/orchestration";

export type ProductionAdapterPassThroughCase = Readonly<{
  name: string;
  input: unknown;
  stage: PipelineStage;
  reasonCode: PassThroughReasonCode;
}>;

export type ProductionAdapterBudgetFailureCase = Readonly<{
  name: string;
  input?: unknown;
  budgets: Partial<PipelineBudgets>;
  stage: PipelineStage;
  reasonCode: PassThroughReasonCode;
}>;

export type ProductionAdapterAcceptanceConfig<TInput, TSource, TPlan, TOutput> = Readonly<{
  name: string;
  adapter: FailOpenPipelineAdapter<TSource, TPlan, TOutput>;
  expectedIdentity: Readonly<{ id: string; version: string }>;
  expectedCapabilities: AdapterCapabilities;
  validInput: TInput;
  acceptedBudgets?: Partial<PipelineBudgets>;
  passThroughCases: readonly ProductionAdapterPassThroughCase[];
  budgetFailureCases: readonly ProductionAdapterBudgetFailureCase[];
  forbiddenDiagnosticTokens: readonly string[];
  assertOutput(output: TOutput, authoritativeInput: TInput): void;
  createTamperingAdapter(
    adapter: FailOpenPipelineAdapter<TSource, TPlan, TOutput>,
  ): FailOpenPipelineAdapter<TSource, TPlan, TOutput>;
}>;

function runOptions(
  budgets?: Partial<PipelineBudgets>,
  faults?: PipelineFaults,
): RunFailOpenPipelineOptions {
  return {
    clock: () => 0,
    ...(budgets === undefined ? {} : { budgets }),
    ...(faults === undefined ? {} : { faults }),
  };
}

function expectNoCandidate(value: unknown): void {
  expect(value).toMatchObject({ kind: "pass-through" });
  expect(value && typeof value === "object" && "output" in value).toBe(false);
}

function expectContentFreeDiagnostic(
  diagnostic: unknown,
  forbiddenTokens: readonly string[],
): void {
  const serialized = JSON.stringify(diagnostic);
  for (const token of forbiddenTokens) {
    expect(token.length).toBeGreaterThan(0);
    expect(serialized).not.toContain(token);
  }
}

function faultExpectation(mode: PipelineFaultMode): PassThroughReasonCode {
  if (mode === "cancel") return "cancelled";
  if (mode === "budget") return "budget-operation-exceeded";
  return "fault-injected";
}

export function defineProductionAdapterAcceptanceSuite<TInput, TSource, TPlan, TOutput>(
  config: ProductionAdapterAcceptanceConfig<TInput, TSource, TPlan, TOutput>,
): void {
  const run = (
    input: unknown,
    adapter = config.adapter,
    budgets = config.acceptedBudgets,
    faults?: PipelineFaults,
  ) => runFailOpenPipeline(input, adapter, runOptions(budgets, faults));

  describe(config.name, () => {
    it("declares the reviewed production identity and capability boundary", () => {
      expect({ id: config.adapter.id, version: config.adapter.version }).toEqual(
        config.expectedIdentity,
      );
      expect(config.adapter.capabilities).toEqual(config.expectedCapabilities);
      expect(config.expectedCapabilities.plan).toBe("supported");
      expect(config.expectedCapabilities.materialize).toBe("supported");
      expect(config.expectedCapabilities.validateOutput).toBe("supported");
      expect(config.expectedCapabilities.branches).toBe("supported");
      expect(config.expectedCapabilities.cache).toBe("unsupported");
      expect(config.expectedCapabilities.submission).toBe("unsupported");
      expect(config.expectedCapabilities.alternateRepresentation).toBe("unsupported");
    });

    it("completes every pure stage for the evidence-shaped accepted fixture", () => {
      const before = structuredClone(config.validInput);
      const result = run(config.validInput);

      expect(result.kind).toBe("transformed");
      if (result.kind !== "transformed") return;
      expect(result.authoritativeInput).toBe(config.validInput);
      expect(result.output).not.toBe(config.validInput);
      expect(result.diagnostic.adapter).toEqual(config.expectedIdentity);
      expect(result.diagnostic.completedStages).toEqual(PIPELINE_STAGES);
      expect(result.diagnostic.reasonCode).toBe("transformed");
      expect(config.validInput).toEqual(before);
      config.assertOutput(result.output, config.validInput);
      expectContentFreeDiagnostic(result.diagnostic, config.forbiddenDiagnosticTokens);
    });

    it("is deterministic for identical input, policy, budgets, and clock", () => {
      const before = structuredClone(config.validInput);
      const first = run(config.validInput);
      const second = run(config.validInput);

      expect(first.kind).toBe("transformed");
      expect(second.kind).toBe("transformed");
      if (first.kind !== "transformed" || second.kind !== "transformed") return;
      expect(first.output).toEqual(second.output);
      expect(first.output).not.toBe(second.output);
      expect(first.diagnostic).toEqual(second.diagnostic);
      expect(config.validInput).toEqual(before);
      config.assertOutput(first.output, config.validInput);
      config.assertOutput(second.output, config.validInput);
    });

    for (const testCase of config.passThroughCases) {
      it(`passes through ${testCase.name} without exposing a candidate`, () => {
        const before = structuredClone(testCase.input);
        const result = run(testCase.input);

        expectNoCandidate(result);
        if (result.kind !== "pass-through") return;
        expect(result.authoritativeInput).toBe(testCase.input);
        expect(result.outcome.stage).toBe(testCase.stage);
        expect(result.outcome.reasonCode).toBe(testCase.reasonCode);
        expect(testCase.input).toEqual(before);
        expectContentFreeDiagnostic(result.diagnostic, config.forbiddenDiagnosticTokens);
      });
    }

    const faultModes: readonly PipelineFaultMode[] = ["throw", "cancel", "budget"];
    for (const [stageIndex, stage] of PIPELINE_STAGES.entries()) {
      for (const mode of faultModes) {
        it(`fails open when ${mode} is injected at ${stage}`, () => {
          const faults = { [stage]: mode } as PipelineFaults;
          const result = run(config.validInput, config.adapter, config.acceptedBudgets, faults);

          expectNoCandidate(result);
          if (result.kind !== "pass-through") return;
          expect(result.authoritativeInput).toBe(config.validInput);
          expect(result.outcome.stage).toBe(stage);
          expect(result.outcome.reasonCode).toBe(faultExpectation(mode));
          expect(result.diagnostic.completedStages).toEqual(PIPELINE_STAGES.slice(0, stageIndex));
          expectContentFreeDiagnostic(result.diagnostic, config.forbiddenDiagnosticTokens);
        });
      }
    }

    for (const testCase of config.budgetFailureCases) {
      it(`fails open at the calibrated boundary: ${testCase.name}`, () => {
        const input = "input" in testCase ? testCase.input : config.validInput;
        const result = run(input, config.adapter, testCase.budgets);

        expectNoCandidate(result);
        if (result.kind !== "pass-through") return;
        expect(result.authoritativeInput).toBe(input);
        expect(result.outcome.stage).toBe(testCase.stage);
        expect(result.outcome.reasonCode).toBe(testCase.reasonCode);
        expectContentFreeDiagnostic(result.diagnostic, config.forbiddenDiagnosticTokens);
      });
    }

    it("withholds a tampered materialization rejected by independent validation", () => {
      const tamperingAdapter = config.createTamperingAdapter(config.adapter);
      const result = run(config.validInput, tamperingAdapter);

      expectNoCandidate(result);
      if (result.kind !== "pass-through") return;
      expect(result.authoritativeInput).toBe(config.validInput);
      expect(result.outcome.stage).toBe("validate-output");
      expect(result.outcome.reasonCode).toBe("output-invalid");
      expectContentFreeDiagnostic(result.diagnostic, config.forbiddenDiagnosticTokens);
    });
  });
}
