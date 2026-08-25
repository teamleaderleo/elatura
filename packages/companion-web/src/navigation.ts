// SPDX-License-Identifier: MPL-2.0

/**
 * Bounded parent/child/active-path navigation state for the replacement-based
 * browser view. Records carry protocol identifiers and counts only; they are
 * extracted defensively from validated navigate payloads with fixed caps so a
 * hostile or drifted reply cannot inflate retained view state.
 */
export type CompanionNavigationRecord = Readonly<{
  conversationId: string;
  entryId: string;
  parentId: string | null;
  childIds: readonly string[];
  childCount: number;
  siblingIds: readonly string[];
  siblingCount: number;
  activePath: readonly string[];
  jumpBackReference: string | null;
}>;

const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;

export const MAX_NAVIGATION_REFERENCE_CODE_UNITS = 4_096;

function boundedId(value: unknown): string | null {
  return typeof value === "string" && ID_TOKEN.test(value) ? value : null;
}

function boundedToken(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value)
    ? value
    : null;
}

function boundedIdList(
  value: unknown,
  cap: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > cap) return null;
  const copied: string[] = [];
  for (const candidate of value) {
    const id = boundedId(candidate);
    if (id === null) return null;
    copied.push(id);
  }
  return copied;
}

function boundedReference(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NAVIGATION_REFERENCE_CODE_UNITS
    ? value
    : null;
}

const NAVIGATION_PAYLOAD_KEYS = [
  "conversationId",
  "generation",
  "entryId",
  "parentId",
  "childIds",
  "childCount",
  "siblingIds",
  "siblingCount",
  "activePath",
  "jumpBackReference",
] as const;

/**
 * Returns null for any payload that does not exactly match the navigate shape,
 * including unknown fields or child/active-path lists beyond the configured
 * cap.
 */
export function extractNavigationRecord(
  payload: unknown,
  maxRelationshipIds: number,
): CompanionNavigationRecord | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(NAVIGATION_PAYLOAD_KEYS as readonly string[]).includes(key)) return null;
  }
  if (
    typeof record.generation !== "number" ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 0
  ) {
    return null;
  }
  const conversationId = boundedToken(record.conversationId);
  const entryId = boundedId(record.entryId);
  if (conversationId === null || entryId === null) return null;
  const parentId =
    record.parentId === null ? null : boundedId(record.parentId);
  if (record.parentId !== null && parentId === null) return null;
  const childIds = boundedIdList(record.childIds, maxRelationshipIds);
  if (childIds === null) return null;
  const siblingIds = boundedIdList(record.siblingIds, maxRelationshipIds);
  if (siblingIds === null) return null;
  const activePath = boundedIdList(record.activePath, maxRelationshipIds);
  if (activePath === null) return null;
  const childCount = record.childCount;
  const siblingCount = record.siblingCount;
  if (
    typeof childCount !== "number" ||
    !Number.isSafeInteger(childCount) ||
    childCount < childIds.length ||
    typeof siblingCount !== "number" ||
    !Number.isSafeInteger(siblingCount) ||
    siblingCount < siblingIds.length
  ) {
    return null;
  }
  const jumpBackReference =
    record.jumpBackReference === null || record.jumpBackReference === undefined
      ? null
      : boundedReference(record.jumpBackReference);
  if (
    record.jumpBackReference !== null &&
    record.jumpBackReference !== undefined &&
    jumpBackReference === null
  ) {
    return null;
  }
  return Object.freeze({
    conversationId,
    entryId,
    parentId,
    childIds: Object.freeze(childIds),
    childCount,
    siblingIds: Object.freeze(siblingIds),
    siblingCount,
    activePath: Object.freeze(activePath),
    jumpBackReference,
  });
}
