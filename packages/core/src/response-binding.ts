// SPDX-License-Identifier: MPL-2.0

export const RESPONSE_BINDING_VERSION = "0.1.0" as const;

export const RESPONSE_BINDING_STAGES = [
  "select",
  "authorize",
  "collect",
  "decode",
  "pipeline",
  "serialize",
] as const;
export type ResponseBindingStage = (typeof RESPONSE_BINDING_STAGES)[number];

export const RESPONSE_BINDING_REASON_CODES = [
  "transformed",
  "configuration-invalid",
  "selector-miss",
  "selector-ambiguous",
  "selector-invalid",
  "selector-exception",
  "authorization-denied",
  "authorization-invalid",
  "authorization-exception",
  "cancelled",
  "chunk-invalid",
  "chunk-limit-exceeded",
  "body-byte-limit-exceeded",
  "decode-exception",
  "pipeline-pass-through",
  "pipeline-invalid",
  "pipeline-exception",
  "serialize-invalid",
  "output-byte-limit-exceeded",
  "serialize-exception",
] as const;
export type ResponseBindingReasonCode = (typeof RESPONSE_BINDING_REASON_CODES)[number];
export type ResponseBindingPassThroughReason = Exclude<ResponseBindingReasonCode, "transformed">;

export type ResponseClassSelection =
  | Readonly<{ kind: "match" }>
  | Readonly<{ kind: "miss" }>
  | Readonly<{ kind: "ambiguous" }>;

export type ResponseAuthorizationDecision =
  | Readonly<{ eligible: true }>
  | Readonly<{ eligible: false }>;

export type ResponsePipelineDecision<TOutput> =
  | Readonly<{ kind: "pass-through" }>
  | Readonly<{ kind: "transformed"; output: TOutput }>;

export type ResponseBindingCancellation = Readonly<{ aborted: boolean }>;

export type ResponseBindingLimits = Readonly<{
  maxChunks: number;
  maxBodyBytes: number;
  maxOutputBytes: number;
}>;

export const DEFAULT_RESPONSE_BINDING_LIMITS: ResponseBindingLimits = Object.freeze({
  maxChunks: 16_384,
  maxBodyBytes: 256 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
});

export type ResponseBindingDependencies<TMetadata, TDecoded, TOutput> = Readonly<{
  select(metadata: TMetadata): ResponseClassSelection;
  authorize(metadata: TMetadata): ResponseAuthorizationDecision;
  decode(bytes: Uint8Array): TDecoded;
  runPipeline(decoded: TDecoded): ResponsePipelineDecision<TOutput>;
  serialize(output: TOutput): Uint8Array;
}>;

export type ResponseBindingDiagnostic = Readonly<{
  schemaVersion: 1;
  bindingVersion: typeof RESPONSE_BINDING_VERSION;
  decision: "pass-through" | "transformed";
  stage: ResponseBindingStage;
  reasonCode: ResponseBindingReasonCode;
  completedStages: readonly ResponseBindingStage[];
  chunkCount: number;
  inputByteCount: number;
  outputByteCount: number;
}>;

export type ResponseBindingDecision =
  | Readonly<{
      kind: "pass-through";
      chunks: readonly Uint8Array[];
      diagnostic: ResponseBindingDiagnostic;
    }>
  | Readonly<{
      kind: "transformed";
      chunks: readonly [Uint8Array];
      diagnostic: ResponseBindingDiagnostic;
    }>;

export type PrepareResponseBindingOptions = Readonly<{
  limits?: Partial<ResponseBindingLimits>;
  cancellation?: ResponseBindingCancellation;
}>;

const NEVER_CANCELLED: ResponseBindingCancellation = Object.freeze({ aborted: false });

function fixedInteger(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function resolveLimits(value: Partial<ResponseBindingLimits> | undefined): ResponseBindingLimits | null {
  const maxChunks = fixedInteger(value?.maxChunks ?? DEFAULT_RESPONSE_BINDING_LIMITS.maxChunks, 0);
  const maxBodyBytes = fixedInteger(value?.maxBodyBytes ?? DEFAULT_RESPONSE_BINDING_LIMITS.maxBodyBytes, 0);
  const maxOutputBytes = fixedInteger(
    value?.maxOutputBytes ?? DEFAULT_RESPONSE_BINDING_LIMITS.maxOutputBytes,
    0,
  );
  return maxChunks === null || maxBodyBytes === null || maxOutputBytes === null
    ? null
    : Object.freeze({ maxChunks, maxBodyBytes, maxOutputBytes });
}

function cancellationAborted(value: ResponseBindingCancellation): boolean | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "aborted");
  return descriptor && "value" in descriptor && typeof descriptor.value === "boolean"
    ? descriptor.value
    : null;
}

function captureFunction(value: object, key: string): ((...args: never[]) => unknown) | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && typeof descriptor.value === "function"
    ? (descriptor.value as (...args: never[]) => unknown)
    : null;
}

function captureDependencies<TMetadata, TDecoded, TOutput>(
  value: ResponseBindingDependencies<TMetadata, TDecoded, TOutput>,
): ResponseBindingDependencies<TMetadata, TDecoded, TOutput> | null {
  if (typeof value !== "object" || value === null) return null;
  const select = captureFunction(value, "select");
  const authorize = captureFunction(value, "authorize");
  const decode = captureFunction(value, "decode");
  const runPipeline = captureFunction(value, "runPipeline");
  const serialize = captureFunction(value, "serialize");
  if (!select || !authorize || !decode || !runPipeline || !serialize) return null;
  return Object.freeze({
    select: select as ResponseBindingDependencies<TMetadata, TDecoded, TOutput>["select"],
    authorize: authorize as ResponseBindingDependencies<TMetadata, TDecoded, TOutput>["authorize"],
    decode: decode as ResponseBindingDependencies<TMetadata, TDecoded, TOutput>["decode"],
    runPipeline: runPipeline as ResponseBindingDependencies<TMetadata, TDecoded, TOutput>["runPipeline"],
    serialize: serialize as ResponseBindingDependencies<TMetadata, TDecoded, TOutput>["serialize"],
  });
}

function captureSelection(value: unknown): ResponseClassSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  const kind = descriptor && "value" in descriptor ? descriptor.value : null;
  return kind === "match" || kind === "miss" || kind === "ambiguous"
    ? Object.freeze({ kind })
    : null;
}

function captureAuthorization(value: unknown): ResponseAuthorizationDecision | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "eligible");
  const eligible = descriptor && "value" in descriptor ? descriptor.value : null;
  return typeof eligible === "boolean" ? Object.freeze({ eligible }) : null;
}

function capturePipelineDecision<TOutput>(value: unknown): ResponsePipelineDecision<TOutput> | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kindDescriptor = descriptors.kind;
  const kind = kindDescriptor && "value" in kindDescriptor ? kindDescriptor.value : null;
  if (kind === "pass-through") return Object.freeze({ kind });
  const outputDescriptor = descriptors.output;
  return kind === "transformed" && outputDescriptor && "value" in outputDescriptor
    ? Object.freeze({ kind, output: outputDescriptor.value as TOutput })
    : null;
}

function makeDiagnostic(
  decision: "pass-through" | "transformed",
  stage: ResponseBindingStage,
  reasonCode: ResponseBindingReasonCode,
  completedStages: readonly ResponseBindingStage[],
  chunkCount: number,
  inputByteCount: number,
  outputByteCount: number,
): ResponseBindingDiagnostic {
  return Object.freeze({
    schemaVersion: 1,
    bindingVersion: RESPONSE_BINDING_VERSION,
    decision,
    stage,
    reasonCode,
    completedStages: Object.freeze([...completedStages]),
    chunkCount,
    inputByteCount,
    outputByteCount,
  });
}

function passThrough(
  chunks: readonly Uint8Array[],
  stage: ResponseBindingStage,
  reasonCode: ResponseBindingPassThroughReason,
  completedStages: readonly ResponseBindingStage[],
  inputByteCount = 0,
): ResponseBindingDecision {
  return Object.freeze({
    kind: "pass-through",
    chunks,
    diagnostic: makeDiagnostic(
      "pass-through",
      stage,
      reasonCode,
      completedStages,
      chunks.length,
      inputByteCount,
      inputByteCount,
    ),
  });
}

function isStandardByteChunk(value: unknown): value is Uint8Array {
  if (!(value instanceof Uint8Array)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Uint8Array.prototype;
}

export function prepareResponseBinding<TMetadata, TDecoded, TOutput>(
  metadata: TMetadata,
  chunks: readonly Uint8Array[],
  dependencies: ResponseBindingDependencies<TMetadata, TDecoded, TOutput>,
  options: PrepareResponseBindingOptions = {},
): ResponseBindingDecision {
  const captured = captureDependencies(dependencies);
  const limits = resolveLimits(options.limits);
  const cancellation = options.cancellation ?? NEVER_CANCELLED;
  const initialCancellation = cancellationAborted(cancellation);
  if (!captured || !limits || initialCancellation === null) {
    return passThrough(chunks, "select", "configuration-invalid", []);
  }
  if (initialCancellation) return passThrough(chunks, "select", "cancelled", []);

  const completed: ResponseBindingStage[] = [];

  let selection: ResponseClassSelection | null = null;
  try {
    selection = captureSelection(captured.select(metadata));
  } catch {
    return passThrough(chunks, "select", "selector-exception", completed);
  }
  if (!selection) return passThrough(chunks, "select", "selector-invalid", completed);
  completed.push("select");
  if (selection.kind === "miss") return passThrough(chunks, "select", "selector-miss", completed);
  if (selection.kind === "ambiguous") {
    return passThrough(chunks, "select", "selector-ambiguous", completed);
  }

  if (cancellationAborted(cancellation)) return passThrough(chunks, "authorize", "cancelled", completed);
  let authorization: ResponseAuthorizationDecision | null = null;
  try {
    authorization = captureAuthorization(captured.authorize(metadata));
  } catch {
    return passThrough(chunks, "authorize", "authorization-exception", completed);
  }
  if (!authorization) return passThrough(chunks, "authorize", "authorization-invalid", completed);
  completed.push("authorize");
  if (!authorization.eligible) {
    return passThrough(chunks, "authorize", "authorization-denied", completed);
  }

  if (chunks.length > limits.maxChunks) {
    return passThrough(chunks, "collect", "chunk-limit-exceeded", completed);
  }

  let inputByteCount = 0;
  for (const chunk of chunks) {
    if (cancellationAborted(cancellation)) {
      return passThrough(chunks, "collect", "cancelled", completed, inputByteCount);
    }
    if (!isStandardByteChunk(chunk)) {
      return passThrough(chunks, "collect", "chunk-invalid", completed, inputByteCount);
    }
    inputByteCount += chunk.byteLength;
    if (!Number.isSafeInteger(inputByteCount) || inputByteCount > limits.maxBodyBytes) {
      return passThrough(chunks, "collect", "body-byte-limit-exceeded", completed, inputByteCount);
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(inputByteCount);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch {
    return passThrough(chunks, "collect", "body-byte-limit-exceeded", completed, inputByteCount);
  }
  completed.push("collect");

  if (cancellationAborted(cancellation)) {
    return passThrough(chunks, "decode", "cancelled", completed, inputByteCount);
  }
  let decoded: TDecoded;
  try {
    decoded = captured.decode(bytes);
  } catch {
    return passThrough(chunks, "decode", "decode-exception", completed, inputByteCount);
  }
  completed.push("decode");

  if (cancellationAborted(cancellation)) {
    return passThrough(chunks, "pipeline", "cancelled", completed, inputByteCount);
  }
  let pipelineDecision: ResponsePipelineDecision<TOutput> | null = null;
  try {
    pipelineDecision = capturePipelineDecision<TOutput>(captured.runPipeline(decoded));
  } catch {
    return passThrough(chunks, "pipeline", "pipeline-exception", completed, inputByteCount);
  }
  if (!pipelineDecision) {
    return passThrough(chunks, "pipeline", "pipeline-invalid", completed, inputByteCount);
  }
  completed.push("pipeline");
  if (pipelineDecision.kind === "pass-through") {
    return passThrough(chunks, "pipeline", "pipeline-pass-through", completed, inputByteCount);
  }

  if (cancellationAborted(cancellation)) {
    return passThrough(chunks, "serialize", "cancelled", completed, inputByteCount);
  }
  let serialized: Uint8Array;
  try {
    const candidate = captured.serialize(pipelineDecision.output);
    if (!isStandardByteChunk(candidate)) {
      return passThrough(chunks, "serialize", "serialize-invalid", completed, inputByteCount);
    }
    if (candidate.byteLength > limits.maxOutputBytes) {
      return passThrough(
        chunks,
        "serialize",
        "output-byte-limit-exceeded",
        completed,
        inputByteCount,
      );
    }
    serialized = candidate.slice();
  } catch {
    return passThrough(chunks, "serialize", "serialize-exception", completed, inputByteCount);
  }
  completed.push("serialize");

  const transformedChunk = serialized;
  return Object.freeze({
    kind: "transformed",
    chunks: Object.freeze([transformedChunk]) as readonly [Uint8Array],
    diagnostic: makeDiagnostic(
      "transformed",
      "serialize",
      "transformed",
      completed,
      chunks.length,
      inputByteCount,
      transformedChunk.byteLength,
    ),
  });
}
