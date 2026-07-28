// SPDX-License-Identifier: MPL-2.0
import type { StructuralFingerprint, ValidationResult } from "./index.js";

export type AdapterCapabilitySupport = "unsupported" | "synthetic-only" | "supported";

export type AdapterCapability =
  | "plan"
  | "materialize"
  | "validateOutput"
  | "branches"
  | "paging"
  | "cache"
  | "submission"
  | "alternateRepresentation";

export type AdapterCapabilities = Readonly<Record<AdapterCapability, AdapterCapabilitySupport>>;

const UNSUPPORTED_CAPABILITIES: AdapterCapabilities = Object.freeze({
  plan: "unsupported",
  materialize: "unsupported",
  validateOutput: "unsupported",
  branches: "unsupported",
  paging: "unsupported",
  cache: "unsupported",
  submission: "unsupported",
  alternateRepresentation: "unsupported",
});

export function defineAdapterCapabilities(
  capabilities: Partial<AdapterCapabilities> = {},
): AdapterCapabilities {
  return Object.freeze({ ...UNSUPPORTED_CAPABILITIES, ...capabilities });
}

export type AdapterIdentity = {
  id: string;
  version: string;
};

export interface ApplicationAdapter<
  TSource,
  TPlan = never,
  TOutput = never,
  TPlanOptions = never,
  TAlternateRepresentation = never,
  TAlternateOptions = never,
> extends AdapterIdentity {
  readonly capabilities: AdapterCapabilities;
  detect(input: unknown): boolean;
  validate(input: unknown): ValidationResult<TSource>;
  fingerprint(source: TSource): StructuralFingerprint;
  plan?: (source: TSource, options: TPlanOptions) => ValidationResult<TPlan>;
  materialize?: (source: TSource, plan: TPlan) => ValidationResult<TOutput>;
  validateOutput?: (output: unknown) => ValidationResult<TOutput>;
  alternateRepresentation?: (
    source: TSource,
    options: TAlternateOptions,
  ) => ValidationResult<TAlternateRepresentation>;
}

export type AdapterVersionPolicy = {
  adapterId: string;
  currentVersion: string;
  readableVersions?: readonly string[];
};

export type AdapterVersionCompatibility =
  | { compatible: true; mode: "exact" | "declared-compatible" }
  | {
      compatible: false;
      reason: "adapter-id-mismatch" | "adapter-version-incompatible";
    };

export function assessAdapterVersionCompatibility(
  cached: AdapterIdentity,
  policy: AdapterVersionPolicy,
): AdapterVersionCompatibility {
  if (cached.id !== policy.adapterId) {
    return { compatible: false, reason: "adapter-id-mismatch" };
  }
  if (cached.version === policy.currentVersion) {
    return { compatible: true, mode: "exact" };
  }
  const readableVersions = new Set(policy.readableVersions ?? []);
  return readableVersions.has(cached.version)
    ? { compatible: true, mode: "declared-compatible" }
    : { compatible: false, reason: "adapter-version-incompatible" };
}

export function adapterCapabilityEnabled(
  capabilities: AdapterCapabilities,
  capability: AdapterCapability,
  synthetic: boolean,
): boolean {
  const support = capabilities[capability];
  return support === "supported" || (support === "synthetic-only" && synthetic);
}
