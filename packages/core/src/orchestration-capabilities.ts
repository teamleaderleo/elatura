// SPDX-License-Identifier: MPL-2.0
import type {
  AdapterCapabilities,
  AdapterCapability,
  AdapterCapabilitySupport,
} from "./adapter-contract.js";
import type { PassThroughReasonCode } from "./orchestration-model.js";

const CAPABILITY_KEYS: readonly AdapterCapability[] = [
  "plan",
  "materialize",
  "validateOutput",
  "branches",
  "paging",
  "cache",
  "submission",
  "alternateRepresentation",
];

const PIPELINE_STAGE_CAPABILITIES: readonly AdapterCapability[] = [
  "plan",
  "materialize",
  "validateOutput",
];

const SUPPORT_LEVELS: readonly AdapterCapabilitySupport[] = [
  "unsupported",
  "synthetic-only",
  "supported",
];

export type PipelineCapabilityCapture =
  | Readonly<{ ok: true; capabilities: AdapterCapabilities }>
  | Readonly<{
      ok: false;
      reasonCode: Extract<
        PassThroughReasonCode,
        "configuration-invalid" | "adapter-capability-rejected"
      >;
    }>;

function dataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function supportLevel(value: unknown): AdapterCapabilitySupport | null {
  return typeof value === "string" && (SUPPORT_LEVELS as readonly string[]).includes(value)
    ? (value as AdapterCapabilitySupport)
    : null;
}

function captureCapabilities(value: unknown): AdapterCapabilities | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "capabilities");
  if (!descriptor || !("value" in descriptor)) return null;

  const candidate = descriptor.value;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const ownKeys = Reflect.ownKeys(candidate);
  if (
    ownKeys.length !== CAPABILITY_KEYS.length ||
    ownKeys.some((key) => typeof key !== "string" || !(CAPABILITY_KEYS as readonly string[]).includes(key))
  ) {
    return null;
  }

  const captured = Object.create(null) as Record<AdapterCapability, AdapterCapabilitySupport>;
  for (const capability of CAPABILITY_KEYS) {
    const capabilityDescriptor = Object.getOwnPropertyDescriptor(candidate, capability);
    if (!capabilityDescriptor || !capabilityDescriptor.enumerable || !("value" in capabilityDescriptor)) {
      return null;
    }
    const support = supportLevel(capabilityDescriptor.value);
    if (!support) return null;
    captured[capability] = support;
  }
  return Object.freeze(captured) as AdapterCapabilities;
}

export function capturePipelineCapabilities(
  adapter: unknown,
  syntheticContext: unknown,
): PipelineCapabilityCapture {
  if (syntheticContext !== undefined && typeof syntheticContext !== "boolean") {
    return Object.freeze({ ok: false, reasonCode: "configuration-invalid" });
  }

  const capabilities = captureCapabilities(adapter);
  if (!capabilities) {
    return Object.freeze({ ok: false, reasonCode: "configuration-invalid" });
  }

  const synthetic = syntheticContext === true;
  for (const capability of PIPELINE_STAGE_CAPABILITIES) {
    const support = capabilities[capability];
    if (support === "unsupported" || (support === "synthetic-only" && !synthetic)) {
      return Object.freeze({ ok: false, reasonCode: "adapter-capability-rejected" });
    }
  }

  return Object.freeze({ ok: true, capabilities });
}
