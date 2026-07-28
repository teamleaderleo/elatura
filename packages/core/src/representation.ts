// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import type { ValidationIssue, ValidationResult } from "./index.js";

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

const MAX_METADATA_STRING = 512;
const MAX_REFERENCE_LENGTH = 4_096;
const MAX_ENTRIES = 250_000;
const MAX_CHILDREN_PER_ENTRY = 250_000;
const ADAPTER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const TRANSFORMATION_KINDS = new Set(["authoritative", "windowed", "alternate-representation"]);
const CACHE_KINDS = new Set(["none", "memory", "persistent"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push({ path: `${path}.${key}`, code: "unknown-field", message: "Unexpected field for this schema version." });
    }
  }
}

function boundedString(value: unknown, allowEmpty = false, max = MAX_METADATA_STRING): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseAdapterIdentity(input: unknown, path: string, issues: ValidationIssue[]): AdapterIdentity | null {
  if (!isRecord(input)) {
    issues.push({ path, code: "invalid-adapter-identity", message: "Expected adapter id and version." });
    return null;
  }
  exactKeys(input, ["id", "version"], path, issues);
  if (
    typeof input.id !== "string" ||
    !ADAPTER_TOKEN.test(input.id) ||
    typeof input.version !== "string" ||
    !ADAPTER_TOKEN.test(input.version)
  ) {
    issues.push({ path, code: "invalid-adapter-identity", message: "Expected bounded adapter id and version tokens." });
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
    ) {
      return null;
    }
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
    ) {
      return null;
    }
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
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path, code: "freshness-not-object", message: "Expected an object." }] };
  }
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["capturedAt", "staleAt", "expiresAt"], path, issues);
  const { capturedAt, staleAt, expiresAt } = input;
  if (
    typeof capturedAt !== "number" || !Number.isFinite(capturedAt) || capturedAt < 0 ||
    typeof staleAt !== "number" || !Number.isFinite(staleAt) || staleAt < 0 ||
    typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt < 0
  ) {
    issues.push({ path, code: "invalid-freshness-time", message: "Freshness times must be finite non-negative numbers." });
  } else if (capturedAt > staleAt || staleAt > expiresAt) {
    issues.push({ path, code: "invalid-freshness-order", message: "Expected capturedAt <= staleAt <= expiresAt." });
  }
  if (issues.length > 0 || typeof capturedAt !== "number" || typeof staleAt !== "number" || typeof expiresAt !== "number") {
    return { ok: false, issues };
  }
  return { ok: true, value: { capturedAt, staleAt, expiresAt }, warnings: [] };
}

export function resolveFreshnessState(window: FreshnessWindow, now: number): FreshnessState {
  return now >= window.expiresAt ? "expired" : now >= window.staleAt ? "stale" : "fresh";
}

export function validateContentProvenance(
  input: unknown,
  path = "$.provenance",
): ValidationResult<ContentProvenance> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path, code: "invalid-provenance", message: "Expected provenance metadata." }] };
  }
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["authority", "capturedAt", "adapter", "transformation", "cache", "freshness", "synthetic"], path, issues);

  let authority: ContentProvenance["authority"] | null = null;
  if (!isRecord(input.authority)) {
    issues.push({ path: `${path}.authority`, code: "invalid-authority", message: "Expected authority metadata." });
  } else {
    exactKeys(input.authority, ["origin", "reference"], `${path}.authority`, issues);
    const origin = exactOrigin(input.authority.origin);
    if (!origin) {
      issues.push({ path: `${path}.authority.origin`, code: "invalid-authority-origin", message: "Expected an exact HTTP(S) origin without credentials." });
    } else {
      let reference: string | undefined;
      if (input.authority.reference !== undefined) {
        const parsed = safeReference(input.authority.reference, origin);
        if (!parsed) {
          issues.push({
            path: `${path}.authority.reference`,
            code: "invalid-authority-reference",
            message: "Expected a same-origin HTTP(S) reference without credentials or a query string.",
          });
        } else {
          reference = parsed;
        }
      }
      authority = { origin, ...(reference ? { reference } : {}) };
    }
  }

  const adapter = parseAdapterIdentity(input.adapter, `${path}.adapter`, issues);

  let transformation: TransformationProvenance | null = null;
  if (!isRecord(input.transformation)) {
    issues.push({ path: `${path}.transformation`, code: "invalid-transformation", message: "Expected transformation metadata." });
  } else {
    exactKeys(input.transformation, ["kind", "id", "version"], `${path}.transformation`, issues);
    const kind = input.transformation.kind;
    if (typeof kind !== "string" || !TRANSFORMATION_KINDS.has(kind)) {
      issues.push({ path: `${path}.transformation.kind`, code: "invalid-transformation-kind", message: "Unsupported transformation kind." });
    } else {
      const id = input.transformation.id;
      const version = input.transformation.version;
      const idValid = id === undefined || boundedString(id);
      const versionValid = version === undefined || boundedString(version);
      if (!idValid || !versionValid) {
        issues.push({ path: `${path}.transformation`, code: "invalid-transformation-identity", message: "Transformation id and version must be bounded strings." });
      } else if (kind !== "authoritative" && (typeof id !== "string" || typeof version !== "string")) {
        issues.push({ path: `${path}.transformation`, code: "missing-transformation-identity", message: "Derived transformations require id and version." });
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
    issues.push({ path: `${path}.cache`, code: "invalid-cache-provenance", message: "Expected cache provenance." });
  } else {
    exactKeys(input.cache, ["kind", "envelopeVersion"], `${path}.cache`, issues);
    const kind = input.cache.kind;
    if (typeof kind !== "string" || !CACHE_KINDS.has(kind)) {
      issues.push({ path: `${path}.cache.kind`, code: "invalid-cache-kind", message: "Unsupported cache provenance kind." });
    } else if (kind === "none") {
      if (input.cache.envelopeVersion !== undefined) {
        issues.push({ path: `${path}.cache.envelopeVersion`, code: "unexpected-envelope-version", message: "Uncached content must not declare an envelope version." });
      } else {
        cache = { kind: "none" };
      }
    } else if (!Number.isInteger(input.cache.envelopeVersion) || (input.cache.envelopeVersion as number) < 1) {
      issues.push({ path: `${path}.cache.envelopeVersion`, code: "invalid-envelope-version", message: "Cached content requires a positive envelope version." });
    } else {
      cache = { kind: kind as "memory" | "persistent", envelopeVersion: input.cache.envelopeVersion as number };
    }
  }

  const freshness = validateFreshnessWindow(input.freshness, `${path}.freshness`);
  if (!freshness.ok) issues.push(...freshness.issues);
  if (typeof input.capturedAt !== "number" || !Number.isFinite(input.capturedAt) || input.capturedAt < 0) {
    issues.push({ path: `${path}.capturedAt`, code: "invalid-capture-time", message: "Expected a finite non-negative capture time." });
  } else if (freshness.ok && freshness.value.capturedAt !== input.capturedAt) {
    issues.push({ path: `${path}.capturedAt`, code: "capture-time-mismatch", message: "Capture time must match freshness metadata." });
  }
  if (typeof input.synthetic !== "boolean") {
    issues.push({ path: `${path}.synthetic`, code: "invalid-synthetic-flag", message: "Expected a boolean." });
  }

  if (
    issues.length > 0 ||
    authority === null ||
    adapter === null ||
    transformation === null ||
    cache === null ||
    !freshness.ok ||
    typeof input.capturedAt !== "number" ||
    typeof input.synthetic !== "boolean"
  ) {
    return { ok: false, issues };
  }

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
}

function parseStringArray(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
  maximum = MAX_CHILDREN_PER_ENTRY,
): string[] | null {
  if (!Array.isArray(input) || input.length > maximum) {
    issues.push({ path, code: "invalid-string-array", message: "Expected a bounded array of strings." });
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!boundedString(value) || seen.has(value)) {
      issues.push({ path: `${path}[${index}]`, code: "invalid-or-duplicate-id", message: "Expected a unique bounded string." });
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function parseCodeBlocks(input: unknown, path: string, issues: ValidationIssue[]): ReadOnlyCodeBlock[] | null {
  if (!Array.isArray(input) || input.length > MAX_CHILDREN_PER_ENTRY) {
    issues.push({ path, code: "invalid-code-blocks", message: "Expected a bounded array." });
    return null;
  }
  const blocks: ReadOnlyCodeBlock[] = [];
  input.forEach((candidate, index) => {
    const blockPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path: blockPath, code: "invalid-code-block", message: "Expected an object." });
      return;
    }
    exactKeys(candidate, ["language", "text"], blockPath, issues);
    if (typeof candidate.text !== "string" || (candidate.language !== undefined && !boundedString(candidate.language))) {
      issues.push({ path: blockPath, code: "invalid-code-block", message: "Expected text and optional bounded language." });
      return;
    }
    blocks.push({ ...(typeof candidate.language === "string" ? { language: candidate.language } : {}), text: candidate.text });
  });
  return blocks;
}

function validateAcyclic(entries: readonly ReadOnlyEntry[], byId: ReadonlyMap<string, ReadOnlyEntry>, issues: ValidationIssue[]): void {
  const completed = new Set<string>();
  for (const entry of entries) {
    if (completed.has(entry.id)) continue;
    const path: string[] = [];
    const local = new Set<string>();
    let cursor: string | null = entry.id;
    while (cursor !== null) {
      if (completed.has(cursor)) break;
      if (local.has(cursor)) {
        issues.push({ path: `$.entries.${cursor}.parentId`, code: "representation-cycle", message: "Every parent chain must terminate at a root." });
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

export function validateReadOnlyRepresentation(input: unknown): ValidationResult<ReadOnlyRepresentation> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", code: "representation-not-object", message: "Expected an object." }] };
  }
  const issues: ValidationIssue[] = [];
  exactKeys(input, ["version", "adapter", "provenance", "roots", "activePath", "entries"], "$", issues);
  if (input.version !== READ_ONLY_REPRESENTATION_VERSION) {
    issues.push({ path: "$.version", code: "unsupported-representation-version", message: "Unsupported version." });
  }
  const adapter = parseAdapterIdentity(input.adapter, "$.adapter", issues);
  const provenance = validateContentProvenance(input.provenance);
  if (!provenance.ok) issues.push(...provenance.issues);
  if (adapter && provenance.ok && !sameAdapter(adapter, provenance.value.adapter)) {
    issues.push({ path: "$.provenance.adapter", code: "provenance-adapter-mismatch", message: "Provenance adapter must match the representation adapter." });
  }

  const roots = parseStringArray(input.roots, "$.roots", issues);
  const activePath = parseStringArray(input.activePath, "$.activePath", issues);
  if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) {
    issues.push({ path: "$.entries", code: "invalid-entries", message: "Expected a bounded array." });
  }
  if (issues.length > 0 || !Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES || !roots || !activePath) {
    return { ok: false, issues };
  }

  const entries: ReadOnlyEntry[] = [];
  const byId = new Map<string, ReadOnlyEntry>();
  const sequences = new Set<number>();
  input.entries.forEach((candidate, index) => {
    const path = `$.entries[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, code: "entry-not-object", message: "Expected an object." });
      return;
    }
    exactKeys(candidate, ["id", "parentId", "childIds", "sequence", "kind", "label", "text", "codeBlocks", "jumpBackReference"], path, issues);
    if (!boundedString(candidate.id) || byId.has(candidate.id)) {
      issues.push({ path: `${path}.id`, code: "invalid-entry-id", message: "Entry ids must be unique bounded strings." });
      return;
    }
    if (!(candidate.parentId === null || boundedString(candidate.parentId))) {
      issues.push({ path: `${path}.parentId`, code: "invalid-parent-id", message: "Expected bounded string or null." });
      return;
    }
    const childIds = parseStringArray(candidate.childIds, `${path}.childIds`, issues);
    if (!childIds) return;
    if (typeof candidate.sequence !== "number" || !Number.isInteger(candidate.sequence) || candidate.sequence < 0 || sequences.has(candidate.sequence)) {
      issues.push({ path: `${path}.sequence`, code: "invalid-sequence", message: "Sequences must be unique non-negative integers." });
      return;
    }
    if (!boundedString(candidate.kind)) {
      issues.push({ path: `${path}.kind`, code: "invalid-entry-kind", message: "Expected a bounded non-empty string." });
      return;
    }
    if (candidate.label !== undefined && !boundedString(candidate.label)) {
      issues.push({ path: `${path}.label`, code: "invalid-entry-label", message: "Expected a bounded string." });
      return;
    }
    if (candidate.text !== undefined && typeof candidate.text !== "string") {
      issues.push({ path: `${path}.text`, code: "invalid-entry-text", message: "Expected text." });
      return;
    }
    const codeBlocks = parseCodeBlocks(candidate.codeBlocks, `${path}.codeBlocks`, issues);
    if (!codeBlocks) return;

    let jumpBackReference: string | undefined;
    if (candidate.jumpBackReference !== undefined) {
      const origin = provenance.ok ? provenance.value.authority.origin : "";
      const parsed = origin ? safeReference(candidate.jumpBackReference, origin) : null;
      if (!parsed) {
        issues.push({
          path: `${path}.jumpBackReference`,
          code: "invalid-jump-back-reference",
          message: "Expected a same-origin HTTP(S) reference without credentials or a query string.",
        });
      } else {
        jumpBackReference = parsed;
      }
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
    issues.push({ path: "$.entries", code: "non-deterministic-entry-order", message: "Entries must be ordered by sequence then id." });
  }
  for (const entry of entries) {
    if (entry.parentId !== null) {
      const parent = byId.get(entry.parentId);
      if (!parent) issues.push({ path: `$.entries.${entry.id}.parentId`, code: "missing-parent", message: "Parent does not resolve." });
      else if (!parent.childIds.includes(entry.id)) issues.push({ path: `$.entries.${entry.id}.parentId`, code: "parent-child-mismatch", message: "Parent must reference the child." });
    }
    for (const childId of entry.childIds) {
      const child = byId.get(childId);
      if (!child) issues.push({ path: `$.entries.${entry.id}.childIds`, code: "missing-child", message: "Child does not resolve." });
      else if (child.parentId !== entry.id) issues.push({ path: `$.entries.${entry.id}.childIds`, code: "child-parent-mismatch", message: "Child must reference the parent." });
    }
  }
  validateAcyclic(entries, byId, issues);

  const actualRoots = entries.filter((entry) => entry.parentId === null).map((entry) => entry.id).sort();
  if (JSON.stringify([...roots].sort()) !== JSON.stringify(actualRoots)) {
    issues.push({ path: "$.roots", code: "root-set-mismatch", message: "Roots must list every parentless entry exactly once." });
  }
  if (entries.length > 0 && activePath.length === 0) {
    issues.push({ path: "$.activePath", code: "empty-active-path", message: "A non-empty representation requires an active path." });
  }
  activePath.forEach((id, index) => {
    const entry = byId.get(id);
    if (!entry) issues.push({ path: `$.activePath[${index}]`, code: "active-entry-missing", message: "Active entry does not resolve." });
    else if ((index === 0 && entry.parentId !== null) || (index > 0 && entry.parentId !== activePath[index - 1])) {
      issues.push({ path: `$.activePath[${index}]`, code: "active-path-disconnected", message: "Active path must follow parent links from a root." });
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

export function searchReadOnlyRepresentation(representation: ReadOnlyRepresentation, query: string): ReadOnlyEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return representation.entries.filter((entry) =>
    [entry.label, entry.text, ...entry.codeBlocks.map((block) => block.text)]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  );
}

export function extractReadOnlyCode(representation: ReadOnlyRepresentation): Array<ReadOnlyCodeBlock & { entryId: string }> {
  return representation.entries.flatMap((entry) => entry.codeBlocks.map((block) => ({ ...block, entryId: entry.id })));
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
