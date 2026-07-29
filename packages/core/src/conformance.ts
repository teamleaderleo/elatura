// SPDX-License-Identifier: MPL-2.0
import type { ApplicationAdapter, AdapterCapabilitySupport } from "./adapter-contract.js";
import type { ValidationResult } from "./index.js";
import { validateReadOnlyRepresentation } from "./representation.js";

export type AdapterConformanceStage =
  | "declaration"
  | "detect"
  | "validate"
  | "fingerprint"
  | "plan"
  | "materialize"
  | "validateOutput"
  | "alternateRepresentation"
  | "validateAlternateRepresentation";
export type AdapterConformanceIssue = { stage: AdapterConformanceStage; code: string; message: string };
export type AdapterConformanceScenario<TPlanOptions, TAlternateOptions = never> = {
  validInput: unknown;
  invalidInput?: unknown;
  planOptions?: TPlanOptions;
  synthetic?: boolean;
  alternateOptions?: TAlternateOptions;
  validateAlternateRepresentation?: (input: unknown) => ValidationResult<unknown>;
  maxSnapshotUnits?: number;
};
export type AdapterConformanceResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: AdapterConformanceIssue[] };

type SnapshotFailureCode =
  | "snapshot-budget-exceeded"
  | "unsupported-fixture-value"
  | "accessor-property"
  | "circular-fixture";
type SnapshotResult =
  | { ok: true; value: string }
  | { ok: false; code: SnapshotFailureCode };

type SnapshotState = {
  units: number;
  maximum: number;
  seen: WeakSet<object>;
};

const DEFAULT_MAX_SNAPSHOT_UNITS = 1_000_000;
const MAX_SNAPSHOT_STRING_LENGTH = 1_000_000;
const MAX_SNAPSHOT_SERIALIZED_LENGTH = 16_000_000;

class SnapshotFailure extends Error {
  constructor(readonly code: SnapshotFailureCode) {
    super(code);
  }
}

function consumeSnapshotUnit(state: SnapshotState): void {
  state.units += 1;
  if (state.units > state.maximum) throw new SnapshotFailure("snapshot-budget-exceeded");
}

function canonical(value: unknown, state: SnapshotState): unknown {
  consumeSnapshotUnit(state);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.length > MAX_SNAPSHOT_STRING_LENGTH) throw new SnapshotFailure("snapshot-budget-exceeded");
    return value;
  }
  if (typeof value !== "object") throw new SnapshotFailure("unsupported-fixture-value");
  if (state.seen.has(value)) throw new SnapshotFailure("circular-fixture");
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        consumeSnapshotUnit(state);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) {
          result.push(null);
          continue;
        }
        if (!("value" in descriptor)) throw new SnapshotFailure("accessor-property");
        result.push(canonical(descriptor.value, state));
      }
      return result;
    }

    const source = value as Record<string, unknown>;
    const keys: string[] = [];
    for (const key in source) {
      consumeSnapshotUnit(state);
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (key.length > MAX_SNAPSHOT_STRING_LENGTH) throw new SnapshotFailure("snapshot-budget-exceeded");
      keys.push(key);
    }
    keys.sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor)) throw new SnapshotFailure("accessor-property");
      result[key] = canonical(descriptor.value, state);
    }
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function snapshot(value: unknown, maximum: number): SnapshotResult {
  try {
    const serialized = JSON.stringify(
      canonical(value, { units: 0, maximum, seen: new WeakSet<object>() }),
    );
    if (typeof serialized !== "string") return { ok: false, code: "unsupported-fixture-value" };
    if (serialized.length > MAX_SNAPSHOT_SERIALIZED_LENGTH) {
      return { ok: false, code: "snapshot-budget-exceeded" };
    }
    return { ok: true, value: serialized };
  } catch (error) {
    return error instanceof SnapshotFailure
      ? { ok: false, code: error.code }
      : { ok: false, code: "unsupported-fixture-value" };
  }
}

function snapshotMessage(code: SnapshotFailureCode): string {
  switch (code) {
    case "snapshot-budget-exceeded":
      return "Conformance snapshot traversal exceeded its configured resource budget.";
    case "accessor-property":
      return "Conformance fixtures and stage values must not contain accessor properties.";
    case "circular-fixture":
      return "Conformance fixtures and stage values must be acyclic.";
    default:
      return "Conformance fixtures and stage values must be JSON-like data.";
  }
}

function pushSnapshotFailure(
  issues: AdapterConformanceIssue[],
  stage: AdapterConformanceStage,
  result: Exclude<SnapshotResult, { ok: true }>,
): void {
  issues.push({ stage, code: result.code, message: snapshotMessage(result.code) });
}

function captureSnapshot(
  value: unknown,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
  maximum: number,
): string | null {
  const result = snapshot(value, maximum);
  if (!result.ok) {
    pushSnapshotFailure(issues, stage, result);
    return null;
  }
  return result.value;
}

function checkUnchanged(
  value: unknown,
  before: string | null,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
  maximum: number,
  message: string,
): void {
  if (before === null) return;
  const after = snapshot(value, maximum);
  if (!after.ok) {
    pushSnapshotFailure(issues, stage, after);
    return;
  }
  if (after.value !== before) issues.push({ stage, code: "input-mutated", message });
}

function deterministic(
  left: unknown,
  right: unknown,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
  maximum: number,
): boolean {
  const first = snapshot(left, maximum);
  const second = snapshot(right, maximum);
  if (!first.ok) {
    pushSnapshotFailure(issues, stage, first);
    return false;
  }
  if (!second.ok) {
    pushSnapshotFailure(issues, stage, second);
    return false;
  }
  return first.value === second.value;
}

function cloneForValidation<T>(
  value: T,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
  maximum: number,
): { value: T; before: string } | null {
  const before = captureSnapshot(value, stage, issues, maximum);
  if (before === null) return null;
  try {
    return { value: structuredClone(value), before };
  } catch {
    issues.push({
      stage,
      code: "unsupported-fixture-value",
      message: "Conformance stage values must support detached validation.",
    });
    return null;
  }
}

function methodIssue(
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
      message: `${stage} is declared without an implementation.`,
    };
  }
  return null;
}

function executionAllowed(
  support: AdapterCapabilitySupport,
  synthetic: boolean,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
): boolean {
  if (support !== "synthetic-only" || synthetic) return true;
  issues.push({
    stage,
    code: "synthetic-context-required",
    message: "A synthetic-only capability requires an explicit synthetic scenario.",
  });
  return false;
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
  scenario: AdapterConformanceScenario<TPlanOptions, TAlternateOptions>,
): AdapterConformanceResult {
  const issues: AdapterConformanceIssue[] = [];
  const maxSnapshotUnits = scenario.maxSnapshotUnits ?? DEFAULT_MAX_SNAPSHOT_UNITS;
  if (!Number.isInteger(maxSnapshotUnits) || maxSnapshotUnits < 1) {
    return {
      ok: false,
      issues: [{
        stage: "declaration",
        code: "invalid-snapshot-budget",
        message: "maxSnapshotUnits must be a positive integer.",
      }],
    };
  }

  const planSupport = adapter.capabilities.plan;
  const materializeSupport = adapter.capabilities.materialize;
  const outputSupport = adapter.capabilities.validateOutput;
  for (const candidate of [
    methodIssue(planSupport, typeof adapter.plan === "function", "plan"),
    methodIssue(materializeSupport, typeof adapter.materialize === "function", "materialize"),
    methodIssue(outputSupport, typeof adapter.validateOutput === "function", "validateOutput"),
  ]) {
    if (candidate) issues.push(candidate);
  }
  if (materializeSupport !== "unsupported" && planSupport === "unsupported") {
    issues.push({
      stage: "declaration",
      code: "materialize-without-plan",
      message: "Materialization requires planning.",
    });
  }
  if (outputSupport !== "unsupported" && materializeSupport === "unsupported") {
    issues.push({
      stage: "declaration",
      code: "validation-without-materialize",
      message: "Output validation requires materialization.",
    });
  }
  const alternateSupport = adapter.capabilities.alternateRepresentation;
  const alternatePresent = typeof adapter.alternateRepresentation === "function";
  if (alternateSupport === "unsupported" && alternatePresent) {
    issues.push({
      stage: "declaration",
      code: "undeclared-alternate-representation",
      message: "Alternate representation is implemented while unsupported.",
    });
  }
  if (alternateSupport !== "unsupported" && !alternatePresent) {
    issues.push({
      stage: "declaration",
      code: "missing-alternate-representation",
      message: "Alternate representation is declared without an implementation.",
    });
  }

  const inputBefore = captureSnapshot(
    scenario.validInput,
    "detect",
    issues,
    maxSnapshotUnits,
  );
  if (inputBefore === null) return { ok: false, issues };

  let detected = false;
  try {
    detected = adapter.detect(scenario.validInput);
    if (typeof detected !== "boolean") {
      issues.push({ stage: "detect", code: "invalid-stage-result", message: "Detect must return a boolean." });
    } else {
      if (!detected) {
        issues.push({ stage: "detect", code: "valid-input-undetected", message: "Detect rejected the valid fixture." });
      }
      const repeated = adapter.detect(scenario.validInput);
      if (typeof repeated !== "boolean" || repeated !== detected) {
        issues.push({ stage: "detect", code: "non-deterministic", message: "Detect returned different results." });
      }
    }
  } catch {
    issues.push({ stage: "detect", code: "stage-threw", message: "Detect threw an exception." });
    return { ok: false, issues };
  }
  checkUnchanged(
    scenario.validInput,
    inputBefore,
    "detect",
    issues,
    maxSnapshotUnits,
    "Detect mutated its input.",
  );

  if (scenario.invalidInput !== undefined) {
    const invalidBefore = captureSnapshot(
      scenario.invalidInput,
      "detect",
      issues,
      maxSnapshotUnits,
    );
    try {
      if (adapter.detect(scenario.invalidInput)) {
        issues.push({ stage: "detect", code: "invalid-input-detected", message: "Detect accepted the invalid fixture." });
      }
    } catch {
      issues.push({ stage: "detect", code: "invalid-stage-threw", message: "Detect threw for the invalid fixture." });
    }
    checkUnchanged(
      scenario.invalidInput,
      invalidBefore,
      "detect",
      issues,
      maxSnapshotUnits,
      "Detect mutated the invalid fixture.",
    );
  }

  let validated: ReturnType<ApplicationAdapter<TSource>["validate"]>;
  try {
    validated = adapter.validate(scenario.validInput);
  } catch {
    issues.push({ stage: "validate", code: "stage-threw", message: "Validate threw an exception." });
    return { ok: false, issues };
  }
  checkUnchanged(
    scenario.validInput,
    inputBefore,
    "validate",
    issues,
    maxSnapshotUnits,
    "Validate mutated its input.",
  );
  if (!validated.ok) {
    issues.push({ stage: "validate", code: "valid-input-rejected", message: "Validate rejected the valid fixture." });
    return { ok: false, issues };
  }
  try {
    const repeated = adapter.validate(scenario.validInput);
    if (!repeated.ok || !deterministic(validated.value, repeated.value, "validate", issues, maxSnapshotUnits)) {
      issues.push({ stage: "validate", code: "non-deterministic", message: "Validate returned different values." });
    }
  } catch {
    issues.push({ stage: "validate", code: "stage-threw", message: "A repeated validate call threw." });
  }
  checkUnchanged(
    scenario.validInput,
    inputBefore,
    "validate",
    issues,
    maxSnapshotUnits,
    "Validate mutated its input.",
  );

  if (scenario.invalidInput !== undefined) {
    const invalidBefore = captureSnapshot(
      scenario.invalidInput,
      "validate",
      issues,
      maxSnapshotUnits,
    );
    try {
      if (adapter.validate(scenario.invalidInput).ok) {
        issues.push({ stage: "validate", code: "invalid-input-accepted", message: "Validate accepted the invalid fixture." });
      }
    } catch {
      issues.push({ stage: "validate", code: "invalid-stage-threw", message: "Validate threw for the invalid fixture." });
    }
    checkUnchanged(
      scenario.invalidInput,
      invalidBefore,
      "validate",
      issues,
      maxSnapshotUnits,
      "Validate mutated the invalid fixture.",
    );
  }

  const sourceBefore = captureSnapshot(
    validated.value,
    "fingerprint",
    issues,
    maxSnapshotUnits,
  );
  try {
    const fingerprint = adapter.fingerprint(validated.value);
    const repeated = adapter.fingerprint(validated.value);
    if (!deterministic(fingerprint, repeated, "fingerprint", issues, maxSnapshotUnits)) {
      issues.push({ stage: "fingerprint", code: "non-deterministic", message: "Fingerprint returned different values." });
    }
    if (fingerprint.adapter !== adapter.id || fingerprint.adapterVersion !== adapter.version) {
      issues.push({ stage: "fingerprint", code: "identity-mismatch", message: "Fingerprint identity must match the adapter." });
    }
  } catch {
    issues.push({ stage: "fingerprint", code: "stage-threw", message: "Fingerprint threw an exception." });
    return { ok: false, issues };
  }
  checkUnchanged(
    validated.value,
    sourceBefore,
    "fingerprint",
    issues,
    maxSnapshotUnits,
    "Fingerprint mutated the validated source.",
  );

  let plan: TPlan | undefined;
  let hasPlan = false;
  if (
    planSupport !== "unsupported" &&
    adapter.plan &&
    executionAllowed(planSupport, scenario.synthetic === true, "plan", issues)
  ) {
    if (scenario.planOptions === undefined) {
      issues.push({ stage: "plan", code: "missing-plan-options", message: "The scenario must provide plan options." });
    } else {
      const planSourceBefore = captureSnapshot(validated.value, "plan", issues, maxSnapshotUnits);
      const optionsBefore = captureSnapshot(scenario.planOptions, "plan", issues, maxSnapshotUnits);
      try {
        const planned = adapter.plan(validated.value, scenario.planOptions);
        if (!planned.ok) {
          issues.push({ stage: "plan", code: "valid-source-rejected", message: "Plan rejected the validated source." });
        } else {
          plan = planned.value;
          hasPlan = true;
          const repeated = adapter.plan(validated.value, scenario.planOptions);
          if (!repeated.ok || !deterministic(planned.value, repeated.value, "plan", issues, maxSnapshotUnits)) {
            issues.push({ stage: "plan", code: "non-deterministic", message: "Plan returned different values." });
          }
        }
      } catch {
        issues.push({ stage: "plan", code: "stage-threw", message: "Plan threw an exception." });
      }
      checkUnchanged(
        validated.value,
        planSourceBefore,
        "plan",
        issues,
        maxSnapshotUnits,
        "Plan mutated the validated source.",
      );
      checkUnchanged(
        scenario.planOptions,
        optionsBefore,
        "plan",
        issues,
        maxSnapshotUnits,
        "Plan mutated its options.",
      );
    }
  }

  let output: TOutput | undefined;
  let hasOutput = false;
  if (
    materializeSupport !== "unsupported" &&
    adapter.materialize &&
    hasPlan &&
    executionAllowed(materializeSupport, scenario.synthetic === true, "materialize", issues)
  ) {
    const materializeSourceBefore = captureSnapshot(validated.value, "materialize", issues, maxSnapshotUnits);
    const planBefore = captureSnapshot(plan, "materialize", issues, maxSnapshotUnits);
    try {
      const materialized = adapter.materialize(validated.value, plan as TPlan);
      if (!materialized.ok) {
        issues.push({ stage: "materialize", code: "valid-plan-rejected", message: "Materialize rejected the plan." });
      } else {
        output = materialized.value;
        hasOutput = true;
        const repeated = adapter.materialize(validated.value, plan as TPlan);
        if (!repeated.ok || !deterministic(materialized.value, repeated.value, "materialize", issues, maxSnapshotUnits)) {
          issues.push({ stage: "materialize", code: "non-deterministic", message: "Materialize returned different values." });
        }
      }
    } catch {
      issues.push({ stage: "materialize", code: "stage-threw", message: "Materialize threw an exception." });
    }
    checkUnchanged(
      validated.value,
      materializeSourceBefore,
      "materialize",
      issues,
      maxSnapshotUnits,
      "Materialize mutated its source.",
    );
    checkUnchanged(
      plan,
      planBefore,
      "materialize",
      issues,
      maxSnapshotUnits,
      "Materialize mutated its plan.",
    );
  }

  if (
    outputSupport !== "unsupported" &&
    adapter.validateOutput &&
    hasOutput &&
    executionAllowed(outputSupport, scenario.synthetic === true, "validateOutput", issues)
  ) {
    const firstInput = cloneForValidation(output, "validateOutput", issues, maxSnapshotUnits);
    const secondInput = cloneForValidation(output, "validateOutput", issues, maxSnapshotUnits);
    if (firstInput && secondInput) {
      try {
        const result = adapter.validateOutput(firstInput.value);
        checkUnchanged(
          firstInput.value,
          firstInput.before,
          "validateOutput",
          issues,
          maxSnapshotUnits,
          "Validate-output mutated the exact object passed to it.",
        );
        const repeated = adapter.validateOutput(secondInput.value);
        checkUnchanged(
          secondInput.value,
          secondInput.before,
          "validateOutput",
          issues,
          maxSnapshotUnits,
          "Validate-output mutated the exact object passed to it.",
        );
        if (!result.ok) {
          issues.push({ stage: "validateOutput", code: "materialized-output-rejected", message: "Validate-output rejected the output." });
        } else if (!repeated.ok || !deterministic(result.value, repeated.value, "validateOutput", issues, maxSnapshotUnits)) {
          issues.push({ stage: "validateOutput", code: "non-deterministic", message: "Validate-output returned different values." });
        }
      } catch {
        issues.push({ stage: "validateOutput", code: "stage-threw", message: "Validate-output threw an exception." });
      }
    }
  }

  if (
    alternateSupport !== "unsupported" &&
    adapter.alternateRepresentation &&
    executionAllowed(alternateSupport, scenario.synthetic === true, "alternateRepresentation", issues)
  ) {
    if (scenario.alternateOptions === undefined) {
      issues.push({
        stage: "alternateRepresentation",
        code: "missing-alternate-options",
        message: "The scenario must provide alternate-representation options.",
      });
    } else {
      const alternateSourceBefore = captureSnapshot(
        validated.value,
        "alternateRepresentation",
        issues,
        maxSnapshotUnits,
      );
      const alternateOptionsBefore = captureSnapshot(
        scenario.alternateOptions,
        "alternateRepresentation",
        issues,
        maxSnapshotUnits,
      );
      try {
        const represented = adapter.alternateRepresentation(validated.value, scenario.alternateOptions);
        const repeated = adapter.alternateRepresentation(validated.value, scenario.alternateOptions);
        checkUnchanged(
          validated.value,
          alternateSourceBefore,
          "alternateRepresentation",
          issues,
          maxSnapshotUnits,
          "Alternate representation mutated the validated source.",
        );
        checkUnchanged(
          scenario.alternateOptions,
          alternateOptionsBefore,
          "alternateRepresentation",
          issues,
          maxSnapshotUnits,
          "Alternate representation mutated its options.",
        );
        if (!represented.ok) {
          issues.push({
            stage: "alternateRepresentation",
            code: "valid-source-rejected",
            message: "Alternate representation rejected the validated source.",
          });
        } else if (!repeated.ok || !deterministic(
          represented.value,
          repeated.value,
          "alternateRepresentation",
          issues,
          maxSnapshotUnits,
        )) {
          issues.push({
            stage: "alternateRepresentation",
            code: "non-deterministic",
            message: "Alternate representation returned different values.",
          });
        } else {
          const validator = scenario.validateAlternateRepresentation ?? validateReadOnlyRepresentation;
          const firstInput = cloneForValidation(
            represented.value,
            "validateAlternateRepresentation",
            issues,
            maxSnapshotUnits,
          );
          const secondInput = cloneForValidation(
            represented.value,
            "validateAlternateRepresentation",
            issues,
            maxSnapshotUnits,
          );
          if (firstInput && secondInput) {
            const validatedAlternate = validator(firstInput.value);
            checkUnchanged(
              firstInput.value,
              firstInput.before,
              "validateAlternateRepresentation",
              issues,
              maxSnapshotUnits,
              "Alternate-output validation mutated the exact object passed to it.",
            );
            const repeatedValidation = validator(secondInput.value);
            checkUnchanged(
              secondInput.value,
              secondInput.before,
              "validateAlternateRepresentation",
              issues,
              maxSnapshotUnits,
              "Alternate-output validation mutated the exact object passed to it.",
            );
            if (!validatedAlternate.ok) {
              issues.push({
                stage: "validateAlternateRepresentation",
                code: "alternate-output-rejected",
                message: "Alternate-output validation rejected the representation.",
              });
            } else if (!repeatedValidation.ok || !deterministic(
              validatedAlternate.value,
              repeatedValidation.value,
              "validateAlternateRepresentation",
              issues,
              maxSnapshotUnits,
            )) {
              issues.push({
                stage: "validateAlternateRepresentation",
                code: "non-deterministic",
                message: "Alternate-output validation returned different values.",
              });
            }
          }
        }
      } catch {
        issues.push({
          stage: "alternateRepresentation",
          code: "stage-threw",
          message: "Alternate representation or its validator threw an exception.",
        });
      }
    }
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
