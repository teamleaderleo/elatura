// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import type { ValidationIssue, ValidationResult } from "./index.js";
import {
  measureBoundedJson,
  utf8ByteLength,
  type BoundedJsonUsage,
} from "./resource-accounting.js";

export const READ_ONLY_REPRESENTATION_VERSION = 1 as const;
export type FreshnessState = "fresh" | "stale" | "expired";
export type FreshnessWindow = { capturedAt: number; staleAt: number; expiresAt: number };
export type TransformationProvenance = {
  kind: "authoritative" | "windowed" | "alternate-representation";
  id?: string;
  version?: string;
};
export type ContentProvenance = {
  authority: { origin: string; reference?: string };
  capturedAt: number;
  adapter: AdapterIdentity;
  transformation: TransformationProvenance;
  cache: { kind: "none" | "memory" | "persistent"; envelopeVersion?: number };
  freshness: FreshnessWindow;
  synthetic: boolean;
};
export type ReadOnlyCodeBlock = { language?: string; text: string };
export type ReadOnlyEntry = {
  id: string;
  parentId: string | null;
  childIds: string[];
  sequence: number;
  kind: string;
  label?: string;
  text?: string;
  codeBlocks: ReadOnlyCodeBlock[];
  jumpBackReference?: string;
};
export type ReadOnlyRepresentation = {
  version: typeof READ_ONLY_REPRESENTATION_VERSION;
  adapter: AdapterIdentity;
  provenance: ContentProvenance;
  roots: string[];
  activePath: string[];
  entries: ReadOnlyEntry[];
};

export type ReadOnlyRepresentationPolicy = Readonly<{
  maxEntries: number;
  maxChildrenPerEntry: number;
  maxCodeBlocksPerEntry: number;
  maxTextCodeUnits: number;
  maxCodeBlockTextCodeUnits: number;
  maxEntrySerializedBytes: number;
  maxRepresentationSerializedBytes: number;
  maxRepresentationNodes: number;
  maxSearchQueryCodeUnits: number;
  maxSearchResults: number;
  maxCodeExtractionResults: number;
}>;

export type ReadOnlyRepresentationUsage = Readonly<{
  entryCount: number;
  codeBlockCount: number;
  stringCodeUnits: number;
  serializedBytes: number;
  jsonNodes: number;
}>;

export type ValidatedReadOnlyRepresentation = Readonly<{
  representation: ReadOnlyRepresentation;
  usage: ReadOnlyRepresentationUsage;
}>;

export const DEFAULT_READ_ONLY_REPRESENTATION_POLICY: ReadOnlyRepresentationPolicy = Object.freeze({
  maxEntries: 10_000,
  maxChildrenPerEntry: 10_000,
  maxCodeBlocksPerEntry: 256,
  maxTextCodeUnits: 1_048_576,
  maxCodeBlockTextCodeUnits: 262_144,
  maxEntrySerializedBytes: 2_097_152,
  maxRepresentationSerializedBytes: 33_554_432,
  maxRepresentationNodes: 1_000_000,
  maxSearchQueryCodeUnits: 4_096,
  maxSearchResults: 1_000,
  maxCodeExtractionResults: 4_096,
});

const MAX_METADATA_STRING = 512;
const MAX_REFERENCE_LENGTH = 4_096;
const ADAPTER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const TRANSFORMATION_KINDS = new Set(["authoritative", "windowed", "alternate-representation"]);
const CACHE_KINDS = new Set(["none", "memory", "persistent"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(issue(`${path}.${key}`, "unknown-field", "Unexpected field for this schema version."));
  }
}

function policy(input: Partial<ReadOnlyRepresentationPolicy> | undefined): ValidationResult<ReadOnlyRepresentationPolicy> {
  const resolved = { ...DEFAULT_READ_ONLY_REPRESENTATION_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return { ok: false, issues: [issue("$.policy", "representation-policy-invalid", `${name} must be a positive safe integer.`)] };
    }
  }
  return { ok: true, value: Object.freeze(resolved), warnings: [] };
}

function boundedString(value: unknown, allowEmpty = false, max = MAX_METADATA_STRING): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
    throw new TypeError("Representation input contains an accessor or missing data property.");
  }
  return descriptor.value;
}

function parseAdapterIdentity(input: unknown, path: string, issues: ValidationIssue[]): AdapterIdentity | null {
  if (!isRecord(input)) {
    issues.push(issue(path, "invalid-adapter-identity", "Expected adapter id and version."));
    return null;
  }
  exactKeys(input, ["id", "version"], path, issues);
  if (
    typeof input.id !== "string" ||
    !ADAPTER_TOKEN.test(input.id) ||
    typeof input.version !== "string" ||
    !ADAPTER_TOKEN.test(input.version)
  ) {
    issues.push(issue(path, "invalid-adapter-identity", "Expected bounded adapter id and version tokens."));
    return null;
  }
  return { id: input.id, version: input.version };
}

function exactOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_REFERENCE_LENGTH) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.origin !== value
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safeReference(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REFERENCE_LENGTH) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.origin !== origin ||
      url.search !== ""
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sameAdapter(left: AdapterIdentity, right: AdapterIdentity): boolean {
  return left.id === right.id && left.version === right.version;
}

function sameFreshness(left: FreshnessWindow, right: FreshnessWindow): boolean {
  return left.capturedAt === right.capturedAt && left.staleAt === right.staleAt && left.expiresAt === right.expiresAt;
}

export function validateFreshnessWindow(input: unknown, path = "$.freshness"): ValidationResult<FreshnessWindow> {
  try {
    if (!isRecord(input)) return { ok: false, issues: [issue(path, "freshness-not-object", "Expected an object.")] };
    const issues: ValidationIssue[] = [];
    exactKeys(input, ["capturedAt", "staleAt", "expiresAt"], path, issues);
    const { capturedAt, staleAt, expiresAt } = input;
    if (
      typeof capturedAt !== "number" || !Number.isFinite(capturedAt) || capturedAt < 0 ||
      typeof staleAt !== "number" || !Number.isFinite(staleAt) || staleAt < 0 ||
      typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt < 0
    ) {
      issues.push(issue(path, "invalid-freshness-time", "Freshness times must be finite non-negative numbers."));
    } else if (capturedAt > staleAt || staleAt > expiresAt) {
      issues.push(issue(path, "invalid-freshness-order", "Expected capturedAt <= staleAt <= expiresAt."));
    }
    if (issues.length > 0 || typeof capturedAt !== "number" || typeof staleAt !== "number" || typeof expiresAt !== "number") {
      return { ok: false, issues };
    }
    return { ok: true, value: { capturedAt, staleAt, expiresAt }, warnings: [] };
  } catch {
    return { ok: false, issues: [issue(path, "freshness-inspection-failed", "Freshness inspection failed safely.")] };
  }
}

export function resolveFreshnessState(window: FreshnessWindow, now: number): FreshnessState {
  return now >= window.expiresAt ? "expired" : now >= window.staleAt ? "stale" : "fresh";
}

export function validateContentProvenance(
  input: unknown,
  path = "$.provenance",
): ValidationResult<ContentProvenance> {
  try {
    if (!isRecord(input)) return { ok: false, issues: [issue(path, "invalid-provenance", "Expected provenance metadata.")] };
    const issues: ValidationIssue[] = [];
    exactKeys(input, ["authority", "capturedAt", "adapter", "transformation", "cache", "freshness", "synthetic"], path, issues);

    let authority: ContentProvenance["authority"] | null = null;
    if (!isRecord(input.authority)) {
      issues.push(issue(`${path}.authority`, "invalid-authority", "Expected authority metadata."));
    } else {
      exactKeys(input.authority, ["origin", "reference"], `${path}.authority`, issues);
      const origin = exactOrigin(input.authority.origin);
      if (!origin) {
        issues.push(issue(`${path}.authority.origin`, "invalid-authority-origin", "Expected an exact HTTP(S) origin without credentials."));
      } else {
        let reference: string | undefined;
        if (input.authority.reference !== undefined) {
          const parsed = safeReference(input.authority.reference, origin);
          if (!parsed) {
            issues.push(issue(`${path}.authority.reference`, "invalid-authority-reference", "Expected a same-origin HTTP(S) reference without credentials or a query string."));
          } else reference = parsed;
        }
        authority = { origin, ...(reference ? { reference } : {}) };
      }
    }

    const adapter = parseAdapterIdentity(input.adapter, `${path}.adapter`, issues);
    let transformation: TransformationProvenance | null = null;
    if (!isRecord(input.transformation)) {
      issues.push(issue(`${path}.transformation`, "invalid-transformation", "Expected transformation metadata."));
    } else {
      exactKeys(input.transformation, ["kind", "id", "version"], `${path}.transformation`, issues);
      const kind = input.transformation.kind;
      if (typeof kind !== "string" || !TRANSFORMATION_KINDS.has(kind)) {
        issues.push(issue(`${path}.transformation.kind`, "invalid-transformation-kind", "Unsupported transformation kind."));
      } else {
        const id = input.transformation.id;
        const version = input.transformation.version;
        if ((id !== undefined && !boundedString(id)) || (version !== undefined && !boundedString(version))) {
          issues.push(issue(`${path}.transformation`, "invalid-transformation-identity", "Transformation id and version must be bounded strings."));
        } else if (kind !== "authoritative" && (typeof id !== "string" || typeof version !== "string")) {
          issues.push(issue(`${path}.transformation`, "missing-transformation-identity", "Derived transformations require id and version."));
        } else {
          transformation = {
            kind: kind as TransformationProvenance["kind"],
            ...(typeof id === "string" ? { id } : {}),
            ...(typeof version === "string" ? { version } : {}),
          };
        }
      }
    }

    let cache: ContentProvenance["cache"] | null = null;
    if (!isRecord(input.cache)) {
      issues.push(issue(`${path}.cache`, "invalid-cache-provenance", "Expected cache provenance."));
    } else {
      exactKeys(input.cache, ["kind", "envelopeVersion"], `${path}.cache`, issues);
      const kind = input.cache.kind;
      if (typeof kind !== "string" || !CACHE_KINDS.has(kind)) {
        issues.push(issue(`${path}.cache.kind`, "invalid-cache-kind", "Unsupported cache provenance kind."));
      } else if (kind === "none") {
        if (input.cache.envelopeVersion !== undefined) {
          issues.push(issue(`${path}.cache.envelopeVersion`, "unexpected-envelope-version", "Uncached content must not declare an envelope version."));
        } else cache = { kind: "none" };
      } else if (!Number.isInteger(input.cache.envelopeVersion) || (input.cache.envelopeVersion as number) < 1) {
        issues.push(issue(`${path}.cache.envelopeVersion`, "invalid-envelope-version", "Cached content requires a positive envelope version."));
      } else cache = { kind: kind as "memory" | "persistent", envelopeVersion: input.cache.envelopeVersion as number };
    }

    const freshness = validateFreshnessWindow(input.freshness, `${path}.freshness`);
    if (!freshness.ok) issues.push(...freshness.issues);
    if (typeof input.capturedAt !== "number" || !Number.isFinite(input.capturedAt) || input.capturedAt < 0) {
      issues.push(issue(`${path}.capturedAt`, "invalid-capture-time", "Expected a finite non-negative capture time."));
    } else if (freshness.ok && freshness.value.capturedAt !== input.capturedAt) {
      issues.push(issue(`${path}.capturedAt`, "capture-time-mismatch", "Capture time must match freshness metadata."));
    }
    if (typeof input.synthetic !== "boolean") {
      issues.push(issue(`${path}.synthetic`, "invalid-synthetic-flag", "Expected a boolean."));
    }

    if (
      issues.length > 0 || authority === null || adapter === null || transformation === null || cache === null ||
      !freshness.ok || typeof input.capturedAt !== "number" || typeof input.synthetic !== "boolean"
    ) return { ok: false, issues };

    return {
      ok: true,
      value: {
        authority,
        capturedAt: input.capturedAt,
        adapter,
        transformation,
        cache,
        freshness: freshness.value,
        synthetic: input.synthetic,
      },
      warnings: [],
    };
  } catch {
    return { ok: false, issues: [issue(path, "provenance-inspection-failed", "Provenance inspection failed safely.")] };
  }
}

function parseStringArray(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
  maximum: number,
): string[] | null {
  if (!Array.isArray(input) || input.length > maximum) {
    issues.push(issue(path, "invalid-string-array", "Expected a bounded array of strings."));
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!boundedString(value) || seen.has(value)) {
      issues.push(issue(`${path}[${index}]`, "invalid-or-duplicate-id", "Expected a unique bounded string."));
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function parseCodeBlocks(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
  resolved: ReadOnlyRepresentationPolicy,
): ReadOnlyCodeBlock[] | null {
  if (!Array.isArray(input) || input.length > resolved.maxCodeBlocksPerEntry) {
    issues.push(issue(path, "representation-code-block-limit", "Code-block count exceeds the representation policy."));
    return null;
  }
  const blocks: ReadOnlyCodeBlock[] = [];
  input.forEach((candidate, index) => {
    const blockPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(blockPath, "invalid-code-block", "Expected an object."));
      return;
    }
    exactKeys(candidate, ["language", "text"], blockPath, issues);
    if (
      typeof candidate.text !== "string" ||
      candidate.text.length > resolved.maxCodeBlockTextCodeUnits ||
      (candidate.language !== undefined && !boundedString(candidate.language))
    ) {
      issues.push(issue(blockPath, "representation-code-block-text-limit", "Code-block text exceeds the representation policy."));
      return;
    }
    blocks.push({ ...(typeof candidate.language === "string" ? { language: candidate.language } : {}), text: candidate.text });
  });
  return blocks;
}

function validateAcyclic(
  entries: readonly ReadOnlyEntry[],
  byId: ReadonlyMap<string, ReadOnlyEntry>,
  issues: ValidationIssue[],
): void {
  const completed = new Set<string>();
  for (const entry of entries) {
    if (completed.has(entry.id)) continue;
    const path: string[] = [];
    const local = new Set<string>();
    let cursor: string | null = entry.id;
    while (cursor !== null) {
      if (completed.has(cursor)) break;
      if (local.has(cursor)) {
        issues.push(issue(`$.entries.${cursor}.parentId`, "representation-cycle", "Every parent chain must terminate at a root."));
        break;
      }
      const current = byId.get(cursor);
      if (!current) break;
      local.add(cursor);
      path.push(cursor);
      cursor = current.parentId;
    }
    path.forEach((id) => completed.add(id));
  }
}

function mapJsonFailure(code: string, scope: "entry" | "representation"): string {
  if (code === "json-serialized-byte-limit") {
    return scope === "entry" ? "representation-entry-byte-limit" : "representation-total-byte-limit";
  }
  if (code === "json-string-limit") return "representation-string-limit";
  if (code === "json-node-limit" || code === "json-depth-limit") return "representation-unit-limit";
  return "representation-inspection-failed";
}

function measureInput(
  input: unknown,
  resolved: ReadOnlyRepresentationPolicy,
): ValidationResult<ReadOnlyRepresentationUsage> {
  const overall = measureBoundedJson(input, {
    maxDepth: 128,
    maxNodes: resolved.maxRepresentationNodes,
    maxStringCodeUnits: resolved.maxTextCodeUnits,
    maxSerializedBytes: resolved.maxRepresentationSerializedBytes,
  });
  if (!overall.ok) {
    const first = overall.issues[0]!;
    return { ok: false, issues: [issue("$", mapJsonFailure(first.code, "representation"), first.message)] };
  }

  try {
    if (!isRecord(input)) return { ok: false, issues: [issue("$", "representation-not-object", "Expected an object.")] };
    const entriesValue = dataProperty(input, "entries");
    if (!Array.isArray(entriesValue) || entriesValue.length > resolved.maxEntries) {
      return { ok: false, issues: [issue("$.entries", "representation-entry-count-limit", "Entry count exceeds the representation policy.")] };
    }
    let codeBlockCount = 0;
    for (let index = 0; index < entriesValue.length; index += 1) {
      const candidate = dataProperty(entriesValue, String(index));
      const measuredEntry = measureBoundedJson(candidate, {
        maxDepth: 64,
        maxNodes: resolved.maxRepresentationNodes,
        maxStringCodeUnits: resolved.maxTextCodeUnits,
        maxSerializedBytes: resolved.maxEntrySerializedBytes,
      });
      if (!measuredEntry.ok) {
        const first = measuredEntry.issues[0]!;
        return { ok: false, issues: [issue(`$.entries[${index}]`, mapJsonFailure(first.code, "entry"), first.message)] };
      }
      if (!isRecord(candidate)) continue;
      const text = Object.getOwnPropertyDescriptor(candidate, "text")?.value;
      if (typeof text === "string" && text.length > resolved.maxTextCodeUnits) {
        return { ok: false, issues: [issue(`$.entries[${index}].text`, "representation-string-limit", "Entry text exceeds the representation policy.")] };
      }
      const blocks = dataProperty(candidate, "codeBlocks");
      if (!Array.isArray(blocks) || blocks.length > resolved.maxCodeBlocksPerEntry) {
        return { ok: false, issues: [issue(`$.entries[${index}].codeBlocks`, "representation-code-block-limit", "Code-block count exceeds the representation policy.")] };
      }
      codeBlockCount += blocks.length;
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = dataProperty(blocks, String(blockIndex));
        if (!isRecord(block)) continue;
        const blockText = dataProperty(block, "text");
        if (typeof blockText === "string" && blockText.length > resolved.maxCodeBlockTextCodeUnits) {
          return { ok: false, issues: [issue(`$.entries[${index}].codeBlocks[${blockIndex}].text`, "representation-code-block-text-limit", "Code-block text exceeds the representation policy.")] };
        }
      }
    }
    return {
      ok: true,
      value: Object.freeze({
        entryCount: entriesValue.length,
        codeBlockCount,
        stringCodeUnits: overall.value.stringCodeUnits,
        serializedBytes: overall.value.serializedBytes,
        jsonNodes: overall.value.nodes,
      }),
      warnings: [],
    };
  } catch {
    return { ok: false, issues: [issue("$", "representation-inspection-failed", "Representation inspection failed safely.")] };
  }
}

function validateNormalized(
  input: unknown,
  resolved: ReadOnlyRepresentationPolicy,
): ValidationResult<ReadOnlyRepresentation> {
  if (!isRecord(input)) return { ok: false, issues: [issue("$", "representation-not-object", "Expected an object.")] };
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["version", "adapter", "provenance", "roots", "activePath", "entries"], "$", issues);
  if (input.version !== READ_ONLY_REPRESENTATION_VERSION) {
    issues.push(issue("$.version", "unsupported-representation-version", "Unsupported version."));
  }
  const adapter = parseAdapterIdentity(input.adapter, "$.adapter", issues);
  const provenance = validateContentProvenance(input.provenance);
  if (!provenance.ok) issues.push(...provenance.issues);
  if (adapter && provenance.ok && !sameAdapter(adapter, provenance.value.adapter)) {
    issues.push(issue("$.provenance.adapter", "provenance-adapter-mismatch", "Provenance adapter must match the representation adapter."));
  }

  const roots = parseStringArray(input.roots, "$.roots", issues, resolved.maxEntries);
  const activePath = parseStringArray(input.activePath, "$.activePath", issues, resolved.maxEntries);
  if (!Array.isArray(input.entries) || input.entries.length > resolved.maxEntries) {
    issues.push(issue("$.entries", "representation-entry-count-limit", "Entry count exceeds the representation policy."));
  }
  if (issues.length > 0 || !Array.isArray(input.entries) || input.entries.length > resolved.maxEntries || !roots || !activePath) {
    return { ok: false, issues };
  }

  const entries: ReadOnlyEntry[] = [];
  const byId = new Map<string, ReadOnlyEntry>();
  const sequences = new Set<number>();
  input.entries.forEach((candidate, index) => {
    const path = `$.entries[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(path, "entry-not-object", "Expected an object."));
      return;
    }
    exactKeys(candidate, ["id", "parentId", "childIds", "sequence", "kind", "label", "text", "codeBlocks", "jumpBackReference"], path, issues);
    if (!boundedString(candidate.id) || byId.has(candidate.id)) {
      issues.push(issue(`${path}.id`, "invalid-entry-id", "Entry ids must be unique bounded strings."));
      return;
    }
    if (!(candidate.parentId === null || boundedString(candidate.parentId))) {
      issues.push(issue(`${path}.parentId`, "invalid-parent-id", "Expected bounded string or null."));
      return;
    }
    const childIds = parseStringArray(candidate.childIds, `${path}.childIds`, issues, resolved.maxChildrenPerEntry);
    if (!childIds) return;
    if (typeof candidate.sequence !== "number" || !Number.isInteger(candidate.sequence) || candidate.sequence < 0 || sequences.has(candidate.sequence)) {
      issues.push(issue(`${path}.sequence`, "invalid-sequence", "Sequences must be unique non-negative integers."));
      return;
    }
    if (!boundedString(candidate.kind)) {
      issues.push(issue(`${path}.kind`, "invalid-entry-kind", "Expected a bounded non-empty string."));
      return;
    }
    if (candidate.label !== undefined && !boundedString(candidate.label)) {
      issues.push(issue(`${path}.label`, "invalid-entry-label", "Expected a bounded string."));
      return;
    }
    if (candidate.text !== undefined && (typeof candidate.text !== "string" || candidate.text.length > resolved.maxTextCodeUnits)) {
      issues.push(issue(`${path}.text`, "representation-string-limit", "Entry text exceeds the representation policy."));
      return;
    }
    const codeBlocks = parseCodeBlocks(candidate.codeBlocks, `${path}.codeBlocks`, issues, resolved);
    if (!codeBlocks) return;

    let jumpBackReference: string | undefined;
    if (candidate.jumpBackReference !== undefined) {
      const origin = provenance.ok ? provenance.value.authority.origin : "";
      const parsed = origin ? safeReference(candidate.jumpBackReference, origin) : null;
      if (!parsed) {
        issues.push(issue(`${path}.jumpBackReference`, "invalid-jump-back-reference", "Expected a same-origin HTTP(S) reference without credentials or a query string."));
      } else jumpBackReference = parsed;
    }

    const entry: ReadOnlyEntry = {
      id: candidate.id,
      parentId: candidate.parentId,
      childIds,
      sequence: candidate.sequence,
      kind: candidate.kind,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
      ...(typeof candidate.text === "string" ? { text: candidate.text } : {}),
      codeBlocks,
      ...(jumpBackReference ? { jumpBackReference } : {}),
    };
    entries.push(entry);
    byId.set(entry.id, entry);
    sequences.add(entry.sequence);
  });

  const ordered = [...entries].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  if (entries.some((entry, index) => entry.id !== ordered[index]?.id)) {
    issues.push(issue("$.entries", "non-deterministic-entry-order", "Entries must be ordered by sequence then id."));
  }
  for (const entry of entries) {
    if (entry.parentId !== null) {
      const parent = byId.get(entry.parentId);
      if (!parent) issues.push(issue(`$.entries.${entry.id}.parentId`, "missing-parent", "Parent does not resolve."));
      else if (!parent.childIds.includes(entry.id)) issues.push(issue(`$.entries.${entry.id}.parentId`, "parent-child-mismatch", "Parent must reference the child."));
    }
    for (const childId of entry.childIds) {
      const child = byId.get(childId);
      if (!child) issues.push(issue(`$.entries.${entry.id}.childIds`, "missing-child", "Child does not resolve."));
      else if (child.parentId !== entry.id) issues.push(issue(`$.entries.${entry.id}.childIds`, "child-parent-mismatch", "Child must reference the parent."));
    }
  }
  validateAcyclic(entries, byId, issues);

  const actualRoots = entries.filter((entry) => entry.parentId === null).map((entry) => entry.id).sort();
  if (JSON.stringify([...roots].sort()) !== JSON.stringify(actualRoots)) {
    issues.push(issue("$.roots", "root-set-mismatch", "Roots must list every parentless entry exactly once."));
  }
  if (entries.length > 0 && activePath.length === 0) {
    issues.push(issue("$.activePath", "empty-active-path", "A non-empty representation requires an active path."));
  }
  activePath.forEach((id, index) => {
    const entry = byId.get(id);
    if (!entry) issues.push(issue(`$.activePath[${index}]`, "active-entry-missing", "Active entry does not resolve."));
    else if ((index === 0 && entry.parentId !== null) || (index > 0 && entry.parentId !== activePath[index - 1])) {
      issues.push(issue(`$.activePath[${index}]`, "active-path-disconnected", "Active path must follow parent links from a root."));
    }
  });

  if (issues.length > 0 || adapter === null || !provenance.ok) return { ok: false, issues };
  return {
    ok: true,
    value: {
      version: READ_ONLY_REPRESENTATION_VERSION,
      adapter,
      provenance: provenance.value,
      roots: actualRoots,
      activePath: [...activePath],
      entries,
    },
    warnings: [],
  };
}

export function validateAndMeasureReadOnlyRepresentation(
  input: unknown,
  inputPolicy?: Partial<ReadOnlyRepresentationPolicy>,
): ValidationResult<ValidatedReadOnlyRepresentation> {
  const resolved = policy(inputPolicy);
  if (!resolved.ok) return resolved;
  const measured = measureInput(input, resolved.value);
  if (!measured.ok) return measured;
  try {
    const validated = validateNormalized(input, resolved.value);
    if (!validated.ok) return validated;
    return {
      ok: true,
      value: Object.freeze({ representation: validated.value, usage: measured.value }),
      warnings: validated.warnings,
    };
  } catch {
    return { ok: false, issues: [issue("$", "representation-inspection-failed", "Representation inspection failed safely.")] };
  }
}

export function validateReadOnlyRepresentation(
  input: unknown,
  inputPolicy?: Partial<ReadOnlyRepresentationPolicy>,
): ValidationResult<ReadOnlyRepresentation> {
  const result = validateAndMeasureReadOnlyRepresentation(input, inputPolicy);
  if (!result.ok) return result;
  return { ok: true, value: result.value.representation, warnings: result.warnings };
}

export function measureReadOnlyRepresentation(
  input: unknown,
  inputPolicy?: Partial<ReadOnlyRepresentationPolicy>,
): ValidationResult<ReadOnlyRepresentationUsage> {
  const resolved = policy(inputPolicy);
  if (!resolved.ok) return resolved;
  return measureInput(input, resolved.value);
}

function boundedResultLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? Math.min(value as number, fallback) : fallback;
}

export function searchReadOnlyRepresentation(
  representation: ReadOnlyRepresentation,
  query: string,
  options: { maxResults?: number } = {},
): ReadOnlyEntry[] {
  if (typeof query !== "string" || query.length > DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxSearchQueryCodeUnits) return [];
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const maximum = boundedResultLimit(options.maxResults, DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxSearchResults);
  const results: ReadOnlyEntry[] = [];
  for (const entry of representation.entries) {
    let matched = typeof entry.label === "string" && entry.label.toLocaleLowerCase().includes(needle);
    if (!matched && typeof entry.text === "string") matched = entry.text.toLocaleLowerCase().includes(needle);
    if (!matched) {
      for (const block of entry.codeBlocks) {
        if (block.text.toLocaleLowerCase().includes(needle)) {
          matched = true;
          break;
        }
      }
    }
    if (matched) results.push(entry);
    if (results.length >= maximum) break;
  }
  return results;
}

export function extractReadOnlyCode(
  representation: ReadOnlyRepresentation,
  options: { maxResults?: number } = {},
): Array<ReadOnlyCodeBlock & { entryId: string }> {
  const maximum = boundedResultLimit(
    options.maxResults,
    DEFAULT_READ_ONLY_REPRESENTATION_POLICY.maxCodeExtractionResults,
  );
  const output: Array<ReadOnlyCodeBlock & { entryId: string }> = [];
  for (const entry of representation.entries) {
    for (const block of entry.codeBlocks) {
      output.push({ ...block, entryId: entry.id });
      if (output.length >= maximum) return output;
    }
  }
  return output;
}

export function navigateReadOnlyRepresentation(
  representation: ReadOnlyRepresentation,
  entryId: string,
): { parent: ReadOnlyEntry | null; children: ReadOnlyEntry[]; siblings: ReadOnlyEntry[] } | null {
  const byId = new Map(representation.entries.map((entry) => [entry.id, entry]));
  const entry = byId.get(entryId);
  if (!entry) return null;
  const parent = entry.parentId === null ? null : (byId.get(entry.parentId) ?? null);
  const children = entry.childIds.map((id) => byId.get(id)).filter((value): value is ReadOnlyEntry => value !== undefined);
  const siblings = parent
    ? parent.childIds.filter((id) => id !== entry.id).map((id) => byId.get(id)).filter((value): value is ReadOnlyEntry => value !== undefined)
    : [];
  return { parent, children, siblings };
}

export function resolveJumpBackReference(representation: ReadOnlyRepresentation, entryId: string): string | null {
  const origin = exactOrigin(representation.provenance.authority.origin);
  if (!origin) return null;
  const entryReference = representation.entries.find((entry) => entry.id === entryId)?.jumpBackReference;
  if (entryReference) {
    const parsed = safeReference(entryReference, origin);
    if (parsed) return parsed;
  }
  const authorityReference = representation.provenance.authority.reference;
  return authorityReference ? safeReference(authorityReference, origin) : null;
}

export function sameFreshnessWindow(left: FreshnessWindow, right: FreshnessWindow): boolean {
  return sameFreshness(left, right);
}

export function representationUtf8Bytes(representation: ReadOnlyRepresentation): number {
  const measured = measureReadOnlyRepresentation(representation);
  return measured.ok ? measured.value.serializedBytes : utf8ByteLength(JSON.stringify(representation));
}
