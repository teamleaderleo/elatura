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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

export function validateFreshnessWindow(input: unknown, path = "$.freshness"): ValidationResult<FreshnessWindow> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path, code: "freshness-not-object", message: "Expected an object." }] };
  }
  const { capturedAt, staleAt, expiresAt } = input;
  if (
    typeof capturedAt !== "number" || !Number.isFinite(capturedAt) ||
    typeof staleAt !== "number" || !Number.isFinite(staleAt) ||
    typeof expiresAt !== "number" || !Number.isFinite(expiresAt)
  ) {
    return { ok: false, issues: [{ path, code: "invalid-freshness-time", message: "Freshness times must be finite numbers." }] };
  }
  if (capturedAt > staleAt || staleAt > expiresAt) {
    return { ok: false, issues: [{ path, code: "invalid-freshness-order", message: "Expected capturedAt <= staleAt <= expiresAt." }] };
  }
  return { ok: true, value: { capturedAt, staleAt, expiresAt }, warnings: [] };
}

export function resolveFreshnessState(window: FreshnessWindow, now: number): FreshnessState {
  return now >= window.expiresAt ? "expired" : now >= window.staleAt ? "stale" : "fresh";
}

function parseCodeBlocks(input: unknown, path: string, issues: ValidationIssue[]): ReadOnlyCodeBlock[] | null {
  if (!Array.isArray(input)) {
    issues.push({ path, code: "invalid-code-blocks", message: "Expected an array." });
    return null;
  }
  const blocks: ReadOnlyCodeBlock[] = [];
  input.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.text !== "string" || (candidate.language !== undefined && typeof candidate.language !== "string")) {
      issues.push({ path: `${path}[${index}]`, code: "invalid-code-block", message: "Expected text and optional language." });
      return;
    }
    blocks.push({ ...(candidate.language ? { language: candidate.language } : {}), text: candidate.text });
  });
  return blocks;
}

export function validateReadOnlyRepresentation(input: unknown): ValidationResult<ReadOnlyRepresentation> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", code: "representation-not-object", message: "Expected an object." }] };
  }
  const issues: ValidationIssue[] = [];
  if (input.version !== READ_ONLY_REPRESENTATION_VERSION) {
    issues.push({ path: "$.version", code: "unsupported-representation-version", message: "Unsupported version." });
  }
  if (!isRecord(input.adapter) || !text(input.adapter.id) || !text(input.adapter.version)) {
    issues.push({ path: "$.adapter", code: "invalid-adapter-identity", message: "Expected adapter id and version." });
  }
  if (!isRecord(input.provenance)) {
    issues.push({ path: "$.provenance", code: "invalid-provenance", message: "Expected provenance metadata." });
  } else {
    const provenance = input.provenance;
    if (!isRecord(provenance.authority) || !text(provenance.authority.origin) || !exactOrigin(provenance.authority.origin)) {
      issues.push({ path: "$.provenance.authority.origin", code: "invalid-authority-origin", message: "Expected an exact HTTP(S) origin." });
    }
    if (typeof provenance.capturedAt !== "number" || !Number.isFinite(provenance.capturedAt)) {
      issues.push({ path: "$.provenance.capturedAt", code: "invalid-capture-time", message: "Expected a finite number." });
    }
    const freshness = validateFreshnessWindow(provenance.freshness, "$.provenance.freshness");
    if (!freshness.ok) issues.push(...freshness.issues);
    else if (freshness.value.capturedAt !== provenance.capturedAt) {
      issues.push({ path: "$.provenance.capturedAt", code: "capture-time-mismatch", message: "Capture time must match freshness metadata." });
    }
    if (typeof provenance.synthetic !== "boolean") {
      issues.push({ path: "$.provenance.synthetic", code: "invalid-synthetic-flag", message: "Expected a boolean." });
    }
  }
  if (!strings(input.roots)) issues.push({ path: "$.roots", code: "invalid-roots", message: "Expected string entry ids." });
  if (!strings(input.activePath)) issues.push({ path: "$.activePath", code: "invalid-active-path", message: "Expected string entry ids." });
  if (!Array.isArray(input.entries)) issues.push({ path: "$.entries", code: "invalid-entries", message: "Expected an array." });
  if (issues.length > 0 || !Array.isArray(input.entries) || !strings(input.roots) || !strings(input.activePath)) {
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
    if (!text(candidate.id) || byId.has(candidate.id)) {
      issues.push({ path: `${path}.id`, code: "invalid-entry-id", message: "Entry ids must be unique non-empty strings." });
      return;
    }
    if (!(candidate.parentId === null || text(candidate.parentId))) {
      issues.push({ path: `${path}.parentId`, code: "invalid-parent-id", message: "Expected string or null." });
      return;
    }
    if (!strings(candidate.childIds) || new Set(candidate.childIds).size !== candidate.childIds.length) {
      issues.push({ path: `${path}.childIds`, code: "invalid-child-ids", message: "Expected unique string ids." });
      return;
    }
    if (typeof candidate.sequence !== "number" || !Number.isInteger(candidate.sequence) || candidate.sequence < 0 || sequences.has(candidate.sequence)) {
      issues.push({ path: `${path}.sequence`, code: "invalid-sequence", message: "Sequences must be unique non-negative integers." });
      return;
    }
    if (!text(candidate.kind)) {
      issues.push({ path: `${path}.kind`, code: "invalid-entry-kind", message: "Expected a non-empty string." });
      return;
    }
    const codeBlocks = parseCodeBlocks(candidate.codeBlocks, `${path}.codeBlocks`, issues);
    if (!codeBlocks) return;
    const entry: ReadOnlyEntry = {
      id: candidate.id,
      parentId: candidate.parentId,
      childIds: [...candidate.childIds],
      sequence: candidate.sequence,
      kind: candidate.kind,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
      ...(typeof candidate.text === "string" ? { text: candidate.text } : {}),
      codeBlocks,
      ...(typeof candidate.jumpBackReference === "string" ? { jumpBackReference: candidate.jumpBackReference } : {}),
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

  const roots = input.roots;
  const actualRoots = entries.filter((entry) => entry.parentId === null).map((entry) => entry.id).sort();
  if (new Set(roots).size !== roots.length || roots.some((id) => !byId.has(id)) || JSON.stringify([...roots].sort()) !== JSON.stringify(actualRoots)) {
    issues.push({ path: "$.roots", code: "root-set-mismatch", message: "Roots must list every parentless entry exactly once." });
  }
  const activePath = input.activePath;
  activePath.forEach((id, index) => {
    const entry = byId.get(id);
    if (!entry) issues.push({ path: `$.activePath[${index}]`, code: "active-entry-missing", message: "Active entry does not resolve." });
    else if ((index === 0 && entry.parentId !== null) || (index > 0 && entry.parentId !== activePath[index - 1])) {
      issues.push({ path: `$.activePath[${index}]`, code: "active-path-disconnected", message: "Active path must follow parent links from a root." });
    }
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { ...(input as unknown as ReadOnlyRepresentation), entries }, warnings: [] };
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
  return representation.entries.find((entry) => entry.id === entryId)?.jumpBackReference
    ?? representation.provenance.authority.reference
    ?? null;
}
