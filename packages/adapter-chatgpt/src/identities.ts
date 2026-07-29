// SPDX-License-Identifier: MPL-2.0
import registryInput from "./compatibility-identities.json" with { type: "json" };

export const ADAPTER_COMPATIBILITY_REGISTRY_SCHEMA_VERSION = 1 as const;

export type AdapterCompatibilityIdentityName = "inspection" | "synthetic-transform";

export type AdapterCompatibilityIdentity = Readonly<{
  name: AdapterCompatibilityIdentityName;
  id: string;
  version: string;
}>;

const TOKEN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u;
const EXPECTED_NAMES: readonly AdapterCompatibilityIdentityName[] = [
  "inspection",
  "synthetic-transform",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new TypeError(`${path} contains unsupported fields.`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0) throw new TypeError(`${path} is missing required fields.`);
}

function parseRegistry(input: unknown): readonly AdapterCompatibilityIdentity[] {
  if (!isRecord(input)) throw new TypeError("Adapter compatibility registry must be an object.");
  exactKeys(input, ["schemaVersion", "identities"], "$registry");
  if (input.schemaVersion !== ADAPTER_COMPATIBILITY_REGISTRY_SCHEMA_VERSION) {
    throw new TypeError("Adapter compatibility registry schema is unsupported.");
  }
  if (!Array.isArray(input.identities) || input.identities.length !== EXPECTED_NAMES.length) {
    throw new TypeError("Adapter compatibility registry must contain every declared identity exactly once.");
  }

  const names = new Set<string>();
  const pairs = new Set<string>();
  const parsed = input.identities.map((item, index): AdapterCompatibilityIdentity => {
    if (!isRecord(item)) throw new TypeError(`$registry.identities[${index}] must be an object.`);
    exactKeys(item, ["name", "id", "version"], `$registry.identities[${index}]`);
    if (
      typeof item.name !== "string" ||
      !EXPECTED_NAMES.includes(item.name as AdapterCompatibilityIdentityName)
    ) {
      throw new TypeError("Adapter compatibility identity name is unsupported.");
    }
    if (typeof item.id !== "string" || !TOKEN.test(item.id)) {
      throw new TypeError("Adapter compatibility id must be a bounded local token.");
    }
    if (typeof item.version !== "string" || !VERSION.test(item.version)) {
      throw new TypeError("Adapter compatibility version must be a bounded local token.");
    }
    const pair = `${item.id}\u0000${item.version}`;
    if (names.has(item.name) || pairs.has(pair)) {
      throw new TypeError("Adapter compatibility registry entries must be unique.");
    }
    names.add(item.name);
    pairs.add(pair);
    return Object.freeze({
      name: item.name as AdapterCompatibilityIdentityName,
      id: item.id,
      version: item.version,
    });
  });

  for (const name of EXPECTED_NAMES) {
    if (!names.has(name)) throw new TypeError("Adapter compatibility registry is incomplete.");
  }
  return Object.freeze(
    parsed.sort((left, right) => left.name.localeCompare(right.name)),
  );
}

export const ADAPTER_COMPATIBILITY_IDENTITIES = parseRegistry(registryInput);

function identity(name: AdapterCompatibilityIdentityName): AdapterCompatibilityIdentity {
  const found = ADAPTER_COMPATIBILITY_IDENTITIES.find((entry) => entry.name === name);
  if (!found) throw new TypeError("Adapter compatibility registry is incomplete.");
  return found;
}

export const CHATGPT_ADAPTER_ID = identity("inspection").id;
export const CHATGPT_ADAPTER_VERSION = identity("inspection").version;
export const SYNTHETIC_CHATGPT_ADAPTER_ID = identity("synthetic-transform").id;
export const SYNTHETIC_CHATGPT_ADAPTER_VERSION = identity("synthetic-transform").version;
