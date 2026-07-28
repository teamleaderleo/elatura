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

export type AdapterConformanceIssue = {
  stage: AdapterConformanceStage;
  code: string;
  message: string;
};

export type AdapterConformanceScenario<TPlanOptions> = {
  validInput: unknown;
  invalidInput?: unknown;
  planOptions?: TPlanOptions;
};

export type AdapterConformanceResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: AdapterConformanceIssue[] };

function canonicalize(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("Circular values are unsupported by the conformance checker.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, ancestors));
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = canonicalize(record[key], ancestors);
    return sorted;
  } finally {
    ancestors.delete(value);
  }
}

function stableValue(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function snapshot(value: unknown): { ok: true; value: string } | { ok: false } {
  try {
    return { ok: true, value: stableValue(value) };
  } catch {
    return { ok: false };
  }
}

function stageMethodIssue(
  support: AdapterCapabilitySupport,
  present: boolean,
  stage: "plan" | "materialize" | "validateOutput",
): AdapterConformanceIssue | null {
  if (support === "unsupported" && present) {
    return {
      stage: "declaration",
      code: "undeclared-stage-method",
      message: `${stage} is implemented while declared unsupported.`,
    };
  }
  if (support !== "unsupported" && !present) {
    return {
      stage: "declaration",
      code: "missing-stage-method",
      message: `${stage} is declared but has no implementation.`,
    };
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
  adapter: ApplicationAdapter<
    TSource,
    TPlan,
    TOutput,
    TPlanOptions,
    TAlternateRepresentation,
    TAlternateOptions
  >,
  scenario: AdapterConformanceScenario<TPlanOptions>,
): AdapterConformanceResult {
  const issues: AdapterConformanceIssue[] = [];
  const planSupport = adapter.capabilities.plan;
  const materializeSupport = adapter.capabilities.materialize;
  const outputSupport = adapter.capabilities.validateOutput;

  for (const issue of [
    stageMethodIssue(planSupport, typeof adapter.plan === "function", "plan"),
    stageMethodIssue(materializeSupport, typeof adapter.materialize === "function", "materialize"),
    stageMethodIssue(outputSupport, typeof adapter.validateOutput === "function", "validateOutput"),
  ]) {
    if (issue) issues.push(issue);
  }
  if (materializeSupport !== "unsupported" && planSupport === "unsupported") {
    issues.push({
      stage: "declaration",
      code: "materialize-without-plan",
      message: "Materialization requires a declared planning stage.",
    });
  }
  if (outputSupport !== "unsupported" && materializeSupport === "unsupported") {
    issues.push({
      stage: "declaration",
      code: "validation-without-materialize",
      message: "Output validation requires a declared materialization stage.",
    });
  }
  const alternatePresent = typeof adapter.alternateRepresentation === "function";
  if (adapter.capabilities.alternateRepresentation === "unsupported" && alternatePresent) {
    issues.push({
      stage: "declaration",
      code: "undeclared-alternate-representation",
      message: "Alternate representation is implemented while declared unsupported.",
    });
  }
  if (adapter.capabilities.alternateRepresentation !== "unsupported" && !alternatePresent) {
    issues.push({
      stage: "declaration",
      code: "missing-alternate-representation",
      message: "Alternate representation is declared but has no implementation.",
    });
  }

  const inputBefore = snapshot(scenario.validInput);
  if (!inputBefore.ok) {
    issues.push({ stage: "detect", code: "unsupported-fixture-value", message: "The conformance fixture must be serializable." });
    return { ok: false, issues };
  }

  let detected: boolean;
  try {
    detected = adapter.detect(scenario.validInput);
  } catch {
    issues.push({ stage: "detect", code: "stage-threw", message: "Detect threw an exception." });
    return { ok: false, issues };
  }
  if (!detected) {
    issues.push({ stage: "detect", code: "valid-input-undetected", message: "Detect rejected the valid fixture." });
  }
  try {
    if (adapter.detect(scenario.validInput) !== detected) {
      issues.push({ stage: "detect", code: "non-deterministic", message: "Detect returned different results." });
    }
  } catch {
    issues.push({ stage: "detect", code: "stage-threw", message: "A repeated detect call threw an exception." });
  }
  if (snapshot(scenario.validInput).value !== inputBefore.value) {
    issues.push({ stage: "detect", code: "input-mutated", message: "Detect mutated its input." });
  }
  if (scenario.invalidInput !== undefined) {
    try {
      if (adapter.detect(scenario.invalidInput)) {
        issues.push({ stage: "detect", code: "invalid-input-detected", message: "Detect accepted the invalid fixture." });
      }
    } catch {
      issues.push({ stage: "detect", code: "invalid-stage-threw", message: "Detect threw for the invalid fixture." });
    }
  }

  let validated: ReturnType<typeof adapter.validate>;
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
  const validatedAgain = adapter.validate(scenario.validInput);
  if (!validatedAgain.ok || stableValue(validatedAgain.value) !== stableValue(validated.value)) {
    issues.push({ stage: "validate", code: "non-deterministic", message: "Validate returned different values." });
  }
  if (snapshot(scenario.validInput).value !== inputBefore.value) {
    issues.push({ stage: "validate", code: "input-mutated", message: "Validate mutated its input." });
  }
  if (scenario.invalidInput !== undefined) {
    try {
      const invalid = adapter.validate(scenario.invalidInput);
      if (invalid.ok) {
        issues.push({ stage: "validate", code: "invalid-input-accepted", message: "Validate accepted the invalid fixture." });
      }
    } catch {
      issues.push({ stage: "validate", code: "invalid-stage-threw", message: "Validate threw for the invalid fixture." });
    }
  }

  let fingerprint: ReturnType<typeof adapter.fingerprint>;
  try {
    fingerprint = adapter.fingerprint(validated.value);
    const repeated = adapter.fingerprint(validated.value);
    if (stableValue(fingerprint) !== stableValue(repeated)) {
      issues.push({ stage: "fingerprint", code: "non-deterministic", message: "Fingerprint returned different values." });
    }
    if (fingerprint.adapter !== adapter.id || fingerprint.adapterVersion !== adapter.version) {
      issues.push({ stage: "fingerprint", code: "identity-mismatch", message: "Fingerprint identity must match the adapter." });
    }
  } catch {
    issues.push({ stage: "fingerprint", code: "stage-threw", message: "Fingerprint threw an exception." });
    return { ok: false, issues };
  }

  let plan: TPlan | undefined;
  if (planSupport !== "unsupported" && adapter.plan) {
    if (scenario.planOptions === undefined) {
      issues.push({ stage: "plan", code: "missing-plan-options", message: "Declared planning requires plan options in the scenario." });
    } else {
      const sourceBefore = stableValue(validated.value);
      try {
        const planned = adapter.plan(validated.value, scenario.planOptions);
        if (!planned.ok) {
          issues.push({ stage: "plan", code: "valid-source-rejected", message: "Plan rejected the validated fixture." });
        } else {
          plan = planned.value;
          const repeated = adapter.plan(validated.value, scenario.planOptions);
          if (!repeated.ok || stableValue(repeated.value) !== stableValue(planned.value)) {
            issues.push({ stage: "plan", code: "non-deterministic", message: "Plan returned different values." });
          }
        }
      } catch {
        issues.push({ stage: "plan", code: "stage-threw", message: "Plan threw an exception." });
      }
      if (stableValue(validated.value) !== sourceBefore) {
        issues.push({ stage: "plan", code: "input-mutated", message: "Plan mutated the validated source." });
      }
    }
  }

  let output: TOutput | undefined;
  if (materializeSupport !== "unsupported" && adapter.materialize && plan !== undefined) {
    const sourceBefore = stableValue(validated.value);
    const planBefore = stableValue(plan);
    try {
      const materialized = adapter.materialize(validated.value, plan);
      if (!materialized.ok) {
        issues.push({ stage: "materialize", code: "valid-plan-rejected", message: "Materialize rejected the valid plan." });
      } else {
        output = materialized.value;
        const repeated = adapter.materialize(validated.value, plan);
        if (!repeated.ok || stableValue(repeated.value) !== stableValue(materialized.value)) {
          issues.push({ stage: "materialize", code: "non-deterministic", message: "Materialize returned different values." });
        }
      }
    } catch {
      issues.push({ stage: "materialize", code: "stage-threw", message: "Materialize threw an exception." });
    }
    if (stableValue(validated.value) !== sourceBefore || stableValue(plan) !== planBefore) {
      issues.push({ stage: "materialize", code: "input-mutated", message: "Materialize mutated its source or plan." });
    }
  }

  if (outputSupport !== "unsupported" && adapter.validateOutput && output !== undefined) {
    const outputBefore = stableValue(output);
    try {
      const outputValidation = adapter.validateOutput(structuredClone(output));
      if (!outputValidation.ok) {
        issues.push({ stage: "validateOutput", code: "materialized-output-rejected", message: "Validate-output rejected materialized output." });
      } else {
        const repeated = adapter.validateOutput(structuredClone(output));
        if (!repeated.ok || stableValue(repeated.value) !== stableValue(outputValidation.value)) {
          issues.push({ stage: "validateOutput", code: "non-deterministic", message: "Validate-output returned different values." });
        }
      }
    } catch {
      issues.push({ stage: "validateOutput", code: "stage-threw", message: "Validate-output threw an exception." });
    }
    if (stableValue(output) !== outputBefore) {
      issues.push({ stage: "validateOutput", code: "input-mutated", message: "Validate-output mutated the output." });
    }
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
