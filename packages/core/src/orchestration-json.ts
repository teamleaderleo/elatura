// SPDX-License-Identifier: MPL-2.0
import type { PipelineStageContext } from "./orchestration-model.js";

function arrayValues(value: readonly unknown[]): unknown[] {
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("Unsupported array shape.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptorKeys = Object.keys(descriptors);
  if (descriptorKeys.some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) {
    throw new TypeError("Unsupported array shape.");
  }
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Unsupported array shape.");
    }
    values.push(descriptor.value);
  }
  return values;
}

function objectEntries(value: object): Array<readonly [string, unknown]> {
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("Unsupported object shape.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.keys(descriptors).sort().map((key) => {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Unsupported object shape.");
    }
    return [key, descriptor.value] as const;
  });
}

export function cloneJsonLike(value: unknown, context: PipelineStageContext, depth = 0): unknown {
  context.checkpoint();
  context.consumeOperations();
  context.assertRecursionDepth(depth);
  if (value === null) {
    context.reserveAllocation(4);
    return null;
  }
  if (typeof value === "string") {
    context.reserveAllocation(value.length * 2);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Unsupported numeric value.");
    context.reserveAllocation(8);
    return value;
  }
  if (typeof value === "boolean") {
    context.reserveAllocation(4);
    return value;
  }
  if (Array.isArray(value)) {
    const values = arrayValues(value);
    context.reserveAllocation(24 + values.length * 8);
    return values.map((item) => cloneJsonLike(item, context, depth + 1));
  }
  if (typeof value !== "object") throw new TypeError("Unsupported value type.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Unsupported object type.");
  const clone: Record<string, unknown> = {};
  context.reserveAllocation(32);
  for (const [key, child] of objectEntries(value)) {
    context.consumeOperations();
    context.reserveAllocation(key.length * 2);
    clone[key] = cloneJsonLike(child, context, depth + 1);
  }
  return clone;
}

export function freezeJsonLike(value: unknown, context: PipelineStageContext, depth = 0): unknown {
  context.checkpoint();
  context.consumeOperations();
  context.assertRecursionDepth(depth);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const child of arrayValues(value)) freezeJsonLike(child, context, depth + 1);
    return Object.freeze(value);
  }
  if (typeof value !== "object") throw new TypeError("Unsupported value type.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Unsupported object type.");
  for (const [, child] of objectEntries(value)) freezeJsonLike(child, context, depth + 1);
  return Object.freeze(value);
}

export function equalJsonLike(
  left: unknown,
  right: unknown,
  context: PipelineStageContext,
  depth = 0,
): boolean {
  context.checkpoint();
  context.consumeOperations();
  context.assertRecursionDepth(depth);
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const leftValues = arrayValues(left);
    const rightValues = arrayValues(right);
    for (let index = 0; index < leftValues.length; index += 1) {
      if (!equalJsonLike(leftValues[index], rightValues[index], context, depth + 1)) return false;
    }
    return true;
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Object.getPrototypeOf(left) !== Object.prototype && Object.getPrototypeOf(left) !== null) return false;
  if (Object.getPrototypeOf(right) !== Object.prototype && Object.getPrototypeOf(right) !== null) return false;
  const leftEntries = objectEntries(left);
  const rightEntries = objectEntries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  for (let index = 0; index < leftEntries.length; index += 1) {
    const leftEntry = leftEntries[index];
    const rightEntry = rightEntries[index];
    if (!leftEntry || !rightEntry || leftEntry[0] !== rightEntry[0]) return false;
    if (!equalJsonLike(leftEntry[1], rightEntry[1], context, depth + 1)) return false;
  }
  return true;
}
