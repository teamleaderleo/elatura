// SPDX-License-Identifier: MPL-2.0
import type { AdapterCapabilities, AdapterIdentity } from "./adapter-contract.js";
import type { StructuralFingerprint, ValidationResult } from "./index.js";

export const FAIL_OPEN_PIPELINE_VERSION = "0.1.0" as const;
export const PIPELINE_STAGES = [
  "detect",
  "validate-input",
  "fingerprint",
  "plan",
  "materialize",
  "validate-output",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_REASON_CODES = [
  "transformed",
  "configuration-invalid",
  "detect-no-match",
  "detect-ambiguous",
  "detect-exception",
  "detect-result-invalid",
  "input-invalid",
  "validate-input-exception",
  "validate-input-result-invalid",
  "fingerprint-exception",
  "fingerprint-invalid",
  "plan-invalid",
  "plan-exception",
  "plan-result-invalid",
  "materialize-exception",
  "output-invalid",
  "validate-output-exception",
  "validate-output-result-invalid",
  "cancelled",
  "fault-injected",
  "budget-time-exceeded",
  "budget-input-size-exceeded",
  "budget-node-count-exceeded",
  "budget-recursion-exceeded",
  "budget-operation-exceeded",
  "budget-allocation-exceeded",
  "input-schema-unsupported",
] as const;
export type PipelineReasonCode = (typeof PIPELINE_REASON_CODES)[number];
export type PassThroughReasonCode = Exclude<PipelineReasonCode, "transformed">;
export type DetectionResult = { kind: "match" } | { kind: "miss" } | { kind: "ambiguous" };

export type PipelineBudgets = Readonly<{
  maxElapsedMs: number;
  maxInputBytes: number;
  maxNodes: number;
  maxRecursionDepth: number;
  maxOperations: number;
  maxAllocatedBytes: number;
}>;
export type PipelineBudgetUsage = Readonly<{
  inputBytes: number;
  nodesVisited: number;
  operations: number;
  allocatedBytes: number;
  checkpoints: number;
}>;
export const DEFAULT_PIPELINE_BUDGETS: PipelineBudgets = Object.freeze({
  maxElapsedMs: 1_000,
  maxInputBytes: 256 * 1024 * 1024,
  maxNodes: 250_000,
  maxRecursionDepth: 128,
  maxOperations: 2_000_000,
  maxAllocatedBytes: 256 * 1024 * 1024,
});

export type CancellationSignal = Readonly<{ aborted: boolean }>;
export type PipelineFaultMode = "throw" | "cancel" | "budget";
export type PipelineFaults = Readonly<Partial<Record<PipelineStage, PipelineFaultMode>>>;

export interface PipelineStageContext {
  readonly stage: PipelineStage;
  readonly budgets: PipelineBudgets;
  readonly cancellation: CancellationSignal;
  checkpoint(): void;
  consumeOperations(count?: number): void;
  reserveAllocation(bytes: number): void;
  assertRecursionDepth(depth: number): void;
}

export interface FailOpenPipelineAdapter<TSource, TPlan, TOutput> extends AdapterIdentity {
  readonly capabilities?: AdapterCapabilities;
  detect(input: unknown, context: PipelineStageContext): DetectionResult;
  validateInput(input: unknown, context: PipelineStageContext): ValidationResult<TSource>;
  fingerprint(source: TSource, context: PipelineStageContext): StructuralFingerprint;
  plan(source: TSource, fingerprint: StructuralFingerprint, context: PipelineStageContext): ValidationResult<TPlan>;
  materialize(source: TSource, plan: TPlan, fingerprint: StructuralFingerprint, context: PipelineStageContext): unknown;
  validateOutput(
    candidate: unknown,
    source: TSource,
    plan: TPlan,
    fingerprint: StructuralFingerprint,
    context: PipelineStageContext,
  ): ValidationResult<TOutput>;
}

export type DiagnosticEnvelope = Readonly<{
  schemaVersion: 1;
  pipelineVersion: typeof FAIL_OPEN_PIPELINE_VERSION;
  adapter: Readonly<{ id: string; version: string }>;
  decision: "pass-through" | "transformed";
  stage: PipelineStage;
  reasonCode: PipelineReasonCode;
  completedStages: readonly PipelineStage[];
  issueCount: number;
  fingerprintHash?: string;
  budget: Readonly<{ limits: PipelineBudgets; usage: PipelineBudgetUsage }>;
}>;
export type PassThroughOutcome = Readonly<{
  kind: "pass-through";
  stage: PipelineStage;
  reasonCode: PassThroughReasonCode;
}>;
export type TransformedOutcome = Readonly<{
  kind: "transformed";
  stage: "validate-output";
  reasonCode: "transformed";
}>;
export type PipelineDecision<TInput, TOutput> =
  | Readonly<{
      kind: "pass-through";
      authoritativeInput: TInput;
      outcome: PassThroughOutcome;
      diagnostic: DiagnosticEnvelope;
    }>
  | Readonly<{
      kind: "transformed";
      authoritativeInput: TInput;
      output: TOutput;
      outcome: TransformedOutcome;
      diagnostic: DiagnosticEnvelope;
    }>;
export type RunFailOpenPipelineOptions = Readonly<{
  budgets?: Partial<PipelineBudgets>;
  cancellation?: CancellationSignal;
  faults?: PipelineFaults;
  clock?: () => number;
}>;
