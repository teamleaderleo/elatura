// SPDX-License-Identifier: MPL-2.0
import type { ValidationIssue, ValidationResult } from "./index.js";

export type BoundedJsonLimits = Readonly<{
  maxDepth: number;
  maxNodes: number;
  maxStringCodeUnits: number;
  maxSerializedBytes: number;
}>;

export type BoundedJsonUsage = Readonly<{
  nodes: number;
  stringCodeUnits: number;
  serializedBytes: number;
}>;

export type SerializedBoundedJson = Readonly<{
  serialized: string;
  usage: BoundedJsonUsage;
}>;

export const DEFAULT_BOUNDED_JSON_LIMITS: BoundedJsonLimits = Object.freeze({
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxStringCodeUnits: 1_048_576,
  maxSerializedBytes: 4_194_304,
});

function issue(code: string, message: string): ValidationResult<never> {
  return { ok: false, issues: [{ path: "$", code, message }] };
}

function limits(input: Partial<BoundedJsonLimits> | undefined): BoundedJsonLimits {
  const resolved = { ...DEFAULT_BOUNDED_JSON_LIMITS, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(resolved);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function plainPrototype(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null || Array.isArray(value);
}

type MutableUsage = {
  nodes: number;
  stringCodeUnits: number;
  serializedBytes: number;
};

class AccountingFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function addBytes(state: MutableUsage, amount: number, resolved: BoundedJsonLimits): void {
  state.serializedBytes += amount;
  if (state.serializedBytes > resolved.maxSerializedBytes) {
    throw new AccountingFailure("json-serialized-byte-limit", "JSON exceeds the serialized-byte limit.");
  }
}

function addString(state: MutableUsage, value: string, resolved: BoundedJsonLimits): void {
  if (value.length > resolved.maxStringCodeUnits) {
    throw new AccountingFailure("json-string-limit", "A JSON string exceeds the code-unit limit.");
  }
  state.stringCodeUnits += value.length;
  addBytes(state, jsonStringBytes(value), resolved);
}

function visit(
  value: unknown,
  depth: number,
  state: MutableUsage,
  resolved: BoundedJsonLimits,
  active: Set<object>,
): void {
  if (depth > resolved.maxDepth) {
    throw new AccountingFailure("json-depth-limit", "JSON exceeds the traversal-depth limit.");
  }
  state.nodes += 1;
  if (state.nodes > resolved.maxNodes) {
    throw new AccountingFailure("json-node-limit", "JSON exceeds the node limit.");
  }

  if (value === null) {
    addBytes(state, 4, resolved);
    return;
  }
  if (typeof value === "string") {
    addString(state, value, resolved);
    return;
  }
  if (typeof value === "boolean") {
    addBytes(state, value ? 4 : 5, resolved);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AccountingFailure("json-unsupported-value", "JSON numbers must be finite.");
    }
    addBytes(state, value === 0 ? 1 : String(value).length, resolved);
    return;
  }
  if (typeof value !== "object") {
    throw new AccountingFailure("json-unsupported-value", "Value is not supported by the JSON contract.");
  }
  if (!plainPrototype(value)) {
    throw new AccountingFailure("json-non-plain-object", "JSON objects must use plain or null prototypes.");
  }
  if (active.has(value)) {
    throw new AccountingFailure("json-cycle", "JSON values must be acyclic.");
  }
  active.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new AccountingFailure("json-symbol-key", "JSON values must not contain symbol keys.");
    }
    if (Array.isArray(value)) {
      const keys = Object.keys(descriptors).filter((key) => key !== "length");
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new AccountingFailure("json-sparse-array", "JSON arrays must be dense and contain no extra properties.");
      }
      addBytes(state, 1, resolved);
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) addBytes(state, 1, resolved);
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
          throw new AccountingFailure("json-accessor", "JSON values must not contain accessors.");
        }
        visit(descriptor.value, depth + 1, state, resolved, active);
      }
      addBytes(state, 1, resolved);
      return;
    }

    const keys = Object.keys(descriptors);
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
        throw new AccountingFailure("json-accessor", "JSON objects must contain enumerable data properties only.");
      }
    }
    addBytes(state, 1, resolved);
    keys.forEach((key, index) => {
      if (index > 0) addBytes(state, 1, resolved);
      addString(state, key, resolved);
      addBytes(state, 1, resolved);
      visit(descriptors[key]!.value, depth + 1, state, resolved, active);
    });
    addBytes(state, 1, resolved);
  } finally {
    active.delete(value);
  }
}

export function measureBoundedJson(
  value: unknown,
  inputLimits?: Partial<BoundedJsonLimits>,
): ValidationResult<BoundedJsonUsage> {
  let resolved: BoundedJsonLimits;
  try {
    resolved = limits(inputLimits);
  } catch {
    return issue("json-policy-invalid", "JSON resource policy is invalid.");
  }
  const state: MutableUsage = { nodes: 0, stringCodeUnits: 0, serializedBytes: 0 };
  try {
    visit(value, 0, state, resolved, new Set());
    return { ok: true, value: Object.freeze({ ...state }), warnings: [] };
  } catch (error) {
    if (error instanceof AccountingFailure) return issue(error.code, error.message);
    return issue("json-inspection-failed", "JSON inspection failed safely.");
  }
}

export function serializeBoundedJson(
  value: unknown,
  inputLimits?: Partial<BoundedJsonLimits>,
): ValidationResult<SerializedBoundedJson> {
  const measured = measureBoundedJson(value, inputLimits);
  if (!measured.ok) return measured;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || utf8ByteLength(serialized) !== measured.value.serializedBytes) {
      return issue("json-changed-during-serialization", "JSON changed during serialization.");
    }
    return {
      ok: true,
      value: Object.freeze({ serialized, usage: measured.value }),
      warnings: [],
    };
  } catch {
    return issue("json-serialization-failed", "JSON serialization failed safely.");
  }
}

export function accountedResidentBytes(
  serialized: string,
  decodedCopies: number,
): number {
  if (!Number.isSafeInteger(decodedCopies) || decodedCopies < 1) {
    throw new RangeError("decodedCopies must be a positive safe integer.");
  }
  const serializedStorageBytes = serialized.length * 2;
  const decodedEstimateBytes = utf8ByteLength(serialized) * decodedCopies;
  const total = serializedStorageBytes + decodedEstimateBytes;
  if (!Number.isSafeInteger(total)) throw new RangeError("Accounted resident bytes exceed safe integer range.");
  return total;
}
