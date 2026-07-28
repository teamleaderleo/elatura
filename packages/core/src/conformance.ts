// SPDX-License-Identifier: MPL-2.0
import type { ApplicationAdapter, AdapterCapabilitySupport } from "./adapter-contract.js";

export type AdapterConformanceStage =
  | "declaration"
  | "detect"
  | "validate"
  | "fingerprint"
  | "plan"
  | "materialize"
  | "validateOutput";
export type AdapterConformanceIssue = { stage: AdapterConformanceStage; code: string; message: string };
export type AdapterConformanceScenario<TPlanOptions> = {
  validInput: unknown;
  invalidInput?: unknown;
  planOptions?: TPlanOptions;
};
export type AdapterConformanceResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: AdapterConformanceIssue[] };

function canonical(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("circular");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonical(item, seen));
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = canonical(source[key], seen);
    return result;
  } finally {
    seen.delete(value);
  }
}
function snapshot(value: unknown): string | null {
  try {
    return JSON.stringify(canonical(value));
  } catch {
    return null;
  }
}
function changed(value: unknown, before: string): boolean {
  return snapshot(value) !== before;
}
function deterministic(left: unknown, right: unknown): boolean {
  const first = snapshot(left);
  return first !== null && first === snapshot(right);
}
function methodIssue(
  support: AdapterCapabilitySupport,
  present: boolean,
  stage: "plan" | "materialize" | "validateOutput",
): AdapterConformanceIssue | null {
  if (support === "unsupported" && present) {
    return { stage: "declaration", code: "undeclared-stage-method", message: `${stage} is implemented while declared unsupported.` };
  }
  if (support !== "unsupported" && !present) {
    return { stage: "declaration", code: "missing-stage-method", message: `${stage} is declared without an implementation.` };
  }
  return null;
}

export function runAdapterConformance<
  TSource,
  TPlan,
  TOutput,
  TPlanOptions,
  TAlternateRepresentation,
  TAlternateOptions,
>(
  adapter: ApplicationAdapter<TSource, TPlan, TOutput, TPlanOptions, TAlternateRepresentation, TAlternateOptions>,
  scenario: AdapterConformanceScenario<TPlanOptions>,
): AdapterConformanceResult {
  const issues: AdapterConformanceIssue[] = [];
  const planSupport = adapter.capabilities.plan;
  const materializeSupport = adapter.capabilities.materialize;
  const outputSupport = adapter.capabilities.validateOutput;
  for (const candidate of [
    methodIssue(planSupport, typeof adapter.plan === "function", "plan"),
    methodIssue(materializeSupport, typeof adapter.materialize === "function", "materialize"),
    methodIssue(outputSupport, typeof adapter.validateOutput === "function", "validateOutput"),
  ]) if (candidate) issues.push(candidate);
  if (materializeSupport !== "unsupported" && planSupport === "unsupported") {
    issues.push({ stage: "declaration", code: "materialize-without-plan", message: "Materialization requires planning." });
  }
  if (outputSupport !== "unsupported" && materializeSupport === "unsupported") {
    issues.push({ stage: "declaration", code: "validation-without-materialize", message: "Output validation requires materialization." });
  }
  const alternatePresent = typeof adapter.alternateRepresentation === "function";
  if (adapter.capabilities.alternateRepresentation === "unsupported" && alternatePresent) {
    issues.push({ stage: "declaration", code: "undeclared-alternate-representation", message: "Alternate representation is implemented while unsupported." });
  }
  if (adapter.capabilities.alternateRepresentation !== "unsupported" && !alternatePresent) {
    issues.push({ stage: "declaration", code: "missing-alternate-representation", message: "Alternate representation is declared without an implementation." });
  }

  const inputBefore = snapshot(scenario.validInput);
  if (inputBefore === null) {
    issues.push({ stage: "detect", code: "unsupported-fixture-value", message: "The valid fixture must be serializable." });
    return { ok: false, issues };
  }
  let detected = false;
  try {
    detected = adapter.detect(scenario.validInput);
    if (!detected) issues.push({ stage: "detect", code: "valid-input-undetected", message: "Detect rejected the valid fixture." });
    if (adapter.detect(scenario.validInput) !== detected) issues.push({ stage: "detect", code: "non-deterministic", message: "Detect returned different results." });
  } catch {
    issues.push({ stage: "detect", code: "stage-threw", message: "Detect threw an exception." });
    return { ok: false, issues };
  }
  if (changed(scenario.validInput, inputBefore)) issues.push({ stage: "detect", code: "input-mutated", message: "Detect mutated its input." });
  if (scenario.invalidInput !== undefined) {
    try {
      if (adapter.detect(scenario.invalidInput)) issues.push({ stage: "detect", code: "invalid-input-detected", message: "Detect accepted the invalid fixture." });
    } catch {
      issues.push({ stage: "detect", code: "invalid-stage-threw", message: "Detect threw for the invalid fixture." });
    }
  }

  let validated: ReturnType<ApplicationAdapter<TSource>["validate"]>;
  try {
    validated = adapter.validate(scenario.validInput);
  } catch {
    issues.push({ stage: "validate", code: "stage-threw", message: "Validate threw an exception." });
    return { ok: false, issues };
  }
  if (!validated.ok) {
    issues.push({ stage: "validate", code: "valid-input-rejected", message: "Validate rejected the valid fixture." });
    return { ok: false, issues };
  }
  try {
    const repeated = adapter.validate(scenario.validInput);
    if (!repeated.ok || !deterministic(validated.value, repeated.value)) {
      issues.push({ stage: "validate", code: "non-deterministic", message: "Validate returned different values." });
    }
  } catch {
    issues.push({ stage: "validate", code: "stage-threw", message: "A repeated validate call threw." });
  }
  if (changed(scenario.validInput, inputBefore)) issues.push({ stage: "validate", code: "input-mutated", message: "Validate mutated its input." });
  if (scenario.invalidInput !== undefined) {
    try {
      if (adapter.validate(scenario.invalidInput).ok) issues.push({ stage: "validate", code: "invalid-input-accepted", message: "Validate accepted the invalid fixture." });
    } catch {
      issues.push({ stage: "validate", code: "invalid-stage-threw", message: "Validate threw for the invalid fixture." });
    }
  }

  try {
    const fingerprint = adapter.fingerprint(validated.value);
    const repeated = adapter.fingerprint(validated.value);
    if (!deterministic(fingerprint, repeated)) issues.push({ stage: "fingerprint", code: "non-deterministic", message: "Fingerprint returned different values." });
    if (fingerprint.adapter !== adapter.id || fingerprint.adapterVersion !== adapter.version) {
      issues.push({ stage: "fingerprint", code: "identity-mismatch", message: "Fingerprint identity must match the adapter." });
    }
  } catch {
    issues.push({ stage: "fingerprint", code: "stage-threw", message: "Fingerprint threw an exception." });
    return { ok: false, issues };
  }

  let plan: TPlan | undefined;
  let hasPlan = false;
  if (planSupport !== "unsupported" && adapter.plan) {
    if (scenario.planOptions === undefined) {
      issues.push({ stage: "plan", code: "missing-plan-options", message: "The scenario must provide plan options." });
    } else {
      const sourceBefore = snapshot(validated.value);
      try {
        const planned = adapter.plan(validated.value, scenario.planOptions);
        if (!planned.ok) issues.push({ stage: "plan", code: "valid-source-rejected", message: "Plan rejected the validated source." });
        else {
          plan = planned.value;
          hasPlan = true;
          const repeated = adapter.plan(validated.value, scenario.planOptions);
          if (!repeated.ok || !deterministic(planned.value, repeated.value)) issues.push({ stage: "plan", code: "non-deterministic", message: "Plan returned different values." });
        }
      } catch {
        issues.push({ stage: "plan", code: "stage-threw", message: "Plan threw an exception." });
      }
      if (sourceBefore === null || changed(validated.value, sourceBefore)) issues.push({ stage: "plan", code: "input-mutated", message: "Plan mutated the validated source." });
    }
  }

  let output: TOutput | undefined;
  let hasOutput = false;
  if (materializeSupport !== "unsupported" && adapter.materialize && hasPlan) {
    const sourceBefore = snapshot(validated.value);
    const planBefore = snapshot(plan);
    try {
      const materialized = adapter.materialize(validated.value, plan as TPlan);
      if (!materialized.ok) issues.push({ stage: "materialize", code: "valid-plan-rejected", message: "Materialize rejected the plan." });
      else {
        output = materialized.value;
        hasOutput = true;
        const repeated = adapter.materialize(validated.value, plan as TPlan);
        if (!repeated.ok || !deterministic(materialized.value, repeated.value)) issues.push({ stage: "materialize", code: "non-deterministic", message: "Materialize returned different values." });
      }
    } catch {
      issues.push({ stage: "materialize", code: "stage-threw", message: "Materialize threw an exception." });
    }
    if (sourceBefore === null || changed(validated.value, sourceBefore) || planBefore === null || changed(plan, planBefore)) {
      issues.push({ stage: "materialize", code: "input-mutated", message: "Materialize mutated its source or plan." });
    }
  }

  if (outputSupport !== "unsupported" && adapter.validateOutput && hasOutput) {
    const outputBefore = snapshot(output);
    try {
      const result = adapter.validateOutput(structuredClone(output));
      const repeated = adapter.validateOutput(structuredClone(output));
      if (!result.ok) issues.push({ stage: "validateOutput", code: "materialized-output-rejected", message: "Validate-output rejected the output." });
      else if (!repeated.ok || !deterministic(result.value, repeated.value)) issues.push({ stage: "validateOutput", code: "non-deterministic", message: "Validate-output returned different values." });
    } catch {
      issues.push({ stage: "validateOutput", code: "stage-threw", message: "Validate-output threw an exception." });
    }
    if (outputBefore === null || changed(output, outputBefore)) issues.push({ stage: "validateOutput", code: "input-mutated", message: "Validate-output mutated its input." });
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
