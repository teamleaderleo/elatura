// SPDX-License-Identifier: MPL-2.0

/**
 * Wire width of the zero-padded decimal segment in companion web request ids.
 */
export const COMPANION_REQUEST_ID_WIDTH = 6;

/**
 * Inclusive upper bound on request ordinals compatible with the six-digit
 * wire format: `10**6 - 1`. An ordinal above this bound would grow the id by
 * a whole byte, so envelope byte size would again depend on ordinal
 * magnitude; such requests are refused instead of emitted. The bound is
 * intrinsic to the wire format and is not configurable.
 */
export const COMPANION_REQUEST_ORDINAL_MAX = 10 ** COMPANION_REQUEST_ID_WIDTH - 1;

/**
 * Fixed content-free issue code carried by dispatch results refused at the
 * request-ordinal lifetime bound.
 */
export const COMPANION_REQUEST_ORDINAL_LIMIT_CODE = "request-ordinal-limit";

/**
 * Pure checked formatter for the stable `web-NNNNNN` request-id wire format.
 *
 * Returns the id only for whole ordinals from 1 through
 * `COMPANION_REQUEST_ORDINAL_MAX`. Outside that enforced lifetime bound it
 * returns null: callers must refuse rather than widen the width, wrap, or
 * reuse an id. Within the bound every id occupies exactly the same number of
 * bytes, so envelope byte size reflects content shape alone.
 */
export function formatCompanionRequestId(ordinal: number): string | null {
  if (!Number.isSafeInteger(ordinal)) return null;
  if (ordinal < 1 || ordinal > COMPANION_REQUEST_ORDINAL_MAX) return null;
  return `web-${String(ordinal).padStart(COMPANION_REQUEST_ID_WIDTH, "0")}`;
}

export type CompanionRequestIdGate =
  | Readonly<{ ok: true; requestId: string }>
  | Readonly<{ ok: false; code: typeof COMPANION_REQUEST_ORDINAL_LIMIT_CODE }>;

/**
 * Pure admission gate for the ordinal that follows `currentOrdinal`. The
 * controller must consult this before creating, registering, dispatching, or
 * emitting anything; a closed gate means no observable request occurs and no
 * instance state changes.
 */
export function nextCompanionRequestId(
  currentOrdinal: number,
): CompanionRequestIdGate {
  const requestId = formatCompanionRequestId(currentOrdinal + 1);
  if (requestId === null) {
    return { ok: false, code: COMPANION_REQUEST_ORDINAL_LIMIT_CODE };
  }
  return { ok: true, requestId };
}
