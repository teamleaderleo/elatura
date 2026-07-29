// SPDX-License-Identifier: MPL-2.0
import type { StructuralFingerprint } from "./index.js";
import { capturePipelineCapabilities } from "./orchestration-capabilities.js";
import { cloneJsonLike, freezeJsonLike } from "./orchestration-json.js";
import {
  type FailOpenPipelineAdapter,
  type PassThroughReasonCode,
  type PipelineDecision,
  type PipelineStage,
  type RunFailOpenPipelineOptions,
} from "./orchestration-model.js";
import {
  BudgetLedger,
  NEVER_CANCELLED,
  capturePipelineAdapter,
  type CapturedPipelineAdapter,
  fallbackRuntime,
  injectFault,
  readDetectionResult,
  readValidationResult,
  readValidFingerprint,
  makeDiagnostic,
  mappedReason,
  resolveBudgets,
  stageContext,
} from "./orchestration-runtime.js";

export * from "./orchestration-model.js";
export * from "./orchestration-json.js";

function passThrough<TInput, TOutput>(
  authoritativeInput: TInput,
  adapter: Readonly<{ id: string; version: string }>,
  ledger: BudgetLedger,
  stage: PipelineStage,
  reasonCode: PassThroughReasonCode,
  completedStages: readonly PipelineStage[],
  issueCount = 0,
  fingerprintHash?: string,
): PipelineDecision<TInput, TOutput> {
  return Object.freeze({
    kind: "pass-through",
    authoritativeInput,
    outcome: Object.freeze({ kind: "pass-through", stage, reasonCode }),
    diagnostic: makeDiagnostic(
      adapter,
      ledger,
      "pass-through",
      stage,
      reasonCode,
      completedStages,
      issueCount,
      fingerprintHash,
    ),
  });
}

export function runFailOpenPipeline<TInput, TSource, TPlan, TOutput>(
  authoritativeInput: TInput,
  adapter: FailOpenPipelineAdapter<TSource, TPlan, TOutput>,
  options: RunFailOpenPipelineOptions = {},
): PipelineDecision<TInput, TOutput> {
  let capturedAdapter: CapturedPipelineAdapter<TSource, TPlan, TOutput>;
  let identity: Readonly<{ id: string; version: string }>;
  try {
    const captured = capturePipelineAdapter<TSource, TPlan, TOutput>(adapter);
    if (!captured) throw new TypeError("Invalid adapter configuration.");
    capturedAdapter = captured;
    identity = Object.freeze({ id: captured.id, version: captured.version });

    const capabilityCapture = capturePipelineCapabilities(adapter, options.synthetic);
    if (!capabilityCapture.ok) {
      const fallback = fallbackRuntime(identity);
      return passThrough(
        authoritativeInput,
        fallback.adapter,
        fallback.ledger,
        "detect",
        capabilityCapture.reasonCode,
        [],
      );
    }
  } catch {
    const fallback = fallbackRuntime();
    return passThrough(
      authoritativeInput,
      fallback.adapter,
      fallback.ledger,
      "detect",
      "configuration-invalid",
      [],
    );
  }

  let ledger: BudgetLedger;
  try {
    ledger = new BudgetLedger(
      resolveBudgets(options.budgets),
      options.cancellation ?? NEVER_CANCELLED,
      options.clock ?? (() => performance.now()),
    );
  } catch {
    const fallback = fallbackRuntime(identity);
    return passThrough(
      authoritativeInput,
      fallback.adapter,
      fallback.ledger,
      "detect",
      "configuration-invalid",
      [],
    );
  }

  const completed: PipelineStage[] = [];
  let fingerprintHash: string | undefined;

  try {
    ledger.measureInput(authoritativeInput);
  } catch (error) {
    return passThrough(authoritativeInput, identity, ledger, "detect", mappedReason(error, "detect"), completed);
  }

  let workingInput: unknown;
  try {
    const context = stageContext("detect", ledger);
    context.checkpoint();
    injectFault("detect", options.faults?.detect, ledger);
    workingInput = cloneJsonLike(authoritativeInput, context);
    freezeJsonLike(workingInput, context);
    const detected = capturedAdapter.detect(workingInput, context);
    context.checkpoint();
    const capturedDetection = readDetectionResult(detected);
    if (!capturedDetection) {
      return passThrough(authoritativeInput, identity, ledger, "detect", "detect-result-invalid", completed);
    }
    completed.push("detect");
    if (capturedDetection.kind === "miss") {
      return passThrough(authoritativeInput, identity, ledger, "detect", "detect-no-match", completed);
    }
    if (capturedDetection.kind === "ambiguous") {
      return passThrough(authoritativeInput, identity, ledger, "detect", "detect-ambiguous", completed);
    }
  } catch (error) {
    return passThrough(authoritativeInput, identity, ledger, "detect", mappedReason(error, "detect"), completed);
  }

  let source: TSource;
  try {
    const context = stageContext("validate-input", ledger);
    context.checkpoint();
    injectFault("validate-input", options.faults?.["validate-input"], ledger);
    const result = capturedAdapter.validateInput(workingInput, context);
    context.checkpoint();
    const capturedResult = readValidationResult<TSource>(result);
    if (!capturedResult) {
      return passThrough(
        authoritativeInput,
        identity,
        ledger,
        "validate-input",
        "validate-input-result-invalid",
        completed,
      );
    }
    if (!capturedResult.ok) {
      return passThrough(
        authoritativeInput,
        identity,
        ledger,
        "validate-input",
        "input-invalid",
        completed,
        capturedResult.issueCount,
      );
    }
    source = capturedResult.value;
    completed.push("validate-input");
  } catch (error) {
    return passThrough(
      authoritativeInput,
      identity,
      ledger,
      "validate-input",
      mappedReason(error, "validate-input"),
      completed,
    );
  }

  let fingerprint: StructuralFingerprint;
  try {
    const context = stageContext("fingerprint", ledger);
    context.checkpoint();
    injectFault("fingerprint", options.faults?.fingerprint, ledger);
    const result = capturedAdapter.fingerprint(source, context);
    context.checkpoint();
    const capturedFingerprint = readValidFingerprint(result, identity);
    if (!capturedFingerprint) {
      return passThrough(authoritativeInput, identity, ledger, "fingerprint", "fingerprint-invalid", completed);
    }
    fingerprint = capturedFingerprint;
    fingerprintHash = capturedFingerprint.hash;
    completed.push("fingerprint");
  } catch (error) {
    return passThrough(
      authoritativeInput,
      identity,
      ledger,
      "fingerprint",
      mappedReason(error, "fingerprint"),
      completed,
    );
  }

  let plan: TPlan;
  try {
    const context = stageContext("plan", ledger);
    context.checkpoint();
    injectFault("plan", options.faults?.plan, ledger);
    const result = capturedAdapter.plan(source, fingerprint, context);
    context.checkpoint();
    const capturedResult = readValidationResult<TPlan>(result);
    if (!capturedResult) {
      return passThrough(
        authoritativeInput,
        identity,
        ledger,
        "plan",
        "plan-result-invalid",
        completed,
        0,
        fingerprintHash,
      );
    }
    if (!capturedResult.ok) {
      return passThrough(
        authoritativeInput,
        identity,
        ledger,
        "plan",
        "plan-invalid",
        completed,
        capturedResult.issueCount,
        fingerprintHash,
      );
    }
    plan = capturedResult.value;
    completed.push("plan");
  } catch (error) {
    return passThrough(
      authoritativeInput,
      identity,
      ledger,
      "plan",
      mappedReason(error, "plan"),
      completed,
      0,
      fingerprintHash,
    );
  }

  let candidate: unknown;
  try {
    const context = stageContext("materialize", ledger);
    context.checkpoint();
    injectFault("materialize", options.faults?.materialize, ledger);
    candidate = capturedAdapter.materialize(source, plan, fingerprint, context);
    context.checkpoint();
    completed.push("materialize");
  } catch (error) {
    return passThrough(
      authoritativeInput,
      identity,
      ledger,
      "materialize",
      mappedReason(error, "materialize"),
      completed,
      0,
      fingerprintHash,
    );
  }

  let output: TOutput;
  try {
    const context = stageContext("validate-output", ledger);
    context.checkpoint();
    injectFault("validate-output", options.faults?.["validate-output"], ledger);
    const result = capturedAdapter.validateOutput(candidate, source, plan, fingerprint, context);
    context.checkpoint();
    const capturedResult = readValidationResult<TOutput>(result);
    if (!capturedResult) {
      return passThrough(
        authoritativeInput,
        identity,
        ledger,
        "validate-output",
        "validate-output-result-invalid",
        completed,
        0,
        fingerprintHash,
      );
    }
    if (!capturedResult.ok) {
      return passThrough(
        authoritativeInput,
        identity,
        ledger,
        "validate-output",
        "output-invalid",
        completed,
        capturedResult.issueCount,
        fingerprintHash,
      );
    }
    output = capturedResult.value;
    completed.push("validate-output");
  } catch (error) {
    return passThrough(
      authoritativeInput,
      identity,
      ledger,
      "validate-output",
      mappedReason(error, "validate-output"),
      completed,
      0,
      fingerprintHash,
    );
  }

  return Object.freeze({
    kind: "transformed",
    authoritativeInput,
    output,
    outcome: Object.freeze({ kind: "transformed", stage: "validate-output", reasonCode: "transformed" }),
    diagnostic: makeDiagnostic(
      identity,
      ledger,
      "transformed",
      "validate-output",
      "transformed",
      completed,
      0,
      fingerprintHash,
    ),
  });
}
