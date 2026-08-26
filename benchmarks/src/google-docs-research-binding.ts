// SPDX-License-Identifier: MPL-2.0

/**
 * Research-only, memory-only binding from one generated #118 Google Docs lane
 * to the current private Chromium projection token from #136.
 *
 * Provider document ids, URLs, titles, content, cookies, profile paths, and
 * reusable credentials have no admitted field. projectionRef is deliberately
 * private runtime state and is excluded from the content-free receipt.
 */

export const GOOGLE_DOCS_RESEARCH_BINDING_VERSION = 1 as const;
export const MAX_GOOGLE_DOCS_RESEARCH_BINDINGS = 8;

export const GOOGLE_DOCS_RESEARCH_BINDING_MODES = [
  "initial",
  "verified-continuity",
  "generation-advance",
] as const;
export type GoogleDocsResearchBindingMode =
  (typeof GOOGLE_DOCS_RESEARCH_BINDING_MODES)[number];

export const GOOGLE_DOCS_RESEARCH_PREFLIGHT_REASONS = [
  "matched",
  "binding-missing",
  "stale-generation",
  "projection-mismatch",
] as const;
export type GoogleDocsResearchPreflightReason =
  (typeof GOOGLE_DOCS_RESEARCH_PREFLIGHT_REASONS)[number];

export type GoogleDocsResearchBindingInputV1 = Readonly<{
  version: typeof GOOGLE_DOCS_RESEARCH_BINDING_VERSION;
  laneRef: string;
  laneGeneration: number;
  projectionRef: string;
  mode: GoogleDocsResearchBindingMode;
}>;

/** Content-free receipt safe for committed benchmark evidence. */
export type GoogleDocsResearchBindingReceiptV1 = Readonly<{
  version: typeof GOOGLE_DOCS_RESEARCH_BINDING_VERSION;
  laneRef: string;
  laneGeneration: number;
  bindingRevision: number;
  mode: GoogleDocsResearchBindingMode;
  projectionChanged: boolean;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type GoogleDocsResearchBindingPreflightV1 = Readonly<{
  version: typeof GOOGLE_DOCS_RESEARCH_BINDING_VERSION;
  laneRef: string;
  laneGeneration: number;
  ok: boolean;
  reason: GoogleDocsResearchPreflightReason;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

type PrivateBinding = Readonly<{
  laneRef: string;
  laneGeneration: number;
  projectionRef: string;
  bindingRevision: number;
}>;

const LANE_REF = /^gdocs-research-(?:large-00|switch-0[1-8])$/u;
const PROJECTION_REF = /^chrome-session-tab-(?:0|[1-9][0-9]{0,15})$/u;

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use a plain object prototype.`);
  }
  return value as Record<string, unknown>;
}

function exactOwnData(
  input: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  const extras = keys.filter((key) => !fields.includes(key));
  if (extras.length > 0) {
    throw new TypeError(`${label} contains unsupported fields.`);
  }
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError(`${label}.${field} must be an own data property.`);
    }
  }
}

function laneRef(value: unknown): string {
  if (typeof value !== "string" || !LANE_REF.test(value)) {
    throw new TypeError("laneRef must be one of the generated #118 research lane tokens.");
  }
  return value;
}

function generation(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100_000) {
    throw new TypeError("laneGeneration must be a positive bounded safe integer.");
  }
  return Number(value);
}

function projectionRef(value: unknown): string {
  if (typeof value !== "string" || !PROJECTION_REF.test(value)) {
    throw new TypeError("projectionRef must be a #136 Chromium session-tab token.");
  }
  return value;
}

function mode(value: unknown): GoogleDocsResearchBindingMode {
  if (
    typeof value !== "string" ||
    !GOOGLE_DOCS_RESEARCH_BINDING_MODES.includes(
      value as GoogleDocsResearchBindingMode,
    )
  ) {
    throw new TypeError("mode is invalid.");
  }
  return value as GoogleDocsResearchBindingMode;
}

function normalizeInput(input: unknown): GoogleDocsResearchBindingInputV1 {
  const value = plainRecord(input, "binding");
  exactOwnData(
    value,
    ["version", "laneRef", "laneGeneration", "projectionRef", "mode"],
    "binding",
  );
  if (value.version !== GOOGLE_DOCS_RESEARCH_BINDING_VERSION) {
    throw new TypeError("binding.version is unsupported.");
  }
  return Object.freeze({
    version: GOOGLE_DOCS_RESEARCH_BINDING_VERSION,
    laneRef: laneRef(value.laneRef),
    laneGeneration: generation(value.laneGeneration),
    projectionRef: projectionRef(value.projectionRef),
    mode: mode(value.mode),
  });
}

function preflight(
  laneRefValue: string,
  laneGeneration: number,
  ok: boolean,
  reason: GoogleDocsResearchPreflightReason,
): GoogleDocsResearchBindingPreflightV1 {
  return Object.freeze({
    version: GOOGLE_DOCS_RESEARCH_BINDING_VERSION,
    laneRef: laneRefValue,
    laneGeneration,
    ok,
    reason,
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

/**
 * Volatile benchmark binding state. Nothing is persisted, logged, or sent over
 * the network. highestGeneration survives invalidate() inside this process so
 * a stale generation cannot silently regain authority after projection loss.
 */
export class GoogleDocsResearchBindingRegistryV1 {
  readonly #bindings = new Map<string, PrivateBinding>();
  readonly #highestGeneration = new Map<string, number>();
  readonly #projectionOwners = new Map<string, string>();
  #bindingRevision = 0;

  get size(): number {
    return this.#bindings.size;
  }

  bind(input: unknown): GoogleDocsResearchBindingReceiptV1 {
    const normalized = normalizeInput(input);
    const current = this.#bindings.get(normalized.laneRef);
    const highest = this.#highestGeneration.get(normalized.laneRef);
    const projectionOwner = this.#projectionOwners.get(normalized.projectionRef);

    if (projectionOwner !== undefined && projectionOwner !== normalized.laneRef) {
      throw new Error("projection-already-bound");
    }

    if (normalized.mode === "initial") {
      if (highest !== undefined || current !== undefined) throw new Error("lane-already-seen");
      if (normalized.laneGeneration !== 1) throw new Error("initial-generation-must-be-one");
      if (this.#bindings.size >= MAX_GOOGLE_DOCS_RESEARCH_BINDINGS) {
        throw new Error("binding-capacity-reached");
      }
    } else if (normalized.mode === "verified-continuity") {
      if (highest === undefined) throw new Error("lane-history-missing");
      if (normalized.laneGeneration !== highest) throw new Error("continuity-generation-mismatch");
      if (current === undefined && this.#bindings.size >= MAX_GOOGLE_DOCS_RESEARCH_BINDINGS) {
        throw new Error("binding-capacity-reached");
      }
    } else {
      if (highest === undefined) throw new Error("lane-history-missing");
      if (normalized.laneGeneration !== highest + 1) {
        throw new Error("generation-advance-must-be-next");
      }
      if (current === undefined && this.#bindings.size >= MAX_GOOGLE_DOCS_RESEARCH_BINDINGS) {
        throw new Error("binding-capacity-reached");
      }
    }

    const projectionChanged =
      current !== undefined && current.projectionRef !== normalized.projectionRef;

    if (current !== undefined && current.projectionRef !== normalized.projectionRef) {
      this.#projectionOwners.delete(current.projectionRef);
    }

    this.#bindingRevision += 1;
    const binding = Object.freeze({
      laneRef: normalized.laneRef,
      laneGeneration: normalized.laneGeneration,
      projectionRef: normalized.projectionRef,
      bindingRevision: this.#bindingRevision,
    });
    this.#bindings.set(normalized.laneRef, binding);
    this.#highestGeneration.set(normalized.laneRef, normalized.laneGeneration);
    this.#projectionOwners.set(normalized.projectionRef, normalized.laneRef);

    return Object.freeze({
      version: GOOGLE_DOCS_RESEARCH_BINDING_VERSION,
      laneRef: normalized.laneRef,
      laneGeneration: normalized.laneGeneration,
      bindingRevision: binding.bindingRevision,
      mode: normalized.mode,
      projectionChanged,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  }

  invalidate(laneRefInput: unknown, generationInput: unknown): boolean {
    const normalizedLaneRef = laneRef(laneRefInput);
    const normalizedGeneration = generation(generationInput);
    const current = this.#bindings.get(normalizedLaneRef);
    if (current === undefined || current.laneGeneration !== normalizedGeneration) {
      return false;
    }
    this.#bindings.delete(normalizedLaneRef);
    this.#projectionOwners.delete(current.projectionRef);
    return true;
  }

  /**
   * Compare the canonical lane generation and the privately re-fetched current
   * Chromium projection immediately before a browser effect.
   */
  preflight(
    laneRefInput: unknown,
    generationInput: unknown,
    currentProjectionRefInput: unknown,
  ): GoogleDocsResearchBindingPreflightV1 {
    const normalizedLaneRef = laneRef(laneRefInput);
    const normalizedGeneration = generation(generationInput);
    const normalizedProjectionRef = projectionRef(currentProjectionRefInput);
    const highest = this.#highestGeneration.get(normalizedLaneRef);
    const current = this.#bindings.get(normalizedLaneRef);

    if (highest !== undefined && normalizedGeneration !== highest) {
      return preflight(
        normalizedLaneRef,
        normalizedGeneration,
        false,
        "stale-generation",
      );
    }
    if (current === undefined || current.laneGeneration !== normalizedGeneration) {
      return preflight(
        normalizedLaneRef,
        normalizedGeneration,
        false,
        "binding-missing",
      );
    }
    if (current.projectionRef !== normalizedProjectionRef) {
      return preflight(
        normalizedLaneRef,
        normalizedGeneration,
        false,
        "projection-mismatch",
      );
    }
    return preflight(normalizedLaneRef, normalizedGeneration, true, "matched");
  }

  /** Content-free state for tests/diagnostics; private projection refs omitted. */
  snapshot(): ReadonlyArray<
    Readonly<{
      laneRef: string;
      laneGeneration: number;
      bindingRevision: number;
    }>
  > {
    return Object.freeze(
      [...this.#bindings.values()]
        .map((binding) =>
          Object.freeze({
            laneRef: binding.laneRef,
            laneGeneration: binding.laneGeneration,
            bindingRevision: binding.bindingRevision,
          }),
        )
        .sort((left, right) => left.laneRef.localeCompare(right.laneRef)),
    );
  }

  clear(): void {
    this.#bindings.clear();
    this.#highestGeneration.clear();
    this.#projectionOwners.clear();
    this.#bindingRevision = 0;
  }
}
