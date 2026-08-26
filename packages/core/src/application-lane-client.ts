// SPDX-License-Identifier: MPL-2.0
import {
  parseApplicationLaneRequestV1,
  parseApplicationLaneResponseV1,
  type ApplicationLaneObservationBudgetV1,
  type ApplicationLaneOperation,
  type ApplicationLaneRequestV1,
  type ApplicationLaneResponseV1,
} from "./application-lane.js";
import { measureBoundedJson } from "./resource-accounting.js";

export const applicationLaneResponseMatchReasons = [
  "matched",
  "request_id_mismatch",
  "lane_ref_mismatch",
  "lane_generation_mismatch",
  "operation_mismatch",
  "observation_budget_exceeded",
] as const;
export type ApplicationLaneResponseMatchReason =
  (typeof applicationLaneResponseMatchReasons)[number];

export type ApplicationLaneResponseMatchDecisionV1 = Readonly<{
  version: 1;
  matched: boolean;
  reason: ApplicationLaneResponseMatchReason;
  requestId: string;
  laneRef: string;
  laneGeneration: number;
  operation: ApplicationLaneOperation;
  response: ApplicationLaneResponseV1 | null;
}>;

/**
 * Bind one parsed application-lane response to the exact request that owns it.
 *
 * The application-lane protocol deliberately keeps browser/runtime handles out
 * of its envelopes, so request identity + durable lane generation + operation
 * are the complete generic correlation fence available to a consumer.
 *
 * For bounded observations this function also re-measures returned JSON against
 * the caller's requested aggregate text and serialized-byte budgets. `maxItems`
 * remains an adapter/content-type semantic limit because the generic protocol
 * cannot infer what one provider-specific observation considers an item.
 *
 * A mismatch returns `response: null` so callers cannot accidentally consume a
 * parsed but stale/wrong-lane result. This function performs no application or
 * browser action and grants no work authority.
 */
export function matchApplicationLaneResponseV1(
  rawRequest: unknown,
  rawResponse: unknown,
): ApplicationLaneResponseMatchDecisionV1 {
  const request = parseApplicationLaneRequestV1(rawRequest);
  const response = parseApplicationLaneResponseV1(rawResponse);

  let reason: ApplicationLaneResponseMatchReason = "matched";
  if (response.requestId !== request.requestId) {
    reason = "request_id_mismatch";
  } else if (response.laneRef !== request.laneRef) {
    reason = "lane_ref_mismatch";
  } else if (response.laneGeneration !== request.laneGeneration) {
    reason = "lane_generation_mismatch";
  } else if (response.operation !== request.operation) {
    reason = "operation_mismatch";
  } else if (!observationFitsRequestedBudget(request, response)) {
    reason = "observation_budget_exceeded";
  }

  return Object.freeze({
    version: 1 as const,
    matched: reason === "matched",
    reason,
    requestId: request.requestId,
    laneRef: request.laneRef,
    laneGeneration: request.laneGeneration,
    operation: request.operation,
    response: reason === "matched" ? response : null,
  });
}

function observationFitsRequestedBudget(
  request: ApplicationLaneRequestV1,
  response: ApplicationLaneResponseV1,
): boolean {
  if (request.operation !== "observe" || response.outcome !== "ok") return true;
  const payload = response.payload;
  if (!isObservationPayload(payload)) return false;
  const budget = request.payload as ApplicationLaneObservationBudgetV1;
  const measured = measureBoundedJson(payload.content, {
    maxDepth: 32,
    maxNodes: 10_000,
    maxStringCodeUnits: budget.maxTextCodeUnits,
    maxSerializedBytes: budget.maxSerializedBytes,
  });
  return measured.ok
    && measured.value.stringCodeUnits <= budget.maxTextCodeUnits
    && measured.value.serializedBytes <= budget.maxSerializedBytes;
}

function isObservationPayload(
  value: ApplicationLaneResponseV1["payload"],
): value is Extract<NonNullable<ApplicationLaneResponseV1["payload"]>, { observationRef: string }> {
  return Boolean(
    value
    && typeof value === "object"
    && "observationRef" in value
    && "content" in value,
  );
}
