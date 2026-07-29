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

export type AdapterConformanceIssue = {
  stage: AdapterConformanceStage;
  code: string;
  message: string;
};

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

function issue(
  stage: AdapterConformanceStage,
  code: string,
  message: string,
): AdapterConformanceIssue {
  return { stage, code, message };
}

function consumeSnapshotUnit(state: SnapshotState): void {
  state.units += 1;
  if (state.units > state.maximum) {
    throw new SnapshotFailure("snapshot-budget-exceeded");
  }
}

function canonical(value: unknown, state: SnapshotState): unknown {
  consumeSnapshotUnit(state);
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_SNAPSHOT_STRING_LENGTH) {
      throw new SnapshotFailure("snapshot-budget-exceeded");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new SnapshotFailure("unsupported-fixture-value");
  }
  if (state.seen.has(value)) throw new SnapshotFailure("circular-fixture");
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        consumeSnapshotUnit(state);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) {
          output.push(null);
          continue;
        }
        if (!("value" in descriptor)) throw new SnapshotFailure("accessor-property");
        output.push(canonical(descriptor.value, state));
      }
      return output;
    }

    const source = value as Record<string, unknown>;
    const keys: string[] = [];
    for (const key in source) {
      consumeSnapshotUnit(state);
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (key.length > MAX_SNAPSHOT_STRING_LENGTH) {
        throw new SnapshotFailure("snapshot-budget-exceeded");
      }
      keys.push(key);
    }
    keys.sort();

    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new SnapshotFailure("accessor-property");
      }
      Object.defineProperty(output, key, {
        value: canonical(descriptor.value, state),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } finally {
    state.seen.delete(value);
  }
}

function snapshot(value: unknown, maximum: number): SnapshotResult {
  try {
    const serialized = JSON.stringify(
      canonical(value, { units: 0, maximum, seen: new WeakSet<object>() }),
    );
    if (typeof serialized !== "string") {
      return { ok: false, code: "unsupported-fixture-value" };
    }
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
  issues.push(issue(stage, result.code, snapshotMessage(result.code)));
}

function capture(
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
  if (after.value !== before) issues.push(issue(stage, "input-mutated", message));
}

function deterministic(
  left: unknown,
  right: unknown,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
  maximum: number,
): boolean | null {
  const first = snapshot(left, maximum);
  const second = snapshot(right, maximum);
  if (!first.ok) {
    pushSnapshotFailure(issues, stage, first);
    return null;
  }
  if (!second.ok) {
    pushSnapshotFailure(issues, stage, second);
    return null;
  }
  return first.value === second.value;
}

function cloneForValidation<T>(
  value: T,
  stage: AdapterConformanceStage,
  issues: AdapterConformanceIssue[],
  maximum: number,
): { value: T; before: string } | null {
  const before = capture(value, stage, issues, maximum);
  if (before === null) return null;
  try {
    return { value: structuredClone(value), before };
  } catch {
    issues.push(
      issue(
        stage,
        "unsupported-fixture-value",
        "Conformance stage values must support detached validation.",
      ),
    );
    return null;
  }
}

function methodIssue(
  support: AdapterCapabilitySupport,
  present: boolean,
  stage: "plan" | "materialize" | "validateOutput",
): AdapterConformanceIssue | null {
  if (support === "unsupported" && present) {
    return issue(
      "declaration",
      "undeclared-stage-method",
      `${stage} is implemented while declared unsupported.`,
    );
  }
  if (support !== "unsupported" && !present) {
    return issue(
      "declaration",
      "missing-stage-method",
      `${stage} is declared without an implementation.`,
    );
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
  issues.push(
    issue(
      stage,
      "synthetic-context-required",
      "A synthetic-only capability requires an explicit synthetic scenario.",
    ),
  );
  return false;
}

function validateDetachedTwice<T>(
  value: T,
  validator: (input: unknown) => ValidationResult<unknown>,
  stage: "validateOutput" | "validateAlternateRepresentation",
  issues: AdapterConformanceIssue[],
  maximum: number,
  rejectedCode: string,
  rejectedMessage: string,
  mutationMessage: string,
  nonDeterministicMessage: string,
): void {
  const first = cloneForValidation(value, stage, issues, maximum);
  const second = cloneForValidation(value, stage, issues, maximum);
  if (!first || !second) return;

  let firstResult: ValidationResult<unknown> | null = null;
  let secondResult: ValidationResult<unknown> | null = null;
  try {
    firstResult = validator(first.value);
  } catch {
    issues.push(issue(stage, "stage-threw", "Validation threw an exception."));
  } finally {
    checkUnchanged(first.value, first.before, stage, issues, maximum, mutationMessage);
  }
  try {
    secondResult = validator(second.value);
  } catch {
    issues.push(issue(stage, "stage-threw", "A repeated validation call threw an exception."));
  } finally {
    checkUnchanged(second.value, second.before, stage, issues, maximum, mutationMessage);
  }

  if (!firstResult || !secondResult) return;
  if (firstResult.ok !== secondResult.ok) {
    issues.push(issue(stage, "non-deterministic", nonDeterministicMessage));
    return;
  }
  if (!firstResult.ok || !secondResult.ok) {
    issues.push(issue(stage, rejectedCode, rejectedMessage));
    return;
  }
  const same = deterministic(firstResult.value, secondResult.value, stage, issues, maximum);
  if (same === false) {
    issues.push(issue(stage, "non-deterministic", nonDeterministicMessage));
  }
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
  scenario: AdapterConformanceScenario<TPlanOptions, TAlternateOptions>,
): AdapterConformanceResult {
  const issues: AdapterConformanceIssue[] = [];
  const maximum = scenario.maxSnapshotUnits ?? DEFAULT_MAX_SNAPSHOT_UNITS;
  if (!Number.isInteger(maximum) || maximum < 1) {
    return {
      ok: false,
      issues: [
        issue(
          "declaration",
          "invalid-snapshot-budget",
          "maxSnapshotUnits must be a positive integer.",
        ),
      ],
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
    issues.push(
      issue("declaration", "materialize-without-plan", "Materialization requires planning."),
    );
  }
  if (outputSupport !== "unsupported" && materializeSupport === "unsupported") {
    issues.push(
      issue(
        "declaration",
        "validation-without-materialize",
        "Output validation requires materialization.",
      ),
    );
  }

  const alternateSupport = adapter.capabilities.alternateRepresentation;
  const alternatePresent = typeof adapter.alternateRepresentation === "function";
  if (alternateSupport === "unsupported" && alternatePresent) {
    issues.push(
      issue(
        "declaration",
        "undeclared-alternate-representation",
        "Alternate representation is implemented while unsupported.",
      ),
    );
  }
  if (alternateSupport !== "unsupported" && !alternatePresent) {
    issues.push(
      issue(
        "declaration",
        "missing-alternate-representation",
        "Alternate representation is declared without an implementation.",
      ),
    );
  }

  const validInputBefore = capture(scenario.validInput, "detect", issues, maximum);
  if (validInputBefore === null) return { ok: false, issues };

  let firstDetected: boolean | null = null;
  let secondDetected: boolean | null = null;
  try {
    firstDetected = adapter.detect(scenario.validInput);
  } catch {
    issues.push(issue("detect", "stage-threw", "Detect threw an exception."));
  } finally {
    checkUnchanged(
      scenario.validInput,
      validInputBefore,
      "detect",
      issues,
      maximum,
      "Detect mutated its input.",
    );
  }
  if (firstDetected === null) return { ok: false, issues };
  if (!firstDetected) {
    issues.push(issue("detect", "valid-input-undetected", "Detect rejected the valid fixture."));
  }
  try {
    secondDetected = adapter.detect(scenario.validInput);
  } catch {
    issues.push(issue("detect", "stage-threw", "A repeated detect call threw an exception."));
  } finally {
    checkUnchanged(
      scenario.validInput,
      validInputBefore,
      "detect",
      issues,
      maximum,
      "Detect mutated its input.",
    );
  }
  if (secondDetected !== firstDetected) {
    issues.push(issue("detect", "non-deterministic", "Detect returned different results."));
  }

  if (scenario.invalidInput !== undefined) {
    const before = capture(scenario.invalidInput, "detect", issues, maximum);
    try {
      if (adapter.detect(scenario.invalidInput)) {
        issues.push(
          issue("detect", "invalid-input-detected", "Detect accepted the invalid fixture."),
        );
      }
    } catch {
      issues.push(
        issue("detect", "invalid-stage-threw", "Detect threw for the invalid fixture."),
      );
    } finally {
      checkUnchanged(
        scenario.invalidInput,
        before,
        "detect",
        issues,
        maximum,
        "Detect mutated the invalid fixture.",
      );
    }
  }

  let validated: ValidationResult<TSource> | null = null;
  try {
    validated = adapter.validate(scenario.validInput);
  } catch {
    issues.push(issue("validate", "stage-threw", "Validate threw an exception."));
  } finally {
    checkUnchanged(
      scenario.validInput,
      validInputBefore,
      "validate",
      issues,
      maximum,
      "Validate mutated its input.",
    );
  }
  if (!validated) return { ok: false, issues };
  if (!validated.ok) {
    issues.push(
      issue("validate", "valid-input-rejected", "Validate rejected the valid fixture."),
    );
    return { ok: false, issues };
  }

  let repeatedValidation: ValidationResult<TSource> | null = null;
  try {
    repeatedValidation = adapter.validate(scenario.validInput);
  } catch {
    issues.push(
      issue("validate", "stage-threw", "A repeated validate call threw an exception."),
    );
  } finally {
    checkUnchanged(
      scenario.validInput,
      validInputBefore,
      "validate",
      issues,
      maximum,
      "Validate mutated its input.",
    );
  }
  if (
    repeatedValidation &&
    (!repeatedValidation.ok ||
      deterministic(validated.value, repeatedValidation.value, "validate", issues, maximum) ===
        false)
  ) {
    issues.push(
      issue("validate", "non-deterministic", "Validate returned different values."),
    );
  }

  if (scenario.invalidInput !== undefined) {
    const before = capture(scenario.invalidInput, "validate", issues, maximum);
    try {
      if (adapter.validate(scenario.invalidInput).ok) {
        issues.push(
          issue("validate", "invalid-input-accepted", "Validate accepted the invalid fixture."),
        );
      }
    } catch {
      issues.push(
        issue("validate", "invalid-stage-threw", "Validate threw for the invalid fixture."),
      );
    } finally {
      checkUnchanged(
        scenario.invalidInput,
        before,
        "validate",
        issues,
        maximum,
        "Validate mutated the invalid fixture.",
      );
    }
  }

  const source = validated.value;
  const sourceBeforeFingerprint = capture(source, "fingerprint", issues, maximum);
  let firstFingerprint: ReturnType<typeof adapter.fingerprint> | null = null;
  let secondFingerprint: ReturnType<typeof adapter.fingerprint> | null = null;
  try {
    firstFingerprint = adapter.fingerprint(source);
    secondFingerprint = adapter.fingerprint(source);
  } catch {
    issues.push(issue("fingerprint", "stage-threw", "Fingerprint threw an exception."));
  } finally {
    checkUnchanged(
      source,
      sourceBeforeFingerprint,
      "fingerprint",
      issues,
      maximum,
      "Fingerprint mutated the validated source.",
    );
  }
  if (!firstFingerprint || !secondFingerprint) return { ok: false, issues };
  if (
    deterministic(firstFingerprint, secondFingerprint, "fingerprint", issues, maximum) === false
  ) {
    issues.push(
      issue("fingerprint", "non-deterministic", "Fingerprint returned different values."),
    );
  }
  if (
    firstFingerprint.adapter !== adapter.id ||
    firstFingerprint.adapterVersion !== adapter.version
  ) {
    issues.push(
      issue(
        "fingerprint",
        "identity-mismatch",
        "Fingerprint identity must match the adapter.",
      ),
    );
  }

  let plan: TPlan | undefined;
  let hasPlan = false;
  if (
    planSupport !== "unsupported" &&
    adapter.plan &&
    executionAllowed(planSupport, scenario.synthetic === true, "plan", issues)
  ) {
    if (scenario.planOptions === undefined) {
      issues.push(
        issue("plan", "missing-plan-options", "The scenario must provide plan options."),
      );
    } else {
      const sourceBefore = capture(source, "plan", issues, maximum);
      const optionsBefore = capture(scenario.planOptions, "plan", issues, maximum);
      let firstPlan: ValidationResult<TPlan> | null = null;
      let secondPlan: ValidationResult<TPlan> | null = null;
      try {
        firstPlan = adapter.plan(source, scenario.planOptions);
        secondPlan = adapter.plan(source, scenario.planOptions);
      } catch {
        issues.push(issue("plan", "stage-threw", "Plan threw an exception."));
      } finally {
        checkUnchanged(
          source,
          sourceBefore,
          "plan",
          issues,
          maximum,
          "Plan mutated the validated source.",
        );
        checkUnchanged(
          scenario.planOptions,
          optionsBefore,
          "plan",
          issues,
          maximum,
          "Plan mutated its options.",
        );
      }
      if (firstPlan && !firstPlan.ok) {
        issues.push(
          issue("plan", "valid-source-rejected", "Plan rejected the validated source."),
        );
      }
      if (firstPlan?.ok) {
        plan = firstPlan.value;
        hasPlan = true;
      }
      if (
        firstPlan?.ok &&
        secondPlan &&
        (!secondPlan.ok ||
          deterministic(firstPlan.value, secondPlan.value, "plan", issues, maximum) === false)
      ) {
        issues.push(issue("plan", "non-deterministic", "Plan returned different values."));
      }
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
    const sourceBefore = capture(source, "materialize", issues, maximum);
    const planBefore = capture(plan, "materialize", issues, maximum);
    let firstOutput: ValidationResult<TOutput> | null = null;
    let secondOutput: ValidationResult<TOutput> | null = null;
    try {
      firstOutput = adapter.materialize(source, plan as TPlan);
      secondOutput = adapter.materialize(source, plan as TPlan);
    } catch {
      issues.push(issue("materialize", "stage-threw", "Materialize threw an exception."));
    } finally {
      checkUnchanged(
        source,
        sourceBefore,
        "materialize",
        issues,
        maximum,
        "Materialize mutated its source.",
      );
      checkUnchanged(
        plan,
        planBefore,
        "materialize",
        issues,
        maximum,
        "Materialize mutated its plan.",
      );
    }
    if (firstOutput && !firstOutput.ok) {
      issues.push(
        issue(
          "materialize",
          "valid-plan-rejected",
          "Materialize rejected the plan.",
        ),
      );
    }
    if (firstOutput?.ok) {
      output = firstOutput.value;
      hasOutput = true;
    }
    if (
      firstOutput?.ok &&
      secondOutput &&
      (!secondOutput.ok ||
        deterministic(firstOutput.value, secondOutput.value, "materialize", issues, maximum) ===
          false)
    ) {
      issues.push(
        issue("materialize", "non-deterministic", "Materialize returned different values."),
      );
    }
  }

  if (
    outputSupport !== "unsupported" &&
    adapter.validateOutput &&
    hasOutput &&
    executionAllowed(outputSupport, scenario.synthetic === true, "validateOutput", issues)
  ) {
    validateDetachedTwice(
      output as TOutput,
      adapter.validateOutput,
      "validateOutput",
      issues,
      maximum,
      "materialized-output-rejected",
      "Validate-output rejected the output.",
      "Validate-output mutated the exact object passed to it.",
      "Validate-output returned different values.",
    );
  }

  if (
    alternateSupport !== "unsupported" &&
    adapter.alternateRepresentation &&
    executionAllowed(
      alternateSupport,
      scenario.synthetic === true,
      "alternateRepresentation",
      issues,
    )
  ) {
    if (scenario.alternateOptions === undefined) {
      issues.push(
        issue(
          "alternateRepresentation",
          "missing-alternate-options",
          "The scenario must provide alternate-representation options.",
        ),
      );
    } else {
      const sourceBefore = capture(source, "alternateRepresentation", issues, maximum);
      const optionsBefore = capture(
        scenario.alternateOptions,
        "alternateRepresentation",
        issues,
        maximum,
      );
      let firstRepresentation: ValidationResult<TAlternateRepresentation> | null = null;
      let secondRepresentation: ValidationResult<TAlternateRepresentation> | null = null;
      try {
        firstRepresentation = adapter.alternateRepresentation(
          source,
          scenario.alternateOptions,
        );
        secondRepresentation = adapter.alternateRepresentation(
          source,
          scenario.alternateOptions,
        );
      } catch {
        issues.push(
          issue(
            "alternateRepresentation",
            "stage-threw",
            "Alternate representation threw an exception.",
          ),
        );
      } finally {
        checkUnchanged(
          source,
          sourceBefore,
          "alternateRepresentation",
          issues,
          maximum,
          "Alternate representation mutated the validated source.",
        );
        checkUnchanged(
          scenario.alternateOptions,
          optionsBefore,
          "alternateRepresentation",
          issues,
          maximum,
          "Alternate representation mutated its options.",
        );
      }

      if (firstRepresentation && !firstRepresentation.ok) {
        issues.push(
          issue(
            "alternateRepresentation",
            "valid-source-rejected",
            "Alternate representation rejected the validated source.",
          ),
        );
      }
      if (
        firstRepresentation?.ok &&
        secondRepresentation &&
        (!secondRepresentation.ok ||
          deterministic(
            firstRepresentation.value,
            secondRepresentation.value,
            "alternateRepresentation",
            issues,
            maximum,
          ) === false)
      ) {
        issues.push(
          issue(
            "alternateRepresentation",
            "non-deterministic",
            "Alternate representation returned different values.",
          ),
        );
      }
      if (firstRepresentation?.ok) {
        validateDetachedTwice(
          firstRepresentation.value,
          scenario.validateAlternateRepresentation ?? validateReadOnlyRepresentation,
          "validateAlternateRepresentation",
          issues,
          maximum,
          "alternate-output-rejected",
          "Alternate-output validation rejected the representation.",
          "Alternate-output validation mutated the exact object passed to it.",
          "Alternate-output validation returned different values.",
        );
      }
    }
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
