// SPDX-License-Identifier: MPL-2.0

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

export type WindowPolicy = {
  turnGroups: number;
  includeBranchSiblings: boolean;
};

export type StructuralFingerprint = {
  adapter: string;
  adapterVersion: string;
  shape: string;
  hash: string;
};

export interface Adapter<TSource, TSnapshot> {
  readonly id: string;
  readonly version: string;
  detect(input: unknown): boolean;
  validate(input: unknown): ValidationResult<TSource>;
  fingerprint(source: TSource): StructuralFingerprint;
  window(source: TSource, policy: WindowPolicy): ValidationResult<TSnapshot>;
  validateSnapshot(snapshot: unknown): ValidationResult<TSnapshot>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeShape(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (depth <= 0 || value.length === 0) return "array";
    return `array<${describeShape(value[0], depth - 1)}>`;
  }
  if (!isRecord(value)) return typeof value;
  if (depth <= 0) return "object";
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${key}:${describeShape(value[key], depth - 1)}`)
    .join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintShape(
  adapter: string,
  adapterVersion: string,
  input: unknown,
  depth = 3,
): StructuralFingerprint {
  const shape = describeShape(input, depth);
  return { adapter, adapterVersion, shape, hash: fnv1a(shape) };
}
