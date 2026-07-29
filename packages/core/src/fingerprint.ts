// SPDX-License-Identifier: MPL-2.0
import { isRecord, type StructuralFingerprint } from "./legacy-index.js";

export type FingerprintShapeOptions = {
  depth?: number;
  dictionaryPaths?: readonly string[];
  maxUniqueVariants?: number;
  maxObjectKeys?: number;
  maxShapeLength?: number;
  maxVisitedValues?: number;
};

type ResolvedFingerprintShapeOptions = {
  depth: number;
  dictionaryPaths: ReadonlySet<string>;
  maxUniqueVariants: number;
  maxObjectKeys: number;
  maxShapeLength: number;
  maxVisitedValues: number;
};

type FingerprintTraversalState = {
  inspectedUnits: number;
};

function integerAtLeast(
  value: number | undefined,
  fallback: number,
  minimum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return resolved;
}

function resolveFingerprintOptions(
  depthOrOptions: number | FingerprintShapeOptions,
): ResolvedFingerprintShapeOptions {
  const options = typeof depthOrOptions === "number" ? { depth: depthOrOptions } : depthOrOptions;
  const depth = options.depth ?? 3;
  if (!Number.isInteger(depth) || depth < 0) {
    throw new RangeError("depth must be a non-negative integer.");
  }
  const dictionaryPaths = new Set<string>();
  for (const path of options.dictionaryPaths ?? []) {
    if (typeof path !== "string" || !path.startsWith("$") || path.length < 2) {
      throw new TypeError("dictionaryPaths must contain rooted paths such as $.mapping.");
    }
    dictionaryPaths.add(path);
  }
  return {
    depth,
    dictionaryPaths,
    maxUniqueVariants: integerAtLeast(options.maxUniqueVariants, 32, 1, "maxUniqueVariants"),
    maxObjectKeys: integerAtLeast(options.maxObjectKeys, 128, 1, "maxObjectKeys"),
    maxShapeLength: integerAtLeast(options.maxShapeLength, 65_536, 32, "maxShapeLength"),
    maxVisitedValues: integerAtLeast(options.maxVisitedValues, 1_000_000, 1, "maxVisitedValues"),
  };
}

function addBoundedVariant(
  variants: Set<string>,
  candidate: string,
  limit: number,
): boolean {
  if (variants.has(candidate)) return false;
  if (variants.size < limit) {
    variants.add(candidate);
    return false;
  }
  let largest: string | null = null;
  for (const current of variants) {
    if (largest === null || current > largest) largest = current;
  }
  if (largest !== null && candidate < largest) {
    variants.delete(largest);
    variants.add(candidate);
  }
  return true;
}

function serializeVariants(variants: ReadonlySet<string>, overflow: boolean): string {
  const sorted = [...variants].sort();
  if (overflow) sorted.push("…");
  return sorted.join("|");
}

function inspectFingerprintUnit(
  state: FingerprintTraversalState,
  options: ResolvedFingerprintShapeOptions,
): void {
  state.inspectedUnits += 1;
  if (state.inspectedUnits > options.maxVisitedValues) {
    throw new RangeError(
      `Fingerprint traversal exceeded the ${options.maxVisitedValues} traversal-unit budget.`,
    );
  }
}

function forEachOwnEnumerableKey(
  value: Record<string, unknown>,
  options: ResolvedFingerprintShapeOptions,
  state: FingerprintTraversalState,
  visit: (key: string) => void,
): void {
  for (const key in value) {
    // Charge every enumerated key before the ownership check. This also bounds
    // adversarial inherited enumerable properties without allocating Object.keys().
    inspectFingerprintUnit(state, options);
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    visit(key);
  }
}

function describeShape(
  value: unknown,
  path: string,
  depth: number,
  options: ResolvedFingerprintShapeOptions,
  ancestors: WeakSet<object>,
  state: FingerprintTraversalState,
): string {
  inspectFingerprintUnit(state, options);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (depth <= 0) return "array";
    if (ancestors.has(value)) return "circular";
    ancestors.add(value);
    try {
      const variants = new Set<string>();
      let overflow = false;
      for (const item of value) {
        overflow =
          addBoundedVariant(
            variants,
            describeShape(item, `${path}[]`, depth - 1, options, ancestors, state),
            options.maxUniqueVariants,
          ) || overflow;
      }
      return variants.size === 0
        ? "array"
        : `array<${serializeVariants(variants, overflow)}>`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isRecord(value)) return typeof value;
  if (depth <= 0) return options.dictionaryPaths.has(path) ? "dict" : "object";
  if (ancestors.has(value)) return "circular";
  ancestors.add(value);
  try {
    if (options.dictionaryPaths.has(path)) {
      const variants = new Set<string>();
      let overflow = false;
      forEachOwnEnumerableKey(value, options, state, (key) => {
        overflow =
          addBoundedVariant(
            variants,
            describeShape(value[key], `${path}.*`, depth - 1, options, ancestors, state),
            options.maxUniqueVariants,
          ) || overflow;
      });
      return variants.size === 0
        ? "dict"
        : `dict<${serializeVariants(variants, overflow)}>`;
    }

    const retainedKeys = new Set<string>();
    let overflow = false;
    forEachOwnEnumerableKey(value, options, state, (key) => {
      overflow = addBoundedVariant(retainedKeys, key, options.maxObjectKeys) || overflow;
    });
    const fields = [...retainedKeys]
      .sort()
      .map(
        (key) =>
          `${key}:${describeShape(value[key], `${path}.${key}`, depth - 1, options, ancestors, state)}`,
      );
    if (overflow) fields.push("…");
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundedShape(canonical: string, maxShapeLength: number): string {
  if (canonical.length <= maxShapeLength) return canonical;
  const marker = `<truncated:${fnv1a(canonical)}>`;
  const prefixLength = Math.max(0, maxShapeLength - marker.length);
  return `${canonical.slice(0, prefixLength)}${marker}`;
}

export function fingerprintShape(
  adapter: string,
  adapterVersion: string,
  input: unknown,
  depthOrOptions: number | FingerprintShapeOptions = 3,
): StructuralFingerprint {
  const options = resolveFingerprintOptions(depthOrOptions);
  const canonical = describeShape(
    input,
    "$",
    options.depth,
    options,
    new WeakSet<object>(),
    { inspectedUnits: 0 },
  );
  return {
    adapter,
    adapterVersion,
    shape: boundedShape(canonical, options.maxShapeLength),
    hash: fnv1a(canonical),
  };
}
