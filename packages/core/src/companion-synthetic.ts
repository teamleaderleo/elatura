// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import {
  isCompanionEntryId,
  isCompanionToken,
  resolveCompanionWorkingSetPolicy,
  type CompanionResponseEnvelope,
  type CompanionWorkingSetPolicy,
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
const POLICY_KEYS = [
  "maxResidentConversations",
  "maxResidentRecords",
  "maxResidentPagesPerConversation",
  "maxResidentSearchesPerConversation",
  "maxResidentEntries",
  "maxResidentTextCodeUnits",
  "maxResidentSerializedBytes",
  "maxResidentAccountedBytes",
  "maxPageEntries",
  "maxPageEntryTextCodeUnits",
  "maxPageTextCodeUnits",
  "maxPageSerializedBytes",
  "maxResponseSerializedBytes",
  "maxSearchResults",
  "maxSnippetCodeUnits",
  "maxSearchSerializedBytes",
  "maxIndexEntries",
  "maxIndexTextCodeUnits",
  "maxInFlightRequests",
  "maxQueuedPageRequests",
  "maxRelationshipIds",
  "maxCodeResponseCodeUnits",
  "maxResourceMetadataRecords",
  "maxRequestSerializedBytes",
  "sessionTtlMs",
] as const satisfies readonly (keyof CompanionWorkingSetPolicy)[];

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactOwnKeys(value: object, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowedSet.has(key),
  );
}

function dataDescriptor(value: object, key: string): PropertyDescriptor | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && !descriptor.get && !descriptor.set
    ? descriptor
    : null;
}

function dataProperty(value: object, key: string): unknown {
  return dataDescriptor(value, key)?.value;
}

function copyAdapterIdentity(value: unknown): AdapterIdentity | null {
  try {
    if (!plainRecord(value) || !exactOwnKeys(value, ["id", "version"])) return null;
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
      const descriptor = dataDescriptor(value, String(index));
      if (!descriptor) return null;
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
    if (!plainRecord(value) || !exactOwnKeys(value, ["id", "representation"])) {
      return null;
    }
    const id = dataProperty(value, "id");
    const representation = dataDescriptor(value, "representation");
    if (!isCompanionToken(id) || !representation) return null;
    return { id, representation: representation.value };
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
      const descriptor = dataDescriptor(value, String(index));
      if (!descriptor) return null;
      const conversation = copyConversationInput(descriptor.value);
      if (!conversation) return null;
      copied.push(conversation);
    }
    return Object.freeze(copied);
  } catch {
    return null;
  }
}

function copyPolicy(value: unknown): Partial<CompanionWorkingSetPolicy> | null {
  try {
    if (value === undefined) return Object.freeze({});
    if (!plainRecord(value) || !exactOwnKeys(value, POLICY_KEYS)) return null;
    const copied: Partial<CompanionWorkingSetPolicy> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = dataDescriptor(value, key);
      if (
        !descriptor ||
        typeof descriptor.value !== "number" ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 1
      ) {
        return null;
      }
      (copied as Record<string, number>)[key] = descriptor.value;
    }
    return Object.freeze(copied);
  } catch {
    return null;
  }
}

type NormalizedOptions = Readonly<{
  sessionId: string;
  conversations: readonly SyntheticCompanionConversationInput[];
  acceptedAdapters?: readonly AdapterIdentity[];
  policy: Partial<CompanionWorkingSetPolicy>;
  now?: () => number;
}>;

function copyOptions(value: unknown): NormalizedOptions | null {
  try {
    if (
      !plainRecord(value) ||
      !exactOwnKeys(value, [
        "sessionId",
        "conversations",
        "acceptedAdapters",
        "policy",
        "now",
      ])
    ) {
      return null;
    }
    const sessionId = dataProperty(value, "sessionId");
    const conversationsDescriptor = dataDescriptor(value, "conversations");
    if (!isCompanionToken(sessionId) || !conversationsDescriptor) return null;
    const conversations = copyConversationInputs(conversationsDescriptor.value);
    if (!conversations) return null;

    let acceptedAdapters: readonly AdapterIdentity[] | undefined;
    if (Object.prototype.hasOwnProperty.call(value, "acceptedAdapters")) {
      const descriptor = dataDescriptor(value, "acceptedAdapters");
      if (!descriptor) return null;
      if (descriptor.value !== undefined) {
        const copied = copyAdapterIdentities(descriptor.value);
        if (!copied) return null;
        acceptedAdapters = copied;
      }
    }

    let policyValue: unknown;
    if (Object.prototype.hasOwnProperty.call(value, "policy")) {
      const descriptor = dataDescriptor(value, "policy");
      if (!descriptor) return null;
      policyValue = descriptor.value;
    }
    const policy = copyPolicy(policyValue);
    if (!policy) return null;

    let now: (() => number) | undefined;
    if (Object.prototype.hasOwnProperty.call(value, "now")) {
      const descriptor = dataDescriptor(value, "now");
      if (!descriptor) return null;
      if (descriptor.value !== undefined) {
        if (typeof descriptor.value !== "function") return null;
        now = descriptor.value as () => number;
      }
    }

    return Object.freeze({
      sessionId,
      conversations,
      ...(acceptedAdapters ? { acceptedAdapters } : {}),
      policy,
      ...(now ? { now } : {}),
    });
  } catch {
    return null;
  }
}

function copyDispatchOptions(value: unknown): SyntheticCompanionDispatchOptions | null {
  try {
    if (!plainRecord(value) || !exactOwnKeys(value, ["beforeCommit"])) return null;
    if (!Object.prototype.hasOwnProperty.call(value, "beforeCommit")) {
      return Object.freeze({});
    }
    const descriptor = dataDescriptor(value, "beforeCommit");
    if (!descriptor) return null;
    if (descriptor.value === undefined) return Object.freeze({});
    return typeof descriptor.value === "function"
      ? Object.freeze({ beforeCommit: descriptor.value as () => Promise<void> })
      : null;
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
    const normalized = copyOptions(options);
    if (!normalized) {
      throw new TypeError("SyntheticCompanion options must be bounded own-data records.");
    }
    const policy = resolveCompanionWorkingSetPolicy(normalized.policy);
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

    for (const input of normalized.conversations) {
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
      sessionId: normalized.sessionId,
      conversations: normalized.conversations,
      ...(normalized.acceptedAdapters
        ? { acceptedAdapters: normalized.acceptedAdapters }
        : {}),
      policy,
      ...(normalized.now ? { now: normalized.now } : {}),
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
    const copiedOptions = copyDispatchOptions(options);
    if (!copiedOptions) {
      throw new TypeError("dispatch options must be bounded own-data records.");
    }
    const response = await super.dispatch(input, copiedOptions);
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
