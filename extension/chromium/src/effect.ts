// SPDX-License-Identifier: MPL-2.0
import type { BoundChromiumResidencyPlanV1 } from "./binding.js";
import type { ChromiumProjection } from "./projection.js";

export const CHROMIUM_EFFECT_PROTOCOL_VERSION = 1 as const;

export const chromiumExecutableResidencyEffects = ["keep_warm", "discard"] as const;
export type ChromiumExecutableResidencyEffect =
  (typeof chromiumExecutableResidencyEffects)[number];

export type ChromiumEffectRequestV1 = Readonly<{
  version: typeof CHROMIUM_EFFECT_PROTOCOL_VERSION;
  requestRef: string;
  projectionRef: string;
  tabId: number;
  effect: ChromiumExecutableResidencyEffect;
}>;

export type ChromiumEffectProjectionV1 = Readonly<{
  projectionRef: string;
  tabId: number;
  browserResidency: "foreground" | "background" | "frozen" | "discarded" | "reloading";
  autoDiscardable: boolean;
}>;

export const chromiumEffectOutcomes = [
  "applied",
  "refused",
  "stale_projection",
  "browser_error",
] as const;
export type ChromiumEffectOutcome = (typeof chromiumEffectOutcomes)[number];

export const chromiumEffectReasons = [
  "effect_applied",
  "browser_preflight_refused",
  "browser_unavailable",
  "projection_mismatch",
  "operation_failed",
] as const;
export type ChromiumEffectReason = (typeof chromiumEffectReasons)[number];

export type ChromiumEffectReceiptV1 = Readonly<{
  version: typeof CHROMIUM_EFFECT_PROTOCOL_VERSION;
  requestRef: string;
  projectionRef: string;
  tabId: number;
  effect: ChromiumExecutableResidencyEffect;
  outcome: ChromiumEffectOutcome;
  reason: ChromiumEffectReason;
  projection: ChromiumEffectProjectionV1 | null;
}>;

export type ChromiumEffectReceiptMatchV1 = Readonly<{
  matched: boolean;
  reason: "matched" | "request_mismatch";
}>;

const EFFECT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RESIDENCIES = [
  "foreground",
  "background",
  "frozen",
  "discarded",
  "reloading",
] as const;

/**
 * Derive one browser-local effect request from an already generation-bound,
 * exactly matched lane/projection plan and the current private projection.
 * Durable lane identity intentionally disappears at this boundary; the caller
 * retains the plan and correlates the browser receipt through requestRef.
 */
export function createChromiumEffectRequestV1(
  plan: BoundChromiumResidencyPlanV1,
  projection: ChromiumProjection,
  requestRefInput: unknown,
): ChromiumEffectRequestV1 | null {
  const requestRef = boundedToken(requestRefInput, "Chromium effect request reference");
  if (
    !plan.binding.matched ||
    plan.decision === null ||
    plan.projectionRef !== projection.projectionRef ||
    !chromiumExecutableResidencyEffects.includes(
      plan.effect as ChromiumExecutableResidencyEffect,
    )
  ) {
    return null;
  }
  return Object.freeze({
    version: CHROMIUM_EFFECT_PROTOCOL_VERSION,
    requestRef,
    projectionRef: boundedToken(plan.projectionRef, "Chromium projection reference"),
    tabId: safeInteger(projection.tabId, "Chromium effect tab id"),
    effect: plan.effect as ChromiumExecutableResidencyEffect,
  });
}

/** Parse an untrusted browser-local effect request without invoking accessors. */
export function parseChromiumEffectRequestV1(value: unknown): ChromiumEffectRequestV1 {
  const input = ownDataRecord(value, "Chromium effect request", [
    "version",
    "requestRef",
    "projectionRef",
    "tabId",
    "effect",
  ]);
  if (input.version !== CHROMIUM_EFFECT_PROTOCOL_VERSION) {
    throw new TypeError("Chromium effect request version is invalid");
  }
  return Object.freeze({
    version: CHROMIUM_EFFECT_PROTOCOL_VERSION,
    requestRef: boundedToken(input.requestRef, "Chromium effect request reference"),
    projectionRef: boundedToken(input.projectionRef, "Chromium projection reference"),
    tabId: safeInteger(input.tabId, "Chromium effect tab id"),
    effect: exactEnum(
      input.effect,
      chromiumExecutableResidencyEffects,
      "Chromium residency effect",
    ),
  });
}

/** Browser effect execution must revalidate this exact projection immediately before acting. */
export function projectionMatchesChromiumEffectRequestV1(
  request: ChromiumEffectRequestV1,
  projection: Pick<ChromiumProjection, "projectionRef" | "tabId">,
): boolean {
  return (
    request.projectionRef === projection.projectionRef &&
    request.tabId === projection.tabId
  );
}

export function toChromiumEffectProjectionV1(
  projection: ChromiumProjection,
): ChromiumEffectProjectionV1 {
  return Object.freeze({
    projectionRef: boundedToken(projection.projectionRef, "Chromium projection reference"),
    tabId: safeInteger(projection.tabId, "Chromium effect tab id"),
    browserResidency: exactEnum(
      projection.browserResidency,
      RESIDENCIES,
      "Chromium browser residency",
    ),
    autoDiscardable: booleanValue(
      projection.autoDiscardable,
      "Chromium auto-discardable state",
    ),
  });
}

export function createChromiumEffectReceiptV1(
  request: ChromiumEffectRequestV1,
  outcomeInput: ChromiumEffectOutcome,
  reasonInput: ChromiumEffectReason,
  projectionInput: ChromiumProjection | ChromiumEffectProjectionV1 | null,
): ChromiumEffectReceiptV1 {
  const outcome = exactEnum(
    outcomeInput,
    chromiumEffectOutcomes,
    "Chromium effect outcome",
  );
  const reason = exactEnum(
    reasonInput,
    chromiumEffectReasons,
    "Chromium effect reason",
  );
  const projection = projectionInput === null
    ? null
    : "audioState" in projectionInput
      ? toChromiumEffectProjectionV1(projectionInput as ChromiumProjection)
      : parseChromiumEffectProjectionV1(projectionInput);
  if (
    outcome === "applied" &&
    (projection === null || !projectionMatchesChromiumEffectRequestV1(request, projection))
  ) {
    throw new TypeError("Applied Chromium effect receipt requires the requested projection");
  }
  return Object.freeze({
    version: CHROMIUM_EFFECT_PROTOCOL_VERSION,
    requestRef: request.requestRef,
    projectionRef: request.projectionRef,
    tabId: request.tabId,
    effect: request.effect,
    outcome,
    reason,
    projection,
  });
}

export function parseChromiumEffectReceiptV1(value: unknown): ChromiumEffectReceiptV1 {
  const input = ownDataRecord(value, "Chromium effect receipt", [
    "version",
    "requestRef",
    "projectionRef",
    "tabId",
    "effect",
    "outcome",
    "reason",
    "projection",
  ]);
  if (input.version !== CHROMIUM_EFFECT_PROTOCOL_VERSION) {
    throw new TypeError("Chromium effect receipt version is invalid");
  }
  const request: ChromiumEffectRequestV1 = Object.freeze({
    version: CHROMIUM_EFFECT_PROTOCOL_VERSION,
    requestRef: boundedToken(input.requestRef, "Chromium effect request reference"),
    projectionRef: boundedToken(input.projectionRef, "Chromium projection reference"),
    tabId: safeInteger(input.tabId, "Chromium effect tab id"),
    effect: exactEnum(
      input.effect,
      chromiumExecutableResidencyEffects,
      "Chromium residency effect",
    ),
  });
  const outcome = exactEnum(
    input.outcome,
    chromiumEffectOutcomes,
    "Chromium effect outcome",
  );
  const reason = exactEnum(
    input.reason,
    chromiumEffectReasons,
    "Chromium effect reason",
  );
  const projection = input.projection === null
    ? null
    : parseChromiumEffectProjectionV1(input.projection);
  if (
    outcome === "applied" &&
    (projection === null || !projectionMatchesChromiumEffectRequestV1(request, projection))
  ) {
    throw new TypeError("Applied Chromium effect receipt requires the requested projection");
  }
  return Object.freeze({
    ...request,
    outcome,
    reason,
    projection,
  });
}

export function matchChromiumEffectReceiptV1(
  request: ChromiumEffectRequestV1,
  receipt: ChromiumEffectReceiptV1,
): ChromiumEffectReceiptMatchV1 {
  const matched =
    receipt.version === request.version &&
    receipt.requestRef === request.requestRef &&
    receipt.projectionRef === request.projectionRef &&
    receipt.tabId === request.tabId &&
    receipt.effect === request.effect;
  return Object.freeze({
    matched,
    reason: matched ? "matched" : "request_mismatch",
  });
}

function parseChromiumEffectProjectionV1(value: unknown): ChromiumEffectProjectionV1 {
  const input = ownDataRecord(value, "Chromium effect projection", [
    "projectionRef",
    "tabId",
    "browserResidency",
    "autoDiscardable",
  ]);
  return Object.freeze({
    projectionRef: boundedToken(input.projectionRef, "Chromium projection reference"),
    tabId: safeInteger(input.tabId, "Chromium effect tab id"),
    browserResidency: exactEnum(
      input.browserResidency,
      RESIDENCIES,
      "Chromium browser residency",
    ),
    autoDiscardable: booleanValue(
      input.autoDiscardable,
      "Chromium auto-discardable state",
    ),
  });
}

function ownDataRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      throw new TypeError();
    }
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw new TypeError();
      }
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
}

function boundedToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !EFFECT_TOKEN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function exactEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Values[number];
}
