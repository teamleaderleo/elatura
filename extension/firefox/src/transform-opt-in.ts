// SPDX-License-Identifier: MPL-2.0

export const TRANSFORM_OPT_IN_SCHEMA_VERSION = 1 as const;
export const TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS = [
  "session-local-only",
  "future-transform-risk",
  "emergency-disable-available",
] as const;

export type TransformOptInAcknowledgement =
  (typeof TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS)[number];
export type TransformOptInReason =
  | "build-default"
  | "user-recorded"
  | "user-revoked"
  | "emergency-disable";

export type TransformOptInState = {
  schemaVersion: typeof TRANSFORM_OPT_IN_SCHEMA_VERSION;
  recorded: boolean;
  reason: TransformOptInReason;
  generation: number;
  acknowledgementCount: number;
  // Runtime-message consumers validate this defensively. Every local constructor
  // and repository gate below still requires the value to remain false.
  authorizesTransform: boolean;
};

export type TransformOptInController = {
  getState(): TransformOptInState;
  record(acknowledgements: unknown): TransformOptInState;
  revoke(reason: "user-revoked" | "emergency-disable"): TransformOptInState;
};

function hasExactAcknowledgements(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS.length) {
    return false;
  }
  const seen = new Set<unknown>(value);
  return (
    seen.size === TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS.length &&
    TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS.every((acknowledgement) => seen.has(acknowledgement))
  );
}

export function createTransformOptInController(): TransformOptInController {
  let state: TransformOptInState = {
    schemaVersion: TRANSFORM_OPT_IN_SCHEMA_VERSION,
    recorded: false,
    reason: "build-default",
    generation: 0,
    acknowledgementCount: 0,
    authorizesTransform: false,
  };

  return {
    getState() {
      return { ...state };
    },
    record(acknowledgements) {
      if (!hasExactAcknowledgements(acknowledgements)) {
        throw new TypeError("Transform opt-in requires the exact fixed acknowledgement set.");
      }
      state = {
        ...state,
        recorded: true,
        reason: "user-recorded",
        generation: state.generation + 1,
        acknowledgementCount: TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS.length,
        authorizesTransform: false,
      };
      return { ...state };
    },
    revoke(reason) {
      state = {
        ...state,
        recorded: false,
        reason,
        generation: state.generation + 1,
        acknowledgementCount: 0,
        authorizesTransform: false,
      };
      return { ...state };
    },
  };
}
