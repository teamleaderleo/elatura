// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import {
  isCompanionEntryId,
  isCompanionToken,
  resolveCompanionWorkingSetPolicy,
  type CompanionResponseEnvelope,
} from "./companion-protocol.js";
import {
  SyntheticCompanion as UncheckedSyntheticCompanion,
  type SyntheticCompanionConversationInput,
  type SyntheticCompanionDispatchOptions,
  type SyntheticCompanionOptions,
} from "./companion-runtime.js";
import { validateAndMeasureReadOnlyRepresentation } from "./representation.js";

const ADAPTER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_COMPANION_REFERENCE_CODE_UNITS = 4_096;

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && !descriptor.get && !descriptor.set
    ? descriptor.value
    : undefined;
}

function copyAdapterIdentity(value: unknown): AdapterIdentity | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Object.keys(value);
    if (keys.length !== 2 || !keys.includes("id") || !keys.includes("version")) return null;
    const id = dataProperty(value, "id");
    const version = dataProperty(value, "version");
    return (
      typeof id === "string" &&
      ADAPTER_TOKEN.test(id) &&
      typeof version === "string" &&
      ADAPTER_TOKEN.test(version)
    )
      ? { id, version }
      : null;
  } catch {
    return null;
  }
}

function copyAdapterIdentities(value: unknown): readonly AdapterIdentity[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const copied: AdapterIdentity[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
        return null;
      }
      const identity = copyAdapterIdentity(descriptor.value);
      if (!identity) return null;
      copied.push(identity);
    }
    return Object.freeze(copied);
  } catch {
    return null;
  }
}

function copyConversationInput(value: unknown): SyntheticCompanionConversationInput | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Object.keys(value);
    if (keys.length !== 2 || !keys.includes("id") || !keys.includes("representation")) {
      return null;
    }
    const id = dataProperty(value, "id");
    const representation = dataProperty(value, "representation");
    return isCompanionToken(id) && representation !== undefined
      ? { id, representation }
      : null;
  } catch {
    return null;
  }
}

function copyConversationInputs(
  value: unknown,
): readonly SyntheticCompanionConversationInput[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const copied: SyntheticCompanionConversationInput[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
        return null;
      }
      const conversation = copyConversationInput(descriptor.value);
      if (!conversation) return null;
      copied.push(conversation);
    }
    return Object.freeze(copied);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Public synthetic companion entrypoint.
 *
 * Valid representations must carry explicit synthetic provenance and entry ids
 * that the version-1 protocol can round-trip. Malformed fixtures still reach
 * the runtime so callers can exercise corrupt-source behaviour without
 * creating a private-content admission path.
 */
export class SyntheticCompanion extends UncheckedSyntheticCompanion {
  constructor(options: SyntheticCompanionOptions) {
    const policy = resolveCompanionWorkingSetPolicy(options.policy);
    const minimumResponseStringCodeUnits = Math.max(
      MAX_COMPANION_REFERENCE_CODE_UNITS,
      policy.maxPageEntryTextCodeUnits,
      policy.maxSnippetCodeUnits,
    );
    if (policy.maxCodeResponseCodeUnits < minimumResponseStringCodeUnits) {
      throw new RangeError(
        `maxCodeResponseCodeUnits must be at least ${minimumResponseStringCodeUnits} for serializable companion responses.`,
      );
    }
    const acceptedAdapters = options.acceptedAdapters === undefined
      ? undefined
      : copyAdapterIdentities(options.acceptedAdapters);
    if (options.acceptedAdapters !== undefined && !acceptedAdapters) {
      throw new TypeError("acceptedAdapters must contain bounded adapter identities.");
    }
    const conversations = copyConversationInputs(options.conversations);
    if (!conversations) {
      throw new TypeError("conversations must contain bounded local source records.");
    }

    for (const input of conversations) {
      const validated = validateAndMeasureReadOnlyRepresentation(input.representation);
      if (validated.ok) {
        if (validated.value.representation.provenance.synthetic !== true) {
          throw new TypeError("SyntheticCompanion accepts synthetic provenance only.");
        }
        if (
          validated.value.representation.entries.some(
            (entry) => !isCompanionEntryId(entry.id),
          )
        ) {
          throw new TypeError(
            "SyntheticCompanion requires version-1-compatible entry identifiers.",
          );
        }
      }
    }
    super({
      ...options,
      ...(acceptedAdapters ? { acceptedAdapters } : {}),
      policy,
      conversations,
    });
  }

  override updateAcceptedAdapters(identities: readonly AdapterIdentity[]): void {
    const copied = copyAdapterIdentities(identities);
    if (!copied) {
      throw new TypeError("acceptedAdapters must contain bounded adapter identities.");
    }
    super.updateAcceptedAdapters(copied);
  }

  override async dispatch(
    input: unknown,
    options: SyntheticCompanionDispatchOptions = {},
  ): Promise<CompanionResponseEnvelope> {
    const response = await super.dispatch(input, options);
    const settled = response.errorCode === "request-cancelled"
      ? { ...response, usage: this.usage }
      : response;
    const normalized =
      settled.ok &&
      settled.operation === "status" &&
      isRecord(settled.payload)
        ? {
            ...settled,
            payload: { ...settled.payload, usage: settled.usage },
          }
        : settled;
    return structuredClone(normalized);
  }
}
