// SPDX-License-Identifier: MPL-2.0
import type { StructuralFingerprint } from "./index.js";
import {
  DEFAULT_PIPELINE_BUDGETS,
  type CancellationSignal,
  type DetectionResult,
  type DiagnosticEnvelope,
  type FailOpenPipelineAdapter,
  FAIL_OPEN_PIPELINE_VERSION,
  type PassThroughReasonCode,
  type PipelineBudgets,
  type PipelineBudgetUsage,
  type PipelineFaultMode,
  type PipelineReasonCode,
  type PipelineStage,
  type PipelineStageContext,
} from "./orchestration-model.js";

export class PipelineBudgetError extends Error {
  constructor(readonly reasonCode: Extract<PipelineReasonCode, `budget-${string}`>) {
    super(reasonCode);
  }
}
export class PipelineCancelledError extends Error {}
export class PipelineFaultError extends Error {}
export class PipelineUnsupportedInputError extends Error {}

export const NEVER_CANCELLED: CancellationSignal = Object.freeze({ aborted: false });

function finiteInteger(value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError("Invalid numeric limit.");
  return value;
}

export function resolveBudgets(overrides: Partial<PipelineBudgets> | undefined): PipelineBudgets {
  const merged = { ...DEFAULT_PIPELINE_BUDGETS, ...overrides };
  return Object.freeze({
    maxElapsedMs: finiteInteger(merged.maxElapsedMs, 0),
    maxInputBytes: finiteInteger(merged.maxInputBytes, 0),
    maxNodes: finiteInteger(merged.maxNodes, 1),
    maxRecursionDepth: finiteInteger(merged.maxRecursionDepth, 0),
    maxOperations: finiteInteger(merged.maxOperations, 1),
    maxAllocatedBytes: finiteInteger(merged.maxAllocatedBytes, 0),
  });
}

export class BudgetLedger {
  readonly #clock: () => number;
  readonly #startedAt: number;
  #inputBytes = 0;
  #nodesVisited = 0;
  #operations = 0;
  #allocatedBytes = 0;
  #checkpoints = 0;

  constructor(
    readonly budgets: PipelineBudgets,
    readonly cancellation: CancellationSignal,
    clock: () => number,
  ) {
    this.#clock = clock;
    this.#startedAt = clock();
  }

  checkpoint(): void {
    this.#checkpoints += 1;
    if (this.cancellation.aborted) throw new PipelineCancelledError();
    const elapsed = this.#clock() - this.#startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > this.budgets.maxElapsedMs) {
      throw new PipelineBudgetError("budget-time-exceeded");
    }
  }

  consumeOperations(count = 1): void {
    finiteInteger(count, 0);
    this.#operations += count;
    if (this.#operations > this.budgets.maxOperations) {
      throw new PipelineBudgetError("budget-operation-exceeded");
    }
  }

  reserveAllocation(bytes: number): void {
    finiteInteger(bytes, 0);
    this.#allocatedBytes += bytes;
    if (this.#allocatedBytes > this.budgets.maxAllocatedBytes) {
      throw new PipelineBudgetError("budget-allocation-exceeded");
    }
  }

  assertRecursionDepth(depth: number): void {
    finiteInteger(depth, 0);
    if (depth > this.budgets.maxRecursionDepth) {
      throw new PipelineBudgetError("budget-recursion-exceeded");
    }
  }

  measureInput(input: unknown): void {
    const ancestors = new WeakSet<object>();
    const stack: Array<{ value: unknown; depth: number; leaving?: object }> = [{ value: input, depth: 0 }];
    while (stack.length > 0) {
      this.checkpoint();
      const entry = stack.pop();
      if (!entry) continue;
      if (entry.leaving) {
        ancestors.delete(entry.leaving);
        continue;
      }
      this.consumeOperations();
      this.assertRecursionDepth(entry.depth);
      this.#nodesVisited += 1;
      if (this.#nodesVisited > this.budgets.maxNodes) {
        throw new PipelineBudgetError("budget-node-count-exceeded");
      }

      const value = entry.value;
      if (value === null) this.#inputBytes += 4;
      else if (typeof value === "string") this.#inputBytes += value.length * 2;
      else if (typeof value === "number") this.#inputBytes += 8;
      else if (typeof value === "boolean") this.#inputBytes += 4;
      else if (Array.isArray(value)) {
        if (ancestors.has(value)) throw new PipelineUnsupportedInputError();
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(value).length > 0) throw new PipelineUnsupportedInputError();
        const descriptorKeys = Object.keys(descriptors);
        if (descriptorKeys.some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) {
          throw new PipelineUnsupportedInputError();
        }
        ancestors.add(value);
        this.#inputBytes += 24 + value.length * 8;
        stack.push({ value: null, depth: entry.depth, leaving: value });
        for (let index = value.length - 1; index >= 0; index -= 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new PipelineUnsupportedInputError();
          }
          stack.push({ value: descriptor.value, depth: entry.depth + 1 });
        }
      } else if (typeof value === "object") {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw new PipelineUnsupportedInputError();
        if (ancestors.has(value)) throw new PipelineUnsupportedInputError();
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(value).length > 0) throw new PipelineUnsupportedInputError();
        const keys = Object.keys(descriptors).sort();
        ancestors.add(value);
        this.#inputBytes += 32;
        stack.push({ value: null, depth: entry.depth, leaving: value });
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const key = keys[index];
          if (key === undefined) continue;
          const descriptor = descriptors[key];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new PipelineUnsupportedInputError();
          }
          this.#inputBytes += key.length * 2;
          stack.push({ value: descriptor.value, depth: entry.depth + 1 });
        }
      } else throw new PipelineUnsupportedInputError();

      if (this.#inputBytes > this.budgets.maxInputBytes) {
        throw new PipelineBudgetError("budget-input-size-exceeded");
      }
    }
  }

  usage(): PipelineBudgetUsage {
    return Object.freeze({
      inputBytes: this.#inputBytes,
      nodesVisited: this.#nodesVisited,
      operations: this.#operations,
      allocatedBytes: this.#allocatedBytes,
      checkpoints: this.#checkpoints,
    });
  }
}

export function stageContext(stage: PipelineStage, ledger: BudgetLedger): PipelineStageContext {
  return Object.freeze({
    stage,
    budgets: ledger.budgets,
    cancellation: ledger.cancellation,
    checkpoint: () => ledger.checkpoint(),
    consumeOperations: (count?: number) => ledger.consumeOperations(count),
    reserveAllocation: (bytes: number) => ledger.reserveAllocation(bytes),
    assertRecursionDepth: (depth: number) => ledger.assertRecursionDepth(depth),
  });
}

export function injectFault(stage: PipelineStage, mode: PipelineFaultMode | undefined, ledger: BudgetLedger): void {
  if (mode === undefined) return;
  if (mode === "cancel") throw new PipelineCancelledError();
  if (mode === "budget") ledger.consumeOperations(ledger.budgets.maxOperations + 1);
  else throw new PipelineFaultError();
}

export type CapturedValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issueCount: number }>;

function ownDataValue(descriptors: PropertyDescriptorMap, key: string): unknown {
  const descriptor = descriptors[key];
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function readDetectionResult(value: unknown): DetectionResult | null {
  if (!value || typeof value !== "object") return null;
  const kind = ownDataValue(Object.getOwnPropertyDescriptors(value), "kind");
  return kind === "match" || kind === "miss" || kind === "ambiguous"
    ? Object.freeze({ kind })
    : null;
}

export function readValidationResult<T>(value: unknown): CapturedValidationResult<T> | null {
  if (!value || typeof value !== "object") return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ok = ownDataValue(descriptors, "ok");
  if (ok === true) {
    const valueDescriptor = descriptors.value;
    const warnings = ownDataValue(descriptors, "warnings");
    if (!valueDescriptor || !("value" in valueDescriptor) || !Array.isArray(warnings)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(warnings, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number") return null;
    return Object.freeze({ ok: true, value: valueDescriptor.value as T });
  }
  if (ok === false) {
    const issues = ownDataValue(descriptors, "issues");
    if (!Array.isArray(issues)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(issues, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) return null;
    return Object.freeze({ ok: false, issueCount: lengthDescriptor.value });
  }
  return null;
}

export type CapturedPipelineAdapter<TSource, TPlan, TOutput> = Readonly<{
  id: string;
  version: string;
  detect: FailOpenPipelineAdapter<TSource, TPlan, TOutput>["detect"];
  validateInput: FailOpenPipelineAdapter<TSource, TPlan, TOutput>["validateInput"];
  fingerprint: FailOpenPipelineAdapter<TSource, TPlan, TOutput>["fingerprint"];
  plan: FailOpenPipelineAdapter<TSource, TPlan, TOutput>["plan"];
  materialize: FailOpenPipelineAdapter<TSource, TPlan, TOutput>["materialize"];
  validateOutput: FailOpenPipelineAdapter<TSource, TPlan, TOutput>["validateOutput"];
}>;

const DIAGNOSTIC_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FINGERPRINT_HASH = /^[0-9a-f]{8,128}$/;
const MAX_FINGERPRINT_SHAPE_LENGTH = 131_072;

export function readAdapterIdentity(value: unknown): Readonly<{ id: string; version: string }> | null {
  if (!value || typeof value !== "object") return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const idDescriptor = descriptors.id;
  const versionDescriptor = descriptors.version;
  if (!idDescriptor || !("value" in idDescriptor) || !versionDescriptor || !("value" in versionDescriptor)) {
    return null;
  }
  const id = idDescriptor.value;
  const version = versionDescriptor.value;
  if (typeof id !== "string" || !DIAGNOSTIC_TOKEN.test(id)) return null;
  if (typeof version !== "string" || !DIAGNOSTIC_TOKEN.test(version)) return null;
  return Object.freeze({ id, version });
}

export function capturePipelineAdapter<TSource, TPlan, TOutput>(
  value: unknown,
): CapturedPipelineAdapter<TSource, TPlan, TOutput> | null {
  const identity = readAdapterIdentity(value);
  if (!identity || !value || typeof value !== "object") return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const detect = ownDataValue(descriptors, "detect");
  const validateInput = ownDataValue(descriptors, "validateInput");
  const fingerprint = ownDataValue(descriptors, "fingerprint");
  const plan = ownDataValue(descriptors, "plan");
  const materialize = ownDataValue(descriptors, "materialize");
  const validateOutput = ownDataValue(descriptors, "validateOutput");
  if (
    typeof detect !== "function" ||
    typeof validateInput !== "function" ||
    typeof fingerprint !== "function" ||
    typeof plan !== "function" ||
    typeof materialize !== "function" ||
    typeof validateOutput !== "function"
  ) {
    return null;
  }
  return Object.freeze({
    ...identity,
    detect: detect as CapturedPipelineAdapter<TSource, TPlan, TOutput>["detect"],
    validateInput: validateInput as CapturedPipelineAdapter<TSource, TPlan, TOutput>["validateInput"],
    fingerprint: fingerprint as CapturedPipelineAdapter<TSource, TPlan, TOutput>["fingerprint"],
    plan: plan as CapturedPipelineAdapter<TSource, TPlan, TOutput>["plan"],
    materialize: materialize as CapturedPipelineAdapter<TSource, TPlan, TOutput>["materialize"],
    validateOutput: validateOutput as CapturedPipelineAdapter<TSource, TPlan, TOutput>["validateOutput"],
  });
}

export function readValidFingerprint(
  value: unknown,
  adapter: Readonly<{ id: string; version: string }>,
): StructuralFingerprint | null {
  if (!value || typeof value !== "object") return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const readString = (key: keyof StructuralFingerprint): string | null => {
    const descriptor = descriptors[key];
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : null;
  };
  const candidate = {
    adapter: readString("adapter"),
    adapterVersion: readString("adapterVersion"),
    shape: readString("shape"),
    hash: readString("hash"),
  };
  if (candidate.adapter !== adapter.id || candidate.adapterVersion !== adapter.version) return null;
  if (!candidate.shape || candidate.shape.length > MAX_FINGERPRINT_SHAPE_LENGTH) return null;
  if (!candidate.hash || !FINGERPRINT_HASH.test(candidate.hash)) return null;
  return Object.freeze({
    adapter: candidate.adapter,
    adapterVersion: candidate.adapterVersion,
    shape: candidate.shape,
    hash: candidate.hash,
  });
}

export function mappedReason(error: unknown, stage: PipelineStage): PassThroughReasonCode {
  if (error instanceof PipelineBudgetError) return error.reasonCode;
  if (error instanceof PipelineCancelledError) return "cancelled";
  if (error instanceof PipelineFaultError) return "fault-injected";
  if (error instanceof PipelineUnsupportedInputError) return "input-schema-unsupported";
  switch (stage) {
    case "detect": return "detect-exception";
    case "validate-input": return "validate-input-exception";
    case "fingerprint": return "fingerprint-exception";
    case "plan": return "plan-exception";
    case "materialize": return "materialize-exception";
    case "validate-output": return "validate-output-exception";
  }
}

export function makeDiagnostic(
  adapter: Readonly<{ id: string; version: string }>,
  ledger: BudgetLedger,
  decision: "pass-through" | "transformed",
  stage: PipelineStage,
  reasonCode: PipelineReasonCode,
  completedStages: readonly PipelineStage[],
  issueCount: number,
  fingerprintHash?: string,
): DiagnosticEnvelope {
  return Object.freeze({
    schemaVersion: 1,
    pipelineVersion: FAIL_OPEN_PIPELINE_VERSION,
    adapter: Object.freeze({ id: adapter.id, version: adapter.version }),
    decision,
    stage,
    reasonCode,
    completedStages: Object.freeze([...completedStages]),
    issueCount,
    ...(fingerprintHash === undefined ? {} : { fingerprintHash }),
    budget: Object.freeze({ limits: ledger.budgets, usage: ledger.usage() }),
  });
}

export function fallbackRuntime(adapter?: unknown): {
  adapter: Readonly<{ id: string; version: string }>;
  ledger: BudgetLedger;
} {
  let safeAdapter: Readonly<{ id: string; version: string }> = Object.freeze({
    id: "invalid-adapter",
    version: "invalid-version",
  });
  try {
    const identity = readAdapterIdentity(adapter);
    if (identity) safeAdapter = identity;
  } catch {
    // Accessor failures are configuration failures and stay content-free.
  }
  return { adapter: safeAdapter, ledger: new BudgetLedger(DEFAULT_PIPELINE_BUDGETS, NEVER_CANCELLED, () => 0) };
}
