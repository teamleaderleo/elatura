// SPDX-License-Identifier: MPL-2.0

export const TRANSFORM_SAFETY_SCHEMA_VERSION = 1 as const;

const MAX_IDENTITY_LENGTH = 128;
const ADAPTER_ID = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u;
const ADAPTER_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u;

export type AdapterIdentity = {
  id: string;
  version: string;
};

export type TransformSafetyReason = "build-default" | "user-emergency-disable";

export type TransformSafetyState = {
  schemaVersion: typeof TRANSFORM_SAFETY_SCHEMA_VERSION;
  emergencyDisabled: true;
  reason: TransformSafetyReason;
  generation: number;
  volatileClearCount: number;
  volatileClearFailureCount: number;
  denylistEntryCount: number;
};

export type TransformPermissionReason =
  | "emergency-disabled"
  | "local-opt-in-required"
  | "adapter-denylisted";

export type TransformPermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: TransformPermissionReason };

export type TransformSafetyController = {
  getState(): TransformSafetyState;
  emergencyDisable(): TransformSafetyState;
  evaluate(identity: AdapterIdentity, explicitLocalOptIn: boolean): TransformPermissionDecision;
};

function validIdentity(identity: AdapterIdentity): boolean {
  return (
    identity.id.length <= MAX_IDENTITY_LENGTH &&
    identity.version.length <= MAX_IDENTITY_LENGTH &&
    ADAPTER_ID.test(identity.id) &&
    ADAPTER_VERSION.test(identity.version)
  );
}

function canonicalIdentity(identity: AdapterIdentity): string {
  if (!validIdentity(identity)) throw new TypeError("Adapter identity must use bounded local tokens.");
  return `${identity.id}\u0000${identity.version}`;
}

export function normalizeAdapterDenylist(
  entries: readonly AdapterIdentity[],
): readonly AdapterIdentity[] {
  const normalized = new Map<string, AdapterIdentity>();
  for (const entry of entries) {
    const key = canonicalIdentity(entry);
    if (normalized.has(key)) throw new TypeError("Adapter denylist entries must be unique.");
    normalized.set(key, { id: entry.id, version: entry.version });
  }
  return Object.freeze(
    [...normalized.values()]
      .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version))
      .map((entry) => Object.freeze(entry)),
  );
}

export function isAdapterDenied(
  identity: AdapterIdentity,
  denylist: readonly AdapterIdentity[],
): boolean {
  const target = canonicalIdentity(identity);
  return denylist.some((entry) => canonicalIdentity(entry) === target);
}

export function evaluateTransformPermission(input: {
  emergencyDisabled: boolean;
  explicitLocalOptIn: boolean;
  identity: AdapterIdentity;
  denylist: readonly AdapterIdentity[];
}): TransformPermissionDecision {
  if (input.emergencyDisabled) return { allowed: false, reason: "emergency-disabled" };
  if (!input.explicitLocalOptIn) return { allowed: false, reason: "local-opt-in-required" };
  if (isAdapterDenied(input.identity, input.denylist)) {
    return { allowed: false, reason: "adapter-denylisted" };
  }
  return { allowed: true };
}

export const BUNDLED_ADAPTER_DENYLIST: readonly AdapterIdentity[] = normalizeAdapterDenylist([]);

export function createTransformSafetyController(options: {
  denylist?: readonly AdapterIdentity[];
  clearVolatileTransformState: () => void;
}): TransformSafetyController {
  const denylist = normalizeAdapterDenylist(options.denylist ?? BUNDLED_ADAPTER_DENYLIST);
  let state: TransformSafetyState = {
    schemaVersion: TRANSFORM_SAFETY_SCHEMA_VERSION,
    emergencyDisabled: true,
    reason: "build-default",
    generation: 0,
    volatileClearCount: 0,
    volatileClearFailureCount: 0,
    denylistEntryCount: denylist.length,
  };

  return {
    getState() {
      return { ...state };
    },
    emergencyDisable() {
      let failed = false;
      try {
        options.clearVolatileTransformState();
      } catch {
        failed = true;
      }
      state = {
        ...state,
        emergencyDisabled: true,
        reason: "user-emergency-disable",
        generation: state.generation + 1,
        volatileClearCount: state.volatileClearCount + 1,
        volatileClearFailureCount: state.volatileClearFailureCount + (failed ? 1 : 0),
      };
      return { ...state };
    },
    evaluate(identity, explicitLocalOptIn) {
      return evaluateTransformPermission({
        emergencyDisabled: state.emergencyDisabled,
        explicitLocalOptIn,
        identity,
        denylist,
      });
    },
  };
}
