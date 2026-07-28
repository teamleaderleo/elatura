// SPDX-License-Identifier: MPL-2.0
import type { AdapterIdentity } from "./adapter-contract.js";
import type { ValidationIssue, ValidationResult } from "./index.js";

export const READ_ONLY_REPRESENTATION_VERSION = 1 as const;

export type FreshnessState = "fresh" | "stale" | "expired";

export type FreshnessWindow = {
  capturedAt: number;
  staleAt: number;
  expiresAt: number;
};

export type TransformationProvenance = {
  kind: "authoritative" | "windowed" | "alternate-representation";
  id?: string;
  version?: string;
};

export type ContentProvenance = {
  authority: {
    origin: string;
    reference?: string;
  };
  capturedAt: number;
  adapter: AdapterIdentity;
  transformation: TransformationProvenance;
  cache: {
    kind: "none" | "memory" | "persistent";
    envelopeVersion?: number;
  };
  freshness: FreshnessWindow;
  synthetic: boolean;
};

export type ReadOnlyCodeBlock = {
  language?: string;
  text: string;
};

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin;
  } catch {
    return false;
  }
}

export function validateFreshnessWindow(
  input: unknown,
  path = "$.freshness",
): ValidationResult<FreshnessWindow> {
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path, code: "freshness-not-object", message: "Expected an object." }] };
  }
  const capturedAt = input.capturedAt;
  const staleAt = input.staleAt;
  const expiresAt = input.expiresAt;
  if (
    typeof capturedAt !== "number" ||
    !Number.isFinite(capturedAt) ||
    typeof staleAt !== "number" ||
    !Number.isFinite(staleAt) ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  ) {
    return {
      ok: false,
      issues: [{ path, code: "invalid-freshness-time", message: "Freshness times must be finite numbers." }],
    };
  }
  if (capturedAt > staleAt || staleAt > expiresAt) {
    return {
      ok: false,
      issues: [
        {
          path,
          code: "invalid-freshness-order",
          message: "Expected capturedAt <= staleAt <= expiresAt.",
        },
      ],
    };
  }
  return { ok: true, value: { capturedAt, staleAt, expiresAt }, warnings: [] };
}

export function resolveFreshnessState(window: FreshnessWindow, now: number): FreshnessState {
  if (now >= window.expiresAt) return "expired";
  if (now >= window.staleAt) return "stale";
  return "fresh";
}

export function validateReadOnlyRepresentation(
  input: unknown,
): ValidationResult<ReadOnlyRepresentation> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", code: "representation-not-object", message: "Expected an object." }] };
  }
  if (input.version !== READ_ONLY_REPRESENTATION_VERSION) {
    issues.push({ path: "$.version", code: "unsupported-representation-version", message: "Unsupported version." });
  }
  if (!isRecord(input.adapter) || !isNonEmptyString(input.adapter.id) || !isNonEmptyString(input.adapter.version)) {
    issues.push({ path: "$.adapter", code: "invalid-adapter-identity", message: "Expected adapter id and version." });
  }
  if (!isRecord(input.provenance)) {
    issues.push({ path: "$.provenance", code: "invalid-provenance", message: "Expected provenance metadata." });
  } else {
    const authority = input.provenance.authority;
    if (!isRecord(authority) || !isNonEmptyString(authority.origin) || !validOrigin(authority.origin)) {
      issues.push({ path: "$.provenance.authority.origin", code: "invalid-authority-origin", message: "Expected an exact HTTP(S) origin." });
    }
    if (typeof input.provenance.capturedAt !== "number" || !Number.isFinite(input.provenance.capturedAt)) {
      issues.push({ path: "$.provenance.capturedAt", code: "invalid-capture-time", message: "Expected a finite number." });
    }
    const freshness = validateFreshnessWindow(input.provenance.freshness, "$.provenance.freshness");
    if (!freshness.ok) issues.push(...freshness.issues);
    else if (freshness.value.capturedAt !== input.provenance.capturedAt) {
      issues.push({ path: "$.provenance.capturedAt", code: "capture-time-mismatch", message: "Capture time must match freshness metadata." });
    }
    if (typeof input.provenance.synthetic !== "boolean") {
      issues.push({ path: "$.provenance.synthetic", code: "invalid-synthetic-flag", message: "Expected a boolean." });
    }
  }
  if (!Array.isArray(input.roots) || input.roots.some((id) => !isNonEmptyString(id))) {
    issues.push({ path: "$.roots", code: "invalid-roots", message: "Expected string entry ids." });
  }
  if (!Array.isArray(input.activePath) || input.activePath.some((id) => !isNonEmptyString(id))) {
    issues.push({ path: "$.activePath", code: "invalid-active-path", message: "Expected string entry ids." });
  }
  if (!Array.isArray(input.entries)) {
    issues.push({ path: "$.entries", code: "invalid-entries", message: "Expected an array." });
  }
  if (issues.length > 0 || !Array.isArray(input.entries) || !Array.isArray(input.roots) || !Array.isArray(input.activePath)) {
    return { ok: false, issues };
  }

  const entries: ReadOnlyEntry[] = [];
  const byId = new Map<string, ReadOnlyEntry>();
  const sequences = new Set<number>();
  for (let index = 0; index < input.entries.length; index += 1) {
    const candidate = input.entries[index];
    const path = `$.entries[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, code: "entry-not-object", message: "Expected an object." });
      continue;
    }
    if (!isNonEmptyString(candidate.id) || byId.has(candidate.id)) {
      issues.push({ path: `${path}.id`, code: "invalid-entry-id", message: "Entry ids must be unique non-empty strings." });
      continue;
    }
    if (!(candidate.parentId === null || isNonEmptyString(candidate.parentId))) {
      issues.push({ path: `${path}.parentId`, code: "invalid-parent-id", message: "Expected string or null." });
      continue;
    }
    if (!Array.isArray(candidate.childIds) || candidate.childIds.some((id) => !isNonEmptyString(id)) || new Set(candidate.childIds).size !== candidate.childIds.length) {
      issues.push({ path: `${path}.childIds`, code: "invalid-child-ids", message: "Expected unique string ids." });
      continue;
    }
    if (!Number.isInteger(candidate.sequence) || (candidate.sequence as number) < 0 || sequences.has(candidate.sequence as number)) {
      issues.push({ path: `${path}.sequence`, code: "invalid-sequence", message: "Sequences must be unique non-negative integers." });
      continue;
    }
    if (!isNonEmptyString(candidate.kind)) {
      issues.push({ path: `${path}.kind`, code: "invalid-entry-kind", message: "Expected a non-empty string." });
      continue;
    }
    if (!Array.isArray(candidate.codeBlocks) || candidate.codeBlocks.some((block) => !isRecord(block) || typeof block.text !== "string")) {
      issues.push({ path: `${path}.codeBlocks`, code: "invalid-code-blocks", message: "Expected code block objects." });
      continue;
    }
    const entry = candidate as unknown as ReadOnlyEntry;
    entries.push(entry);
    byId.set(entry.id, entry);
    sequences.add(entry.sequence);
  }

  const expectedOrder = [...entries].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  if (entries.some((entry, index) => entry.id !== expectedOrder[index]?.id)) {
    issues.push({ path: "$.entries", code: "non-deterministic-entry-order", message: "Entries must be ordered by sequence then id." });
  }

  for (const entry of entries) {
    if (entry.parentId !== null) {
      const parent = byId.get(entry.parentId);
      if (!parent) {
        issues.push({ path: `$.entries.${entry.id}.parentId`, code: "missing-parent", message: "Parent does not resolve." });
      } else if (!parent.childIds.includes(entry.id)) {
        issues.push({ path: `$.entries.${entry.id}.parentId`, code: "parent-child-mismatch", message: "Parent must reference the child." });
      }
    }
    for (const childId of entry.childIds) {
      const child = byId.get(childId);
      if (!child) {
        issues.push({ path: `$.entries.${entry.id}.childIds`, code: "missing-child", message: "Child does not resolve." });
      } else if (child.parentId !== entry.id) {
        issues.push({ path: `$.entries.${entry.id}.childIds`, code: "child-parent-mismatch", message: "Child must reference the parent." });
      }
    }
  }

  const roots = input.roots as string[];
  if (new Set(roots).size !== roots.length || roots.some((id) => !byId.has(id))) {
    issues.push({ path: "$.roots", code: "invalid-root-set", message: "Roots must be unique resolved entries." });
  } else {
    const actualRoots = entries.filter((entry) => entry.parentId === null).map((entry) => entry.id).sort();
    if (JSON.stringify([...roots].sort()) !== JSON.stringify(actualRoots)) {
      issues.push({ path: "$.roots", code: "root-set-mismatch", message: "Roots must list every parentless entry." });
    }
  }

  const activePath = input.activePath as string[];
  for (let index = 0; index < activePath.length; index += 1) {
    const entry = byId.get(activePath[index]!);
    if (!entry) {
      issues.push({ path: `$.activePath[${index}]`, code: "active-entry-missing", message: "Active entry does not resolve." });
      continue;
    }
    if (index === 0 && entry.parentId !== null) {
      issues.push({ path: "$.activePath[0]", code: "active-path-missing-root", message: "Active path must begin at a root." });
    }
    if (index > 0 && entry.parentId !== activePath[index - 1]) {
      issues.push({ path: `$.activePath[${index}]`, code: "active-path-disconnected", message: "Active path must follow parent links." });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as unknown as ReadOnlyRepresentation, warnings: [] };
}

export function searchReadOnlyRepresentation(
  representation: ReadOnlyRepresentation,
  query: string,
): ReadOnlyEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return [];
  return representation.entries.filter((entry) =>
    [entry.label, entry.text, ...entry.codeBlocks.map((block) => block.text)]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function extractReadOnlyCode(
  representation: ReadOnlyRepresentation,
): Array<ReadOnlyCodeBlock & { entryId: string }> {
  return representation.entries.flatMap((entry) =>
    entry.codeBlocks.map((block) => ({ ...block, entryId: entry.id })),
  );
}

export function navigateReadOnlyRepresentation(
  representation: ReadOnlyRepresentation,
  entryId: string,
): { parent: ReadOnlyEntry | null; children: ReadOnlyEntry[]; siblings: ReadOnlyEntry[] } | null {
  const byId = new Map(representation.entries.map((entry) => [entry.id, entry]));
  const entry = byId.get(entryId);
  if (!entry) return null;
  const parent = entry.parentId === null ? null : (byId.get(entry.parentId) ?? null);
  const siblings = parent ? parent.childIds.filter((id) => id !== entryId).map((id) => byId.get(id)).filter((value): value is ReadOnlyEntry => value !== undefined) : [];
  const children = entry.childIds.map((id) => byId.get(id)).filter((value): value is ReadOnlyEntry => value !== undefined);
  return { parent, children, siblings };
}

export function resolveJumpBackReference(
  representation: ReadOnlyRepresentation,
  entryId: string,
): string | null {
  const entry = representation.entries.find((candidate) => candidate.id === entryId);
  return entry?.jumpBackReference ?? representation.provenance.authority.reference ?? null;
}
